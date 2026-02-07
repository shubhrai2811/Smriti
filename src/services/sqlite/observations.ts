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

/**
 * Get observations filtered by branch mode.
 * - 'all': all observations for the project (ignoring branch)
 * - 'branch-only': only observations from the specified branch
 * - 'branch-plus-main': observations from the specified branch + the main/default branch
 */
export function getObservationsByBranchFilter(
  db: Database,
  project: string,
  opts: {
    branch?: string;
    filterMode: 'all' | 'branch-only' | 'branch-plus-main';
    mainBranch?: string;
    limit?: number;
  }
): ObservationRow[] {
  const limit = opts.limit ?? 50;

  switch (opts.filterMode) {
    case 'all':
      return db.query(
        'SELECT * FROM observations WHERE project = ? ORDER BY created_at_epoch DESC LIMIT ?'
      ).all(project, limit) as ObservationRow[];

    case 'branch-only':
      if (!opts.branch) return getRecentObservations(db, project, { limit });
      return db.query(
        'SELECT * FROM observations WHERE project = ? AND branch = ? ORDER BY created_at_epoch DESC LIMIT ?'
      ).all(project, opts.branch, limit) as ObservationRow[];

    case 'branch-plus-main': {
      if (!opts.branch) return getRecentObservations(db, project, { limit });
      const mainBranch = opts.mainBranch ?? 'main';
      return db.query(
        'SELECT * FROM observations WHERE project = ? AND (branch = ? OR branch = ?) ORDER BY created_at_epoch DESC LIMIT ?'
      ).all(project, opts.branch, mainBranch, limit) as ObservationRow[];
    }
  }
}
