import { Hono } from 'hono';
import { parseTimeExpression } from '../../utils/time-expressions.js';
import type { SSEClient, WorkerState } from '../server.js';
import { getProfileByProject } from '../sqlite/developer-profile.js';
import { getEntitiesByProject, getHotspotEntities } from '../sqlite/entities.js';
import { getEntityGraph, getRelationships } from '../sqlite/entity-relationships.js';
import { getLinksByObservation } from '../sqlite/observation-links.js';
import {
  deleteObservation,
  getObservationsByTimeRange,
  getRecentObservations,
  updateObservation,
} from '../sqlite/observations.js';
import { getReflectionsByProject } from '../sqlite/reflections.js';
import { getRecentSessions } from '../sqlite/sessions.js';
import { addTag, getAllTags, getTagsByObservation, removeTag } from '../sqlite/tags.js';
import { getTokenUsageSummary } from '../sqlite/token-usage.js';

export function dataRoutes(state: WorkerState): Hono {
  const app = new Hono();

  // GET /data/stats — aggregate statistics
  app.get('/stats', (c) => {
    const project = c.req.query('project') || '';

    const obsCount = (
      state.db
        .query(
          project
            ? "SELECT COUNT(*) as count FROM observations WHERE (project = ? OR scope = 'global')"
            : 'SELECT COUNT(*) as count FROM observations',
        )
        .get(...(project ? [project] : [])) as any
    ).count;

    const sessionCount = (
      state.db
        .query(
          project
            ? 'SELECT COUNT(*) as count FROM sessions WHERE project = ?'
            : 'SELECT COUNT(*) as count FROM sessions',
        )
        .get(...(project ? [project] : [])) as any
    ).count;

    const typeBreakdown = state.db
      .query(
        project
          ? "SELECT type, COUNT(*) as count FROM observations WHERE (project = ? OR scope = 'global') GROUP BY type ORDER BY count DESC"
          : 'SELECT type, COUNT(*) as count FROM observations GROUP BY type ORDER BY count DESC',
      )
      .all(...(project ? [project] : [])) as Array<{ type: string; count: number }>;

    // DB file size
    const dbSizeRows = state.db
      .query('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()')
      .get() as any;
    const dbSizeBytes = dbSizeRows?.size || 0;
    const dbSizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(2);

    return c.json({
      observations: obsCount,
      sessions: sessionCount,
      typeBreakdown,
      dbSizeMB: `${dbSizeMB} MB`,
    });
  });

  // GET /data/metrics?sessionId=X&sinceDaysAgo=7 — token usage summary
  app.get('/metrics', (c) => {
    const sessionId = c.req.query('sessionId') ? parseInt(c.req.query('sessionId')!, 10) : undefined;
    const sinceDaysAgo = c.req.query('sinceDaysAgo')
      ? parseInt(c.req.query('sinceDaysAgo')!, 10)
      : undefined;

    const summary = getTokenUsageSummary(state.db, { sessionId, sinceDaysAgo });
    return c.json(summary);
  });

  // GET /data/search?q=query&project=X&limit=10 — text search across observations
  app.get('/search', (c) => {
    const q = c.req.query('q') || '';
    const project = c.req.query('project') || '';
    const limit = parseInt(c.req.query('limit') || '10', 10);

    if (!q) {
      return c.json({ error: 'q query parameter is required' }, 400);
    }

    // Split query into words, each must match title or facts
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const wordClauses = words.map(() => '(LOWER(title) LIKE ? OR LOWER(facts) LIKE ?)').join(' AND ');
    const wordParams = words.flatMap((w) => [`%${w}%`, `%${w}%`]);

    const projectClause = project ? `AND (project = ? OR scope = 'global')` : '';
    const projectParams = project ? [project] : [];

    const sql = `SELECT id, type, title, facts, importance, project, created_at
       FROM observations
       WHERE ${wordClauses} ${projectClause}
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`;

    const rows = state.db.query(sql).all(...wordParams, ...projectParams, limit);

    return c.json(rows);
  });

  // GET /data/sessions?project=X&limit=20
  app.get('/sessions', (c) => {
    const project = c.req.query('project') || '';
    const limit = parseInt(c.req.query('limit') || '20', 10);

    const sessions = project
      ? getRecentSessions(state.db, project, limit)
      : state.db.query('SELECT * FROM sessions ORDER BY created_at_epoch DESC LIMIT ?').all(limit);
    return c.json({ sessions });
  });

  // GET /data/observations?project=X&limit=50&branch=Y&timeExpr=last+3+days
  app.get('/observations', (c) => {
    const project = c.req.query('project') || '';
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const branch = c.req.query('branch') || undefined;
    const timeExpr = c.req.query('timeExpr') || undefined;

    if (timeExpr) {
      const range = parseTimeExpression(timeExpr);
      if (range) {
        const observations = getObservationsByTimeRange(state.db, project, range.start, range.end, { limit });
        return c.json({ observations });
      }
    }

    const observations = getRecentObservations(state.db, project, { limit, branch });
    return c.json({ observations });
  });

  // GET /data/reflections?project=X&type=quick|deep&limit=20
  app.get('/reflections', (c) => {
    const project = c.req.query('project') || '';
    const type = c.req.query('type') || undefined;
    const limit = parseInt(c.req.query('limit') || '20', 10);

    let reflections;
    if (project) {
      reflections = getReflectionsByProject(state.db, project, { type, limit });
    } else if (type) {
      reflections = state.db
        .query('SELECT * FROM reflections WHERE type = ? ORDER BY created_at_epoch DESC LIMIT ?')
        .all(type, limit);
    } else {
      reflections = state.db
        .query('SELECT * FROM reflections ORDER BY created_at_epoch DESC LIMIT ?')
        .all(limit);
    }
    return c.json({ reflections });
  });

  // GET /data/profile?project=X&category=Y
  app.get('/profile', (c) => {
    const project = c.req.query('project') || '';
    const category = c.req.query('category') || undefined;
    const limit = 50;

    let entries;
    if (project) {
      entries = getProfileByProject(state.db, project, { category });
    } else if (category) {
      entries = state.db
        .query('SELECT * FROM developer_profile WHERE category = ? ORDER BY confidence DESC, evidence_count DESC LIMIT ?')
        .all(category, limit);
    } else {
      entries = state.db
        .query('SELECT * FROM developer_profile ORDER BY confidence DESC, evidence_count DESC LIMIT ?')
        .all(limit);
    }
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

    let entities;
    if (project) {
      entities = getEntitiesByProject(state.db, project, { entityType, limit });
    } else if (entityType) {
      entities = state.db
        .query('SELECT * FROM entities WHERE entity_type = ? ORDER BY last_seen_epoch DESC LIMIT ?')
        .all(entityType, limit);
    } else {
      entities = state.db
        .query('SELECT * FROM entities ORDER BY last_seen_epoch DESC LIMIT ?')
        .all(limit);
    }
    return c.json({ entities });
  });

  // GET /data/hotspots?project=X&entityType=Y&limit=20
  app.get('/hotspots', (c) => {
    const project = c.req.query('project') || '';
    const entityType = c.req.query('entityType') || undefined;
    const limit = parseInt(c.req.query('limit') || '20', 10);

    let hotspots;
    if (project) {
      hotspots = getHotspotEntities(state.db, project, { entityType, limit });
    } else if (entityType) {
      hotspots = state.db
        .query('SELECT * FROM entities WHERE entity_type = ? ORDER BY mention_count DESC LIMIT ?')
        .all(entityType, limit);
    } else {
      hotspots = state.db
        .query('SELECT * FROM entities ORDER BY mention_count DESC LIMIT ?')
        .all(limit);
    }
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

  // DELETE /data/observations/:id — delete an observation
  app.delete('/observations/:id', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!id) {
      return c.json({ error: 'Invalid observation ID' }, 400);
    }

    const deleted = deleteObservation(state.db, id);
    if (!deleted) {
      return c.json({ error: 'Observation not found' }, 404);
    }

    return c.json({ ok: true });
  });

  // PUT /data/observations/:id — update an observation
  app.put('/observations/:id', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!id) {
      return c.json({ error: 'Invalid observation ID' }, 400);
    }

    const body = await c.req.json();
    const updated = updateObservation(state.db, id, body);
    if (!updated) {
      return c.json({ error: 'Observation not found' }, 404);
    }

    return c.json(updated);
  });

  // GET /data/entities/:id/relationships — get relationships for an entity
  app.get('/entities/:id/relationships', (c) => {
    const entityId = parseInt(c.req.param('id'), 10);
    if (!entityId) {
      return c.json({ error: 'Invalid entity ID' }, 400);
    }

    const relationships = getRelationships(state.db, entityId);
    return c.json({ relationships });
  });

  // GET /data/entity-graph?project=X — get full entity graph (nodes + edges)
  app.get('/entity-graph', (c) => {
    const project = c.req.query('project') || '';
    if (!project) {
      return c.json({ error: 'project query parameter is required' }, 400);
    }

    const limit = parseInt(c.req.query('limit') || '100', 10);
    const graph = getEntityGraph(state.db, project, { limit });
    return c.json(graph);
  });

  // GET /data/events?project=X — SSE endpoint for live updates
  app.get('/events', (c) => {
    const project = c.req.query('project') || undefined;

    const stream = new ReadableStream({
      start(controller) {
        const client: SSEClient = { controller, project };
        state.sseClients.add(client);

        // Send initial connection event
        const msg = `event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`;
        controller.enqueue(new TextEncoder().encode(msg));

        // Clean up on close — the ReadableStream cancel callback handles disconnection
      },
      cancel() {
        // Client disconnected — clean up handled by broadcastSSE try/catch
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });

  return app;
}
