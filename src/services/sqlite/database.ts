import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { DB_PATH, SMRITI_DIR } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import { runMigrations } from './migrations/runner.js';

let _db: Database | null = null;

export function getDatabase(dbPath?: string): Database {
  if (_db) return _db;

  const path = dbPath || DB_PATH;
  mkdirSync(SMRITI_DIR, { recursive: true });

  _db = new Database(path, { create: true });

  // SQLite optimizations
  _db.run('PRAGMA journal_mode=WAL');
  _db.run('PRAGMA synchronous=NORMAL');
  _db.run('PRAGMA foreign_keys=ON');
  _db.run('PRAGMA mmap_size=268435456');
  _db.run('PRAGMA cache_size=10000');

  // Run migrations
  runMigrations(_db);

  logger.info('DATABASE', 'Database initialized', { path });
  return _db;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
    logger.info('DATABASE', 'Database closed');
  }
}

// For testing - allow resetting the singleton
export function resetDatabase(): void {
  _db = null;
}
