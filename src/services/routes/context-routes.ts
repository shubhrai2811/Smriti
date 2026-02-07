import { Hono } from 'hono';
import type { WorkerState } from '../server.js';
import { buildContext } from '../context/builder.js';
import { getConfig } from '../../shared/config.js';
import { logger } from '../../utils/logger.js';

export function contextRoutes(state: WorkerState): Hono {
  const app = new Hono();

  // GET /context/inject?project=X&branch=Y&sourceIde=Z
  // Returns plain text context to be injected into the AI assistant's system prompt
  app.get('/inject', async (c) => {
    const project = c.req.query('project');
    const branch = c.req.query('branch') || undefined;
    const prompt = c.req.query('prompt');
    const sourceIde = c.req.query('sourceIde') || undefined;

    if (!project) {
      return c.text('', 200);
    }

    const config = getConfig();
    const contextConfig = config.get('context');

    const context = buildContext(state.db, {
      project,
      branch,
      prompt: prompt || undefined,
      tokenBudget: contextConfig.tokenBudget,
      showInlineSummary: contextConfig.showInlineSummary,
    });

    logger.debug('CONTEXT', 'Context injected', { project, branch, sourceIde, length: context.length });

    return c.text(context);
  });

  return app;
}
