import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Database } from 'bun:sqlite';
import { sessionRoutes } from './routes/session-routes.js';
import { contextRoutes } from './routes/context-routes.js';
import { dataRoutes } from './routes/data-routes.js';
import { settingsRoutes } from './routes/settings-routes.js';
import { logger } from '../utils/logger.js';

export interface WorkerState {
  db: Database;
  isReady: boolean;
  startTime: number;
  lastActivityAt: number;
}

export function createApp(state: WorkerState): Hono {
  const app = new Hono();

  // CORS for localhost access (web dashboard)
  app.use('*', cors({
    origin: ['http://localhost', 'http://127.0.0.1'],
  }));

  // Activity tracker middleware — updates last activity for idle timeout
  app.use('*', async (c, next) => {
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

  // Admin shutdown endpoint
  app.post('/admin/shutdown', async (c) => {
    const { gracefulShutdown } = await import('../infrastructure/graceful-shutdown.js');
    setTimeout(() => gracefulShutdown(), 100);
    return c.json({ status: 'shutting_down' });
  });

  return app;
}

// Global declaration for esbuild define replacement
declare const __SMRITI_VERSION__: string;
