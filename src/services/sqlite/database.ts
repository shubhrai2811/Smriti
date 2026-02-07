import { Database } from 'bun:sqlite';
import { mkdirSync, existsSync } from 'fs';
import { DB_PATH, SMRITI_DIR } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import { runMigrations } from './migrations/runner.js';

let _db: Database | null = null;
let _vecLoaded = false;
let _customSqliteSet = false;

/**
 * On macOS, the system SQLite doesn't support extension loading.
 * We need to use Homebrew SQLite instead. This must be called BEFORE
 * any Database constructor.
 */
function ensureCustomSQLite(): void {
  if (_customSqliteSet) return;
  _customSqliteSet = true;

  if (process.platform !== 'darwin') return;

  // Homebrew SQLite paths by architecture
  const paths = [
    '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib', // Apple Silicon
    '/usr/local/opt/sqlite/lib/libsqlite3.dylib',    // Intel Mac
  ];

  for (const libPath of paths) {
    if (existsSync(libPath)) {
      try {
        Database.setCustomSQLite(libPath);
        logger.debug('DATABASE', 'Using Homebrew SQLite for extension support', { path: libPath });
        return;
      } catch (error) {
        logger.debug('DATABASE', 'Failed to set custom SQLite', { path: libPath, error: (error as Error).message });
      }
    }
  }

  logger.debug('DATABASE', 'Homebrew SQLite not found, extension loading may not work');
}

export function getDatabase(dbPath?: string): Database {
  if (_db) return _db;

  const path = dbPath || DB_PATH;
  mkdirSync(SMRITI_DIR, { recursive: true });

  // Must set custom SQLite before creating any Database instance on macOS
  ensureCustomSQLite();

  _db = new Database(path, { create: true });

  // SQLite optimizations
  _db.run('PRAGMA journal_mode=WAL');
  _db.run('PRAGMA synchronous=NORMAL');
  _db.run('PRAGMA foreign_keys=ON');
  _db.run('PRAGMA mmap_size=268435456');
  _db.run('PRAGMA cache_size=10000');

  // Load sqlite-vec extension for vector distance functions
  loadSqliteVec(_db);

  // Run migrations
  runMigrations(_db);

  logger.info('DATABASE', 'Database initialized', { path, vecLoaded: _vecLoaded });
  return _db;
}

function loadSqliteVec(db: Database): void {
  try {
    // sqlite-vec provides getLoadablePath() which returns the path to the native extension
    const sqliteVec = require('sqlite-vec');
    sqliteVec.load(db);
    _vecLoaded = true;
    logger.info('DATABASE', 'sqlite-vec extension loaded');
  } catch (error) {
    _vecLoaded = false;
    logger.warn('DATABASE', 'sqlite-vec extension not available, vector search disabled', {
      error: (error as Error).message,
    });
  }
}

export function isVecLoaded(): boolean {
  return _vecLoaded;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
    _vecLoaded = false;
    logger.info('DATABASE', 'Database closed');
  }
}

// For testing - allow resetting the singleton
export function resetDatabase(): void {
  _db = null;
  _vecLoaded = false;
}

// For testing - load sqlite-vec on an external DB and set the flag
export function loadVecForTest(db: Database): boolean {
  try {
    const sqliteVec = require('sqlite-vec');
    sqliteVec.load(db);
    _vecLoaded = true;
    return true;
  } catch {
    return false;
  }
}
