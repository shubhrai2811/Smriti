import type { Database } from 'bun:sqlite';
import { migration001 } from './001-foundation.js';

export interface Migration {
  version: number;
  description: string;
  up: (db: Database) => void;
}

const ALL_MIGRATIONS: Migration[] = [migration001];

export function runMigrations(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    description TEXT,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);

  const applied = new Set(
    (db.query('SELECT version FROM schema_versions').all() as { version: number }[])
      .map(r => r.version)
  );

  for (const migration of ALL_MIGRATIONS) {
    if (!applied.has(migration.version)) {
      db.transaction(() => {
        migration.up(db);
        db.run(
          'INSERT INTO schema_versions (version, description) VALUES (?, ?)',
          [migration.version, migration.description]
        );
      })();
    }
  }
}
