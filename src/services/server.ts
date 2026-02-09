import type { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { dirname, join } from 'path';
import { getConfig } from '../shared/config.js';
import type { ObservationBatcher } from './extraction/batcher.js';
import { contextRoutes } from './routes/context-routes.js';
import { dataRoutes } from './routes/data-routes.js';
import { sessionRoutes } from './routes/session-routes.js';
import { settingsRoutes } from './routes/settings-routes.js';
import { archiveOldObservations, getArchivalStats, vacuumDatabase } from './sqlite/archival.js';
import type { SmritiExport } from './sqlite/export-import.js';
import { exportProject, importProject } from './sqlite/export-import.js';

export interface SSEClient {
  controller: ReadableStreamDefaultController;
  project?: string;
}

export interface WorkerState {
  db: Database;
  isReady: boolean;
  startTime: number;
  lastActivityAt: number;
  sseClients: Set<SSEClient>;
  batcher?: ObservationBatcher;
}

/**
 * Broadcast an SSE event to all connected clients.
 * Optionally filter by project.
 */
export function broadcastSSE(state: WorkerState, event: string, data: unknown, project?: string): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of state.sseClients) {
    try {
      if (project && client.project && client.project !== project) continue;
      client.controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      // Client disconnected, remove it
      state.sseClients.delete(client);
    }
  }
}

export function createApp(state: WorkerState): Hono {
  const app = new Hono();

  // CORS for localhost access (web dashboard)
  app.use(
    '*',
    cors({
      origin: ['http://localhost', 'http://127.0.0.1'],
    }),
  );

  // Activity tracker middleware — updates last activity for idle timeout
  app.use('*', async (_c, next) => {
    state.lastActivityAt = Date.now();
    await next();
  });

  // Health check — lightweight, always responds
  app.get('/health', (c) => {
    return c.json({ status: 'ok', uptime: Date.now() - state.startTime });
  });

  // Readiness check — returns 503 until initialization is complete
  app.get('/readiness', (c) => {
    if (!state.isReady) {
      return c.json({ status: 'initializing' }, 503);
    }
    return c.json({ status: 'ready', uptime: Date.now() - state.startTime });
  });

  // Version endpoint
  app.get('/version', (c) => {
    return c.json({
      version: typeof __SMRITI_VERSION__ !== 'undefined' ? __SMRITI_VERSION__ : '0.1.0-dev',
    });
  });

  // Register route modules
  app.route('/sessions', sessionRoutes(state));
  app.route('/context', contextRoutes(state));
  app.route('/data', dataRoutes(state));
  app.route('/settings', settingsRoutes());

  // Web UI — serve the single-page dashboard
  app.get('/ui', (c) => {
    return serveViewerHtml(c);
  });
  app.get('/ui/*', (c) => {
    return serveViewerHtml(c);
  });

  // Admin shutdown endpoint
  app.post('/admin/shutdown', async (c) => {
    const { gracefulShutdown } = await import('../infrastructure/graceful-shutdown.js');
    setTimeout(() => gracefulShutdown(), 100);
    return c.json({ status: 'shutting_down' });
  });

  // Admin maintenance endpoint — archive old observations and optionally vacuum
  app.post('/admin/maintenance', (c) => {
    const config = getConfig();
    const archivalConfig = config.get('archival');
    const project = c.req.query('project') || '';

    if (!project) {
      return c.json({ error: 'project query parameter is required' }, 400);
    }

    const archiveResult = archiveOldObservations(state.db, project, archivalConfig.retentionDays);

    if (archivalConfig.vacuumOnMaintenance) {
      vacuumDatabase(state.db);
    }

    const stats = getArchivalStats(state.db, project);

    return c.json({
      status: 'maintenance_complete',
      archived: archiveResult.archived,
      vacuumed: archivalConfig.vacuumOnMaintenance,
      stats,
    });
  });

  // Admin export endpoint — export all project data as JSON
  app.get('/admin/export', (c) => {
    const project = c.req.query('project') || '';

    if (!project) {
      return c.json({ error: 'project query parameter is required' }, 400);
    }

    const data = exportProject(state.db, project);

    const dateStr = new Date().toISOString().slice(0, 10);
    const safeProject = project.replace(/[^a-zA-Z0-9_-]/g, '_');
    c.header('Content-Disposition', `attachment; filename="smriti-export-${safeProject}-${dateStr}.json"`);

    return c.json(data);
  });

  // Admin import endpoint — restore project data from JSON
  app.post('/admin/import', async (c) => {
    let body: SmritiExport;
    try {
      body = await c.req.json<SmritiExport>();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    if (!body.version || body.version !== 1) {
      return c.json({ error: 'unsupported export version, expected version 1' }, 400);
    }

    if (!body.project) {
      return c.json({ error: 'missing project field in export data' }, 400);
    }

    const result = importProject(state.db, body);

    return c.json({
      status: 'import_complete',
      project: body.project,
      ...result,
    });
  });

  return app;
}

function serveViewerHtml(c: any) {
  // Try multiple paths: relative to script location, then CWD
  const scriptDir = dirname(process.argv[1] || '');
  const candidates = [
    join(scriptDir, 'viewer.html'),
    join(scriptDir, '..', 'scripts', 'viewer.html'),
    join(process.cwd(), 'plugin/scripts/viewer.html'),
  ];

  for (const viewerPath of candidates) {
    try {
      const html = readFileSync(viewerPath, 'utf-8');
      return c.html(html);
    } catch {
      // Try next candidate
    }
  }

  return c.html(
    '<html><body style="font-family:sans-serif;background:#0d1117;color:#c9d1d9;padding:2rem"><h1>Smriti Dashboard</h1><p>UI not built. Run <code>bun run build</code> first.</p></body></html>',
  );
}

// Global declaration for esbuild define replacement
declare const __SMRITI_VERSION__: string;
