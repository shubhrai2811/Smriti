import type { Database } from 'bun:sqlite';
import type { Migration } from './runner.js';

export const migration005: Migration = {
  version: 5,
  description: 'Entity graph and archival support',
  up: (db: Database) => {
    // Entity graph: tracks files, functions, error patterns across observations
    db.run(`CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('file', 'function', 'error_pattern', 'dependency', 'config_key')),
      name TEXT NOT NULL,
      metadata TEXT,
      first_seen_epoch INTEGER NOT NULL,
      last_seen_epoch INTEGER NOT NULL,
      mention_count INTEGER DEFAULT 1,
      UNIQUE(project, entity_type, name)
    )`);

    // Entity mentions: links entities to observations
    db.run(`CREATE TABLE IF NOT EXISTS entity_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
      context TEXT,
      created_at_epoch INTEGER NOT NULL,
      UNIQUE(entity_id, observation_id)
    )`);

    // Archived observations (same schema as observations minus indexes)
    db.run(`CREATE TABLE IF NOT EXISTS archived_observations (
      id INTEGER PRIMARY KEY,
      session_id INTEGER,
      project TEXT NOT NULL,
      branch TEXT,
      source_ide TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      facts TEXT,
      concepts TEXT,
      files_affected TEXT,
      importance INTEGER,
      prompt_number INTEGER,
      created_at TEXT,
      created_at_epoch INTEGER NOT NULL,
      archived_at_epoch INTEGER NOT NULL
    )`);

    db.run('CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project)');
    db.run('CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)');
    db.run('CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity ON entity_mentions(entity_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_entity_mentions_observation ON entity_mentions(observation_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_archived_project ON archived_observations(project)');
  },
};
