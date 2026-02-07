import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { getWorkerPort, checkHealth } from '../../infrastructure/process-manager.js';
import { sanitizeForStorage } from '../../utils/privacy.js';
import { META_TOOLS } from '../../shared/constants.js';
import { logger } from '../../utils/logger.js';

/**
 * Extract file paths from tool input for gotcha detection.
 */
function extractFilePaths(_toolName: string | undefined, toolInput: unknown): string[] {
  const paths: string[] = [];
  if (!toolInput) return paths;

  const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);

  // Look for common file path patterns in tool input
  try {
    const parsed = typeof toolInput === 'string' ? JSON.parse(toolInput) : toolInput;
    if (parsed && typeof parsed === 'object') {
      // Common field names for file paths
      for (const key of ['file_path', 'filePath', 'path', 'filename', 'file']) {
        if (typeof (parsed as any)[key] === 'string') {
          paths.push((parsed as any)[key]);
        }
      }
    }
  } catch {
    // Not JSON, try regex extraction
  }

  // Extract paths from string content (matches /path/to/file.ext patterns)
  const pathRegex = /(?:^|\s)((?:\/[\w.-]+)+\.\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(inputStr)) !== null) {
    if (!paths.includes(match[1])) {
      paths.push(match[1]);
    }
  }

  return paths;
}

export const observationHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    const port = getWorkerPort();
    if (!port || !(await checkHealth(port, 2000))) {
      return { continue: true, suppressOutput: true, exitCode: 0 };
    }

    const { sessionId, toolName, toolInput, toolResponse, cwd } = input;

    // Skip meta tools
    if (!toolName || META_TOOLS.has(toolName)) {
      return { continue: true, suppressOutput: true };
    }

    try {
      // Sanitize before sending
      const cleanInput = sanitizeForStorage(typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput ?? ''));
      const cleanResponse = sanitizeForStorage(typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse ?? ''));

      const response = await fetch(`http://127.0.0.1:${port}/sessions/${encodeURIComponent(sessionId)}/observe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: sessionId,
          toolName,
          toolInput: cleanInput,
          toolResponse: cleanResponse,
          cwd,
        }),
      });

      if (!response.ok) {
        logger.warn('HOOK', 'Observation store failed', { status: response.status, toolName });
      }

      // Gotcha detection: check if files being touched have known pitfalls
      const filePaths = extractFilePaths(toolName, toolInput);
      if (filePaths.length > 0) {
        try {
          const { getConfig } = await import('../../shared/config.js');
          const config = getConfig();
          const gotchaConfig = config.get('gotcha');

          if (gotchaConfig.enabled) {
            const gotchaRes = await fetch(`http://127.0.0.1:${port}/context/gotchas`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                files: filePaths,
                project: cwd,
                minImportance: gotchaConfig.minImportance,
              }),
            });

            if (gotchaRes.ok) {
              const gotchaBody = await gotchaRes.json() as { warning?: string };
              if (gotchaBody.warning) {
                return {
                  continue: true,
                  suppressOutput: false,
                  hookSpecificOutput: {
                    hookEventName: 'PostToolUse',
                    additionalContext: gotchaBody.warning,
                  },
                };
              }
            }
          }
        } catch (error) {
          logger.debug('HOOK', 'Gotcha check failed', { error: (error as Error).message });
        }
      }
    } catch (error) {
      logger.warn('HOOK', 'Observation error', { error: (error as Error).message });
    }

    return { continue: true, suppressOutput: true };
  },
};
