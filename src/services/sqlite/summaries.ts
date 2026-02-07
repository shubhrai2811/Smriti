import type { Database } from 'bun:sqlite';
import type { SummaryRow } from '../../shared/types.js';

export function insertSummary(
  db: Database,
  opts: {
    sessionId: number;
    project: string;
    request?: string;
    learned?: string;
    completed?: string;
    nextSteps?: string;
  }
): number {
  const now = Date.now();

  const stmt = db.query(
    `INSERT INTO summaries
       (session_id, project, request, learned, completed, next_steps, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id`
  );

  const row = stmt.get(
    opts.sessionId,
    opts.project,
    opts.request ?? null,
    opts.learned ?? null,
    opts.completed ?? null,
    opts.nextSteps ?? null,
    now
  ) as { id: number };

  return row.id;
}

export function getLastSummary(
  db: Database,
  project: string
): SummaryRow | null {
  const stmt = db.query(
    'SELECT * FROM summaries WHERE project = ? ORDER BY created_at_epoch DESC LIMIT 1'
  );
  return (stmt.get(project) as SummaryRow) ?? null;
}

export function getSummaryBySession(
  db: Database,
  sessionId: number
): SummaryRow | null {
  const stmt = db.query('SELECT * FROM summaries WHERE session_id = ?');
  return (stmt.get(sessionId) as SummaryRow) ?? null;
}
