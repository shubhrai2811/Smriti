import { Hono } from 'hono';
import type { WorkerState } from '../server.js';
import { getRecentSessions } from '../sqlite/sessions.js';
import { getRecentObservations } from '../sqlite/observations.js';
import { getReflectionsByProject } from '../sqlite/reflections.js';
import { getProfileByProject } from '../sqlite/developer-profile.js';
import { getLinksByObservation } from '../sqlite/observation-links.js';
import { getEntitiesByProject, getHotspotEntities } from '../sqlite/entities.js';
import { addTag, removeTag, getTagsByObservation, getAllTags } from '../sqlite/tags.js';

export function dataRoutes(state: WorkerState): Hono {
  const app = new Hono();

  // GET /data/sessions?project=X&limit=20
  app.get('/sessions', (c) => {
    const project = c.req.query('project') || '';
    const limit = parseInt(c.req.query('limit') || '20', 10);

    const sessions = getRecentSessions(state.db, project, limit);
    return c.json({ sessions });
  });

  // GET /data/observations?project=X&limit=50&branch=Y
  app.get('/observations', (c) => {
    const project = c.req.query('project') || '';
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const branch = c.req.query('branch') || undefined;

    const observations = getRecentObservations(state.db, project, { limit, branch });
    return c.json({ observations });
  });

  // GET /data/reflections?project=X&type=quick|deep&limit=20
  app.get('/reflections', (c) => {
    const project = c.req.query('project') || '';
    const type = c.req.query('type') || undefined;
    const limit = parseInt(c.req.query('limit') || '20', 10);

    const reflections = getReflectionsByProject(state.db, project, { type, limit });
    return c.json({ reflections });
  });

  // GET /data/profile?project=X&category=Y
  app.get('/profile', (c) => {
    const project = c.req.query('project') || '';
    const category = c.req.query('category') || undefined;

    const entries = getProfileByProject(state.db, project, { category });
    return c.json({ entries });
  });

  // GET /data/links?observationId=X
  app.get('/links', (c) => {
    const observationId = parseInt(c.req.query('observationId') || '0', 10);
    if (!observationId) {
      return c.json({ error: 'observationId is required' }, 400);
    }

    const links = getLinksByObservation(state.db, observationId);
    return c.json({ links });
  });

  // GET /data/entities?project=X&entityType=Y&limit=50
  app.get('/entities', (c) => {
    const project = c.req.query('project') || '';
    const entityType = c.req.query('entityType') || undefined;
    const limit = parseInt(c.req.query('limit') || '50', 10);

    const entities = getEntitiesByProject(state.db, project, { entityType, limit });
    return c.json({ entities });
  });

  // GET /data/hotspots?project=X&entityType=Y&limit=20
  app.get('/hotspots', (c) => {
    const project = c.req.query('project') || '';
    const entityType = c.req.query('entityType') || undefined;
    const limit = parseInt(c.req.query('limit') || '20', 10);

    const hotspots = getHotspotEntities(state.db, project, { entityType, limit });
    return c.json({ hotspots });
  });

  // POST /data/observations/:id/tags — add a tag to an observation
  app.post('/observations/:id/tags', async (c) => {
    const observationId = parseInt(c.req.param('id'), 10);
    if (!observationId) {
      return c.json({ error: 'Invalid observation ID' }, 400);
    }

    const body = await c.req.json();
    const tag = body?.tag;
    if (!tag || typeof tag !== 'string') {
      return c.json({ error: 'tag is required and must be a string' }, 400);
    }

    addTag(state.db, observationId, tag.trim());
    return c.json({ ok: true, observationId, tag: tag.trim() });
  });

  // DELETE /data/observations/:id/tags/:tag — remove a tag from an observation
  app.delete('/observations/:id/tags/:tag', (c) => {
    const observationId = parseInt(c.req.param('id'), 10);
    if (!observationId) {
      return c.json({ error: 'Invalid observation ID' }, 400);
    }

    const tag = c.req.param('tag');
    if (!tag) {
      return c.json({ error: 'tag is required' }, 400);
    }

    removeTag(state.db, observationId, decodeURIComponent(tag));
    return c.json({ ok: true, observationId, tag: decodeURIComponent(tag) });
  });

  // GET /data/observations/:id/tags — get tags for an observation
  app.get('/observations/:id/tags', (c) => {
    const observationId = parseInt(c.req.param('id'), 10);
    if (!observationId) {
      return c.json({ error: 'Invalid observation ID' }, 400);
    }

    const tags = getTagsByObservation(state.db, observationId);
    return c.json({ tags });
  });

  // GET /data/tags?project=X — get all unique tags with counts for a project
  app.get('/tags', (c) => {
    const project = c.req.query('project') || '';
    if (!project) {
      return c.json({ error: 'project query parameter is required' }, 400);
    }

    const tags = getAllTags(state.db, project);
    return c.json({ tags });
  });

  return app;
}
