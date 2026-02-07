import type { Database } from 'bun:sqlite';
import type { Migration } from './runner.js';

export const migration006: Migration = {
  version: 6,
  description: 'Observation tags and retrieval decay tracking',
  up: (db: Database) => {
    // Tags table for manual observation tagging
    db.run(`CREATE TABLE IF NOT EXISTS observation_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL,
      UNIQUE(observation_id, tag)
    )`);

    db.run('CREATE INDEX IF NOT EXISTS idx_tags_observation ON observation_tags(observation_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_tags_tag ON observation_tags(tag)');

    // Add retrieval tracking to observations
    db.run('ALTER TABLE observations ADD COLUMN last_retrieved_epoch INTEGER');
    db.run('ALTER TABLE observations ADD COLUMN retrieval_count INTEGER DEFAULT 0');
  },
};
