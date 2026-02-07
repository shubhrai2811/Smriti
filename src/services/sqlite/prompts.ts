import type { Database } from 'bun:sqlite';
import type { PromptRow } from '../../shared/types.js';

export function insertPrompt(
  db: Database,
  opts: {
    sessionId: number;
    promptNumber: number;
    promptText: string;
  }
): number {
  const now = Date.now();

  const stmt = db.query(
    `INSERT INTO prompts (session_id, prompt_number, prompt_text, created_at_epoch)
     VALUES (?, ?, ?, ?)
     RETURNING id`
  );

  const row = stmt.get(
    opts.sessionId,
    opts.promptNumber,
    opts.promptText,
    now
  ) as { id: number };

  return row.id;
}

export function getPromptsBySession(
  db: Database,
  sessionId: number
): PromptRow[] {
  const stmt = db.query(
    'SELECT * FROM prompts WHERE session_id = ? ORDER BY prompt_number ASC'
  );
  return stmt.all(sessionId) as PromptRow[];
}

export function getLastPrompt(
  db: Database,
  sessionId: number
): PromptRow | null {
  const stmt = db.query(
    'SELECT * FROM prompts WHERE session_id = ? ORDER BY prompt_number DESC LIMIT 1'
  );
  return (stmt.get(sessionId) as PromptRow) ?? null;
}
