import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { getWorkerPort, checkHealth } from '../../infrastructure/process-manager.js';
import { sanitizeForStorage } from '../../utils/privacy.js';
import { META_TOOLS } from '../../shared/constants.js';
import { logger } from '../../utils/logger.js';

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
    } catch (error) {
      logger.warn('HOOK', 'Observation error', { error: (error as Error).message });
    }

    return { continue: true, suppressOutput: true };
  },
};
