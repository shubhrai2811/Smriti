import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { getWorkerPort, checkHealth } from '../../infrastructure/process-manager.js';
import { logger } from '../../utils/logger.js';

export const sessionCompleteHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    const port = getWorkerPort();
    if (!port || !(await checkHealth(port, 2000))) {
      return { continue: true, suppressOutput: true };
    }

    const { sessionId } = input;

    try {
      await fetch(`http://127.0.0.1:${port}/sessions/${encodeURIComponent(sessionId)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentSessionId: sessionId }),
      });
    } catch (error) {
      logger.warn('HOOK', 'Session complete error', { error: (error as Error).message });
    }

    return { continue: true, suppressOutput: true };
  },
};
