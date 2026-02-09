import type { Database } from 'bun:sqlite';
import { migration001 } from './001-foundation.js';
import { migration002 } from './002-smart-context.js';
import { migration003 } from './003-reflection.js';
import { migration004 } from './004-token-tracking.js';
import { migration005 } from './005-entity-graph.js';
import { migration006 } from './006-tags-decay.js';
import { migration007 } from './007-global-scope.js';
import { migration008 } from './008-entity-relationships.js';

export interface Migration {
  version: number;
  description: string;
  up: (db: Database) => void;
}

const ALL_MIGRATIONS: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
];

export function runMigrations(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    description TEXT,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);

  const applied = new Set(
    (db.query('SELECT version FROM schema_versions').all() as { version: number }[]).map((r) => r.version),
  );

  for (const migration of ALL_MIGRATIONS) {
    if (!applied.has(migration.version)) {
      db.transaction(() => {
        // Re-check inside transaction — another process may have applied this
        // migration concurrently (e.g., daemon + hook both calling getDatabase())
        const alreadyApplied = db
          .query('SELECT 1 FROM schema_versions WHERE version = ?')
          .get(migration.version);
        if (alreadyApplied) return;

        migration.up(db);
        db.run('INSERT OR IGNORE INTO schema_versions (version, description) VALUES (?, ?)', [
          migration.version,
          migration.description,
        ]);
      })();
    }
  }
}
