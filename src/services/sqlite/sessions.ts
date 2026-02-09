import type { Database } from 'bun:sqlite';
import type { SessionRow } from '../../shared/types.js';

export function createSession(
  db: Database,
  opts: {
    contentSessionId: string;
    project: string;
    branch?: string;
    sourceIde?: string;
  },
): SessionRow {
  const now = Date.now();
  const sourceIde = opts.sourceIde ?? 'claude-code';

  db.run(
    `INSERT OR IGNORE INTO sessions (content_session_id, project, branch, source_ide, created_at_epoch)
     VALUES (?, ?, ?, ?, ?)`,
    [opts.contentSessionId, opts.project, opts.branch ?? null, sourceIde, now],
  );

  // biome-ignore lint/style/noNonNullAssertion: guaranteed to exist after insert above
  return getSessionByContentId(db, opts.contentSessionId)!;
}

export function getSessionByContentId(db: Database, contentSessionId: string): SessionRow | null {
  const stmt = db.query('SELECT * FROM sessions WHERE content_session_id = ?');
  return (stmt.get(contentSessionId) as SessionRow) ?? null;
}

export function getSession(db: Database, id: number): SessionRow | null {
  const stmt = db.query('SELECT * FROM sessions WHERE id = ?');
  return (stmt.get(id) as SessionRow) ?? null;
}

export function completeSession(db: Database, id: number): void {
  db.run(`UPDATE sessions SET status = 'completed', completed_at = datetime('now') WHERE id = ?`, [id]);
}

export function incrementPromptCount(db: Database, sessionId: number): number {
  db.run('UPDATE sessions SET prompt_count = prompt_count + 1 WHERE id = ?', [sessionId]);
  const row = db.query('SELECT prompt_count FROM sessions WHERE id = ?').get(sessionId) as {
    prompt_count: number;
  } | null;
  return row?.prompt_count ?? 0;
}

export function getRecentSessions(db: Database, project: string, limit: number = 10): SessionRow[] {
  const stmt = db.query('SELECT * FROM sessions WHERE project = ? ORDER BY created_at_epoch DESC LIMIT ?');
  return stmt.all(project, limit) as SessionRow[];
}
