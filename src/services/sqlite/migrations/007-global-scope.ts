import type { Database } from 'bun:sqlite';
import type { Migration } from './runner.js';

export const migration007: Migration = {
  version: 7,
  description: 'Global vs project memory scope',
  up: (db: Database) => {
    // Add scope column to observations
    db.run(`ALTER TABLE observations ADD COLUMN scope TEXT DEFAULT 'project' CHECK(scope IN ('project', 'global'))`);
    db.run('CREATE INDEX IF NOT EXISTS idx_observations_scope ON observations(scope)');

    // Add scope column to reflections
    db.run(`ALTER TABLE reflections ADD COLUMN scope TEXT DEFAULT 'project' CHECK(scope IN ('project', 'global'))`);
    db.run('CREATE INDEX IF NOT EXISTS idx_reflections_scope ON reflections(scope)');

    // Add scope column to archived_observations
    db.run(`ALTER TABLE archived_observations ADD COLUMN scope TEXT DEFAULT 'project'`);
  },
};
