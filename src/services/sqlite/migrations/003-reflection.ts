import type { Database } from 'bun:sqlite';
import type { Migration } from './runner.js';

export const migration003: Migration = {
  version: 3,
  description: 'Reflection system - reflections, developer profile, observation links',
  up: (db: Database) => {
    // Reflections table
    db.run(`CREATE TABLE IF NOT EXISTS reflections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
      project TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('quick', 'deep')),
      insight TEXT NOT NULL,
      category TEXT CHECK(category IN ('pattern', 'lesson', 'warning', 'improvement')),
      source_observation_ids TEXT,
      confidence REAL DEFAULT 0.5,
      created_at TEXT DEFAULT (datetime('now')),
      created_at_epoch INTEGER NOT NULL
    )`);

    // Developer profile
    db.run(`CREATE TABLE IF NOT EXISTS developer_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT,
      category TEXT NOT NULL CHECK(category IN ('preference', 'pattern', 'common_mistake', 'style', 'expertise')),
      description TEXT NOT NULL,
      confidence REAL DEFAULT 0.5 CHECK(confidence BETWEEN 0 AND 1),
      evidence_count INTEGER DEFAULT 1,
      source_reflection_ids TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      created_at_epoch INTEGER NOT NULL,
      updated_at_epoch INTEGER NOT NULL
    )`);

    // Observation links (Zettelkasten)
    db.run(`CREATE TABLE IF NOT EXISTS observation_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
      target_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL CHECK(link_type IN ('related', 'caused_by', 'fixed_by', 'evolved_into')),
      confidence REAL DEFAULT 0.5,
      created_at_epoch INTEGER NOT NULL,
      UNIQUE(source_id, target_id, link_type)
    )`);

    // Indexes
    db.run('CREATE INDEX IF NOT EXISTS idx_reflections_project ON reflections(project)');
    db.run('CREATE INDEX IF NOT EXISTS idx_reflections_session ON reflections(session_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_reflections_type ON reflections(type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_profile_project ON developer_profile(project)');
    db.run('CREATE INDEX IF NOT EXISTS idx_profile_category ON developer_profile(category)');
    db.run('CREATE INDEX IF NOT EXISTS idx_links_source ON observation_links(source_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_links_target ON observation_links(target_id)');
  },
};
