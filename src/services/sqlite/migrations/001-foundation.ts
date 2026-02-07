import type { Database } from 'bun:sqlite';
import type { Migration } from './runner.js';

export const migration001: Migration = {
  version: 1,
  description: 'Foundation schema - sessions, observations, summaries, prompts, pending_messages',
  up: (db: Database) => {
    // Sessions
    db.run(`CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_session_id TEXT UNIQUE NOT NULL,
      project TEXT NOT NULL,
      branch TEXT,
      source_ide TEXT DEFAULT 'claude-code',
      status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','failed')),
      prompt_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      created_at_epoch INTEGER NOT NULL
    )`);

    db.run('CREATE INDEX idx_sessions_project ON sessions(project)');
    db.run('CREATE INDEX idx_sessions_status ON sessions(status)');
    db.run('CREATE INDEX idx_sessions_created_epoch ON sessions(created_at_epoch)');

    // Observations
    db.run(`CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      project TEXT NOT NULL,
      branch TEXT,
      source_ide TEXT DEFAULT 'claude-code',
      type TEXT NOT NULL CHECK(type IN ('bugfix','feature','refactor','discovery','decision','pattern','config','dependency')),
      title TEXT NOT NULL,
      facts TEXT,
      concepts TEXT,
      files_affected TEXT,
      importance INTEGER DEFAULT 5 CHECK(importance BETWEEN 1 AND 10),
      prompt_number INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      created_at_epoch INTEGER NOT NULL
    )`);

    db.run('CREATE INDEX idx_observations_session ON observations(session_id)');
    db.run('CREATE INDEX idx_observations_project ON observations(project)');
    db.run('CREATE INDEX idx_observations_epoch ON observations(created_at_epoch DESC)');
    db.run('CREATE INDEX idx_observations_importance ON observations(importance DESC)');

    // Summaries
    db.run(`CREATE TABLE summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      project TEXT NOT NULL,
      request TEXT,
      learned TEXT,
      completed TEXT,
      next_steps TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      created_at_epoch INTEGER NOT NULL
    )`);

    db.run('CREATE INDEX idx_summaries_session ON summaries(session_id)');
    db.run('CREATE INDEX idx_summaries_project ON summaries(project)');

    // Prompts
    db.run(`CREATE TABLE prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      prompt_number INTEGER NOT NULL,
      prompt_text TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    )`);

    db.run('CREATE INDEX idx_prompts_session ON prompts(session_id)');

    // Pending messages (work queue)
    db.run(`CREATE TABLE pending_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      content_session_id TEXT NOT NULL,
      message_type TEXT NOT NULL CHECK(message_type IN ('observation','summarize')),
      tool_name TEXT,
      tool_input TEXT,
      tool_response TEXT,
      cwd TEXT,
      last_assistant_message TEXT,
      prompt_number INTEGER,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','failed')),
      retry_count INTEGER DEFAULT 0,
      created_at_epoch INTEGER NOT NULL
    )`);

    db.run('CREATE INDEX idx_pending_session ON pending_messages(session_id)');
    db.run('CREATE INDEX idx_pending_status ON pending_messages(status)');
  },
};
