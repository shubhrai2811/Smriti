import type { Database } from 'bun:sqlite';
import type { Migration } from './runner.js';

export const migration002: Migration = {
  version: 2,
  description: 'Smart context - observation vectors (sqlite-vec) and FTS5',
  up: (db: Database) => {
    // FTS5 virtual table for keyword search on observations
    // This works with built-in SQLite FTS5 support
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
      title,
      facts,
      concepts,
      content='observations',
      content_rowid='id'
    )`);

    // Triggers to keep FTS5 in sync with observations table
    db.run(`CREATE TRIGGER observations_fts_insert AFTER INSERT ON observations BEGIN
      INSERT INTO observations_fts(rowid, title, facts, concepts)
      VALUES (new.id, new.title, COALESCE(new.facts, ''), COALESCE(new.concepts, ''));
    END`);

    db.run(`CREATE TRIGGER observations_fts_delete AFTER DELETE ON observations BEGIN
      INSERT INTO observations_fts(observations_fts, rowid, title, facts, concepts)
      VALUES ('delete', old.id, old.title, COALESCE(old.facts, ''), COALESCE(old.concepts, ''));
    END`);

    db.run(`CREATE TRIGGER observations_fts_update AFTER UPDATE ON observations BEGIN
      INSERT INTO observations_fts(observations_fts, rowid, title, facts, concepts)
      VALUES ('delete', old.id, old.title, COALESCE(old.facts, ''), COALESCE(old.concepts, ''));
      INSERT INTO observations_fts(rowid, title, facts, concepts)
      VALUES (new.id, new.title, COALESCE(new.facts, ''), COALESCE(new.concepts, ''));
    END`);

    // Observation embeddings table (regular table, not sqlite-vec virtual table)
    // We store embeddings as BLOBs and use sqlite-vec scalar functions for distance calculation
    // This avoids the macOS setCustomSQLite requirement for vec0 virtual tables
    // while still providing fast vector operations via sqlite-vec functions
    db.run(`CREATE TABLE observation_embeddings (
      observation_id INTEGER PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
      embedding BLOB NOT NULL,
      model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
      created_at_epoch INTEGER NOT NULL
    )`);

    db.run('CREATE INDEX idx_obs_embeddings_epoch ON observation_embeddings(created_at_epoch)');
  },
};
