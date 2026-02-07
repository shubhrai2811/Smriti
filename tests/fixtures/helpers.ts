/**
 * Test helpers for E2E tests.
 * Provides utilities for creating isolated test contexts with temp databases and servers.
 */

import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApp, type WorkerState } from '../../src/services/server.js';
import { runMigrations } from '../../src/services/sqlite/migrations/runner.js';
import { loadVecForTest } from '../../src/services/sqlite/database.js';

// On macOS, use Homebrew SQLite for extension loading support
let _customSqliteSet = false;
function ensureCustomSQLite(): void {
  if (_customSqliteSet) return;
  _customSqliteSet = true;
  if (process.platform !== 'darwin') return;
  const paths = [
    '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib',
    '/usr/local/opt/sqlite/lib/libsqlite3.dylib',
  ];
  for (const libPath of paths) {
    if (existsSync(libPath)) {
      try {
        Database.setCustomSQLite(libPath);
        return;
      } catch { /* ignore */ }
    }
  }
}

export interface TestContext {
  db: Database;
  app: ReturnType<typeof createApp>;
  state: WorkerState;
  baseUrl: string;
  server: ReturnType<typeof Bun.serve>;
  cleanup: () => void;
}

/**
 * Create an isolated test context with a temp database and Hono server.
 *
 * Each test gets:
 * - A fresh SQLite database in a temp directory
 * - A running Hono server on a random port
 * - A cleanup function to tear down resources
 *
 * Usage:
 * ```typescript
 * const ctx = createTestContext();
 * try {
 *   // Run tests using ctx.baseUrl, ctx.db, etc.
 * } finally {
 *   ctx.cleanup();
 * }
 * ```
 */
export function createTestContext(): TestContext {
  const tmpDir = join(tmpdir(), `smriti-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  const dbPath = join(tmpDir, 'test.sqlite');

  // Must set custom SQLite before creating Database on macOS
  ensureCustomSQLite();

  const db = new Database(dbPath, { create: true });
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA synchronous=NORMAL');
  db.run('PRAGMA foreign_keys=ON');

  runMigrations(db);

  // Load sqlite-vec extension for vector distance functions
  loadVecForTest(db);

  const state: WorkerState = {
    db,
    isReady: true,
    startTime: Date.now(),
    lastActivityAt: Date.now(),
  };

  const app = createApp(state);

  const server = Bun.serve({
    port: 0, // Random available port
    hostname: '127.0.0.1',
    fetch: app.fetch,
  });

  const baseUrl = `http://127.0.0.1:${server.port}`;

  return {
    db,
    app,
    state,
    baseUrl,
    server,
    cleanup: () => {
      server.stop(true);
      db.close();
      try {
        rmSync(tmpDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}
