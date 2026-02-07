import type { Database } from 'bun:sqlite';
import type { Migration } from './runner.js';

export const migration004: Migration = {
  version: 4,
  description: 'Token usage tracking for cost monitoring',
  up: (db: Database) => {
    db.run(`CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('extraction','summary','quick_reflection','deep_reflection')),
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0,
      model TEXT,
      created_at_epoch INTEGER NOT NULL
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_token_usage_provider ON token_usage(provider)');
    db.run('CREATE INDEX IF NOT EXISTS idx_token_usage_epoch ON token_usage(created_at_epoch)');
  },
};
