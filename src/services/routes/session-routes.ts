import { Hono } from 'hono';
import type { WorkerState } from '../server.js';
import { createSession, getSessionByContentId, completeSession, incrementPromptCount } from '../sqlite/sessions.js';
import { insertPrompt } from '../sqlite/prompts.js';
import { enqueuePendingMessage, getPendingCount } from '../sqlite/pending-messages.js';
import { buildProactiveContext } from '../context/proactive.js';
import { embed, isEmbeddingReady } from '../embeddings/embedding-service.js';
import { getConfig } from '../../shared/config.js';
import { logger } from '../../utils/logger.js';

export function sessionRoutes(state: WorkerState): Hono {
  const app = new Hono();

  // POST /sessions/init — create or retrieve session, store prompt
  app.post('/init', async (c) => {
    const body = await c.req.json();
    const { contentSessionId, project, branch, prompt, sourceIde } = body;

    if (!contentSessionId || !project) {
      return c.json({ error: 'contentSessionId and project required' }, 400);
    }

    const session = createSession(state.db, {
      contentSessionId,
      project,
      branch: branch || undefined,
      sourceIde: sourceIde || 'claude-code',
    });

    const promptNumber = incrementPromptCount(state.db, session.id);

    if (prompt) {
      insertPrompt(state.db, {
        sessionId: session.id,
        promptNumber,
        promptText: prompt,
      });
    }

    logger.debug('SESSION', 'Session initialized', {
      sessionId: session.id,
      project,
      promptNumber,
    });

    // Build proactive context for mid-session prompts (promptNumber > 1)
    let proactiveContext: string | undefined;
    const config = getConfig();
    const proactiveConfig = config.get('proactive');

    if (proactiveConfig.enabled && prompt && promptNumber > 1) {
      try {
        let promptEmbedding: Float32Array | undefined;
        if (isEmbeddingReady()) {
          promptEmbedding = await embed(prompt);
        }

        const context = buildProactiveContext(state.db, {
          project,
          prompt,
          promptEmbedding,
          branch: branch || undefined,
        });

        if (context) {
          proactiveContext = context;
        }
      } catch (error) {
        logger.debug('SESSION', 'Proactive context generation failed', {
          error: (error as Error).message,
        });
      }
    }

    return c.json({
      sessionId: session.id,
      promptNumber,
      ...(proactiveContext ? { proactiveContext } : {}),
    });
  });

  // POST /sessions/:sessionId/observe — queue an observation for batch processing
  app.post('/:sessionId/observe', async (c) => {
    const body = await c.req.json();
    const { contentSessionId, toolName, toolInput, toolResponse, cwd } = body;

    // Look up session by contentSessionId (URL param is informational)
    const session = getSessionByContentId(state.db, contentSessionId);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    enqueuePendingMessage(state.db, {
      sessionId: session.id,
      contentSessionId,
      messageType: 'observation',
      toolName,
      toolInput: typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput),
      toolResponse: typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse),
      cwd,
    });

    const pendingCount = getPendingCount(state.db, session.id);

    logger.debug('SESSION', 'Observation queued', {
      sessionId: session.id,
      toolName,
      pendingCount,
    });

    return c.json({ queued: true, pendingCount }, 202);
  });

  // POST /sessions/:sessionId/summarize — flush pending + generate summary
  app.post('/:sessionId/summarize', async (c) => {
    const body = await c.req.json();
    const { contentSessionId, lastAssistantMessage } = body;

    const session = getSessionByContentId(state.db, contentSessionId);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    // Enqueue summarize message for the extraction pipeline to process
    enqueuePendingMessage(state.db, {
      sessionId: session.id,
      contentSessionId,
      messageType: 'summarize',
      lastAssistantMessage,
    });

    logger.debug('SESSION', 'Summarize request queued', { sessionId: session.id });

    return c.json({ queued: true });
  });

  // POST /sessions/:sessionId/complete — mark session as completed
  app.post('/:sessionId/complete', async (c) => {
    const body = await c.req.json();
    const { contentSessionId } = body;

    const session = getSessionByContentId(state.db, contentSessionId);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    completeSession(state.db, session.id);
    logger.debug('SESSION', 'Session completed', { sessionId: session.id });

    return c.json({ completed: true });
  });

  // POST /sessions/:sessionId/observe-correction — record user correction as high-importance observation
  app.post('/:sessionId/observe-correction', async (c) => {
    const body = await c.req.json();
    const { sessionId, promptText, matchedPattern, project } = body;

    if (!sessionId || !promptText || !project) {
      return c.json({ error: 'sessionId, promptText, and project required' }, 400);
    }

    const { insertObservation } = await import('../sqlite/observations.js');

    const id = insertObservation(state.db, {
      sessionId: typeof sessionId === 'number' ? sessionId : parseInt(sessionId, 10),
      project,
      type: 'decision',
      title: `User correction: ${matchedPattern || 'preference change'}`,
      facts: JSON.stringify([promptText]),
      importance: 8,
    });

    logger.debug('SESSION', 'Correction observation recorded', { sessionId, matchedPattern });

    return c.json({ id, recorded: true });
  });

  return app;
}
