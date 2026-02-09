import { checkHealth, getWorkerPort } from '../../infrastructure/process-manager.js';
import { getCurrentBranch, getProjectName } from '../../utils/git.js';
import { logger } from '../../utils/logger.js';
import type { EventHandler, HookResult, NormalizedHookInput } from '../types.js';

export const contextHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    const port = getWorkerPort();
    if (!port || !(await checkHealth(port, 3000))) {
      return {
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
        exitCode: 0,
      };
    }

    const cwd = input.cwd || process.cwd();
    const project = getProjectName(cwd);
    const branch = getCurrentBranch(cwd);

    try {
      const url = `http://127.0.0.1:${port}/context/inject?project=${encodeURIComponent(project)}${branch ? `&branch=${encodeURIComponent(branch)}` : ''}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });

      if (!response.ok) {
        return {
          hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
          exitCode: 0,
        };
      }

      const additionalContext = await response.text();

      return {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: additionalContext.trim(),
        },
      };
    } catch (error) {
      logger.warn('HOOK', 'Context injection failed', { error: (error as Error).message });
      return {
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
        exitCode: 0,
      };
    }
  },
};
