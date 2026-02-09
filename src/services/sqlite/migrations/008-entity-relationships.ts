import type { Database } from 'bun:sqlite';
import type { Migration } from './runner.js';

export const migration008: Migration = {
  version: 8,
  description: 'Entity relationships for graph edges',
  up: (db: Database) => {
    db.run(`CREATE TABLE IF NOT EXISTS entity_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      target_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL CHECK(relationship_type IN ('imports', 'calls', 'depends_on', 'configures', 'related_to')),
      confidence REAL DEFAULT 0.5,
      evidence_count INTEGER DEFAULT 1,
      first_seen_epoch INTEGER NOT NULL,
      last_seen_epoch INTEGER NOT NULL,
      UNIQUE(source_entity_id, target_entity_id, relationship_type)
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_entity_rel_source ON entity_relationships(source_entity_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_entity_rel_target ON entity_relationships(target_entity_id)');
  },
};
