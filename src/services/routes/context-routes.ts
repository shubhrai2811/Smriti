import { Hono } from 'hono';
import { getConfig } from '../../shared/config.js';
import { logger } from '../../utils/logger.js';
import { buildContext } from '../context/builder.js';
import type { WorkerState } from '../server.js';

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

  // POST /context/gotchas — check for gotcha warnings on files being touched
  app.post('/gotchas', async (c) => {
    const body = await c.req.json();
    const { files, project, minImportance } = body;

    if (!files || !Array.isArray(files) || !project) {
      return c.json({ error: 'files array and project required' }, 400);
    }

    const { findGotchas, formatGotchaWarning } = await import('../context/gotcha.js');
    const gotchas = findGotchas(state.db, files, project, minImportance || 7);

    if (gotchas.length === 0) {
      return c.json({ warning: null });
    }

    return c.json({ warning: formatGotchaWarning(gotchas), count: gotchas.length });
  });

  // POST /context/claudemd — generate/update CLAUDE.md for a project
  app.post('/claudemd', async (c) => {
    const body = await c.req.json();
    const { projectDir } = body;

    if (!projectDir) {
      return c.json({ error: 'projectDir required' }, 400);
    }

    try {
      const { generateClaudeMdSection, updateClaudeMd } = await import('../claudemd/generator.js');
      const { getProjectName } = await import('../../utils/git.js');
      const project = getProjectName(projectDir);
      const section = generateClaudeMdSection(state.db, project);
      updateClaudeMd(projectDir, section);
      return c.json({ updated: true });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  return app;
}
