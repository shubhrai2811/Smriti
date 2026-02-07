import type { Database } from 'bun:sqlite';
import type { ObservationRow, ObservationType } from '../../shared/types.js';

export function insertObservation(
  db: Database,
  opts: {
    sessionId: number;
    project: string;
    branch?: string;
    sourceIde?: string;
    type: ObservationType;
    title: string;
    facts?: string;
    concepts?: string;
    filesAffected?: string;
    importance?: number;
    promptNumber?: number;
  }
): number {
  const now = Date.now();
  const sourceIde = opts.sourceIde ?? 'claude-code';
  const importance = opts.importance ?? 5;

  const stmt = db.query(
    `INSERT INTO observations
       (session_id, project, branch, source_ide, type, title, facts, concepts, files_affected, importance, prompt_number, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`
  );

  const row = stmt.get(
    opts.sessionId,
    opts.project,
    opts.branch ?? null,
    sourceIde,
    opts.type,
    opts.title,
    opts.facts ?? null,
    opts.concepts ?? null,
    opts.filesAffected ?? null,
    importance,
    opts.promptNumber ?? null,
    now
  ) as { id: number };

  return row.id;
}

export function getObservationsBySession(
  db: Database,
  sessionId: number
): ObservationRow[] {
  const stmt = db.query(
    'SELECT * FROM observations WHERE session_id = ? ORDER BY created_at_epoch ASC'
  );
  return stmt.all(sessionId) as ObservationRow[];
}

export function getRecentObservations(
  db: Database,
  project: string,
  opts: { limit?: number; branch?: string } = {}
): ObservationRow[] {
  const limit = opts.limit ?? 20;

  if (opts.branch) {
    const stmt = db.query(
      'SELECT * FROM observations WHERE project = ? AND branch = ? ORDER BY created_at_epoch DESC LIMIT ?'
    );
    return stmt.all(project, opts.branch, limit) as ObservationRow[];
  }

  const stmt = db.query(
    'SELECT * FROM observations WHERE project = ? ORDER BY created_at_epoch DESC LIMIT ?'
  );
  return stmt.all(project, limit) as ObservationRow[];
}

export function getObservation(
  db: Database,
  id: number
): ObservationRow | null {
  const stmt = db.query('SELECT * FROM observations WHERE id = ?');
  return (stmt.get(id) as ObservationRow) ?? null;
}

export function countObservationsByProject(
  db: Database,
  project: string
): number {
  const stmt = db.query(
    'SELECT COUNT(*) as count FROM observations WHERE project = ?'
  );
  const row = stmt.get(project) as { count: number };
  return row.count;
}
