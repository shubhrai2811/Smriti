import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { getWorkerPort, checkHealth } from '../../infrastructure/process-manager.js';
import { HOOK_TIMEOUTS } from '../../shared/constants.js';
import { logger } from '../../utils/logger.js';

export const summarizeHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    const port = getWorkerPort();
    if (!port || !(await checkHealth(port, 2000))) {
      return { continue: true, suppressOutput: true, exitCode: 0 };
    }

    const { sessionId, transcriptPath } = input;

    // Extract last assistant message from transcript
    let lastAssistantMessage = '';
    if (transcriptPath) {
      try {
        lastAssistantMessage = extractLastAssistantMessage(transcriptPath);
      } catch (error) {
        logger.warn('HOOK', 'Failed to extract transcript', { error: (error as Error).message });
      }
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HOOK_TIMEOUTS.SUMMARIZE);

      const response = await fetch(`http://127.0.0.1:${port}/sessions/${encodeURIComponent(sessionId)}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: sessionId,
          lastAssistantMessage,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        logger.warn('HOOK', 'Summarize failed', { status: response.status });
      }
    } catch (error) {
      logger.warn('HOOK', 'Summarize error', { error: (error as Error).message });
    }

    return { continue: true, suppressOutput: true };
  },
};

function extractLastAssistantMessage(transcriptPath: string): string {
  try {
    const content = require('fs').readFileSync(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter((l: string) => l.trim());

    // JSONL format -- iterate backwards to find last assistant message
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === 'assistant' || entry.role === 'assistant') {
          const msg = entry.message || entry;
          if (typeof msg.content === 'string') return msg.content;
          if (Array.isArray(msg.content)) {
            return msg.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('');
          }
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* file not found or unreadable */ }
  return '';
}
