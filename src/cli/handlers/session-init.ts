import { checkHealth, getWorkerPort } from '../../infrastructure/process-manager.js';
import { getCurrentBranch, getProjectName } from '../../utils/git.js';
import { logger } from '../../utils/logger.js';
import { stripPrivateTags } from '../../utils/privacy.js';
import type { EventHandler, HookResult, NormalizedHookInput } from '../types.js';

export const sessionInitHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    const port = getWorkerPort();
    if (!port || !(await checkHealth(port, 2000))) {
      return { continue: true, suppressOutput: true, exitCode: 0 };
    }

    const { sessionId, cwd, prompt: rawPrompt } = input;
    const project = getProjectName(cwd);
    const branch = getCurrentBranch(cwd);

    // Strip private tags
    const prompt = stripPrivateTags(rawPrompt || '[media prompt]');
    if (!prompt.trim()) {
      return { continue: true, suppressOutput: true };
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/sessions/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: sessionId,
          project,
          branch,
          prompt,
          sourceIde: input.platform,
        }),
      });

      if (!response.ok) {
        logger.warn('HOOK', 'Session init failed', { status: response.status });
        return { continue: true, suppressOutput: true };
      }

      const responseBody = (await response.json()) as {
        sessionId: number;
        promptNumber: number;
        proactiveContext?: string;
      };

      // Detect correction patterns in the prompt
      const { detectCorrection } = await import('../../services/extraction/corrections.js');
      const correction = detectCorrection(prompt);
      if (correction.isCorrection && responseBody.sessionId) {
        // Fire-and-forget: create a high-importance correction observation
        fetch(`http://127.0.0.1:${port}/sessions/${responseBody.sessionId}/observe-correction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: responseBody.sessionId,
            promptText: prompt,
            matchedPattern: correction.matchedPattern,
            project,
          }),
        }).catch(() => {}); // Fire-and-forget
      }

      if (responseBody.proactiveContext) {
        return {
          continue: true,
          suppressOutput: false,
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: responseBody.proactiveContext,
          },
        };
      }
    } catch (error) {
      logger.warn('HOOK', 'Session init error', { error: (error as Error).message });
    }

    return { continue: true, suppressOutput: true };
  },
};
