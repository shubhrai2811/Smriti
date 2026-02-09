import type { Database } from 'bun:sqlite';
import type { MemoryScope, ObservationRow, ObservationType } from '../../shared/types.js';

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
    scope?: MemoryScope;
    promptNumber?: number;
  },
): number {
  const now = Date.now();
  const sourceIde = opts.sourceIde ?? 'claude-code';
  const importance = opts.importance ?? 5;
  const scope = opts.scope ?? 'project';

  const stmt = db.query(
    `INSERT INTO observations
       (session_id, project, branch, source_ide, type, title, facts, concepts, files_affected, importance, scope, prompt_number, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
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
    scope,
    opts.promptNumber ?? null,
    now,
  ) as { id: number };

  return row.id;
}

export function getObservationsBySession(db: Database, sessionId: number): ObservationRow[] {
  const stmt = db.query('SELECT * FROM observations WHERE session_id = ? ORDER BY created_at_epoch ASC');
  return stmt.all(sessionId) as ObservationRow[];
}

export function getRecentObservations(
  db: Database,
  project: string,
  opts: { limit?: number; branch?: string } = {},
): ObservationRow[] {
  const limit = opts.limit ?? 20;

  if (opts.branch) {
    const stmt = db.query(
      "SELECT * FROM observations WHERE (project = ? OR scope = 'global') AND branch = ? ORDER BY created_at_epoch DESC LIMIT ?",
    );
    return stmt.all(project, opts.branch, limit) as ObservationRow[];
  }

  const stmt = db.query(
    "SELECT * FROM observations WHERE (project = ? OR scope = 'global') ORDER BY created_at_epoch DESC LIMIT ?",
  );
  return stmt.all(project, limit) as ObservationRow[];
}

export function getObservation(db: Database, id: number): ObservationRow | null {
  const stmt = db.query('SELECT * FROM observations WHERE id = ?');
  return (stmt.get(id) as ObservationRow) ?? null;
}

export function countObservationsByProject(db: Database, project: string): number {
  const stmt = db.query("SELECT COUNT(*) as count FROM observations WHERE (project = ? OR scope = 'global')");
  const row = stmt.get(project) as { count: number };
  return row.count;
}

export function deleteObservation(db: Database, id: number): boolean {
  // FTS cleanup is handled by the observations_fts_delete trigger (migration 002).
  // CASCADE handles observation_embeddings, entity_mentions, observation_links, observation_tags.
  const result = db.run('DELETE FROM observations WHERE id = ?', [id]);
  return (result as any).changes > 0;
}

export function updateObservation(
  db: Database,
  id: number,
  fields: {
    title?: string;
    facts?: string;
    concepts?: string;
    files_affected?: string;
    importance?: number;
    scope?: string;
    type?: string;
  },
): ObservationRow | null {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (fields.title !== undefined) {
    setClauses.push('title = ?');
    values.push(fields.title);
  }
  if (fields.facts !== undefined) {
    setClauses.push('facts = ?');
    values.push(fields.facts);
  }
  if (fields.concepts !== undefined) {
    setClauses.push('concepts = ?');
    values.push(fields.concepts);
  }
  if (fields.files_affected !== undefined) {
    setClauses.push('files_affected = ?');
    values.push(fields.files_affected);
  }
  if (fields.importance !== undefined) {
    setClauses.push('importance = ?');
    values.push(fields.importance);
  }
  if (fields.scope !== undefined) {
    setClauses.push('scope = ?');
    values.push(fields.scope);
  }
  if (fields.type !== undefined) {
    setClauses.push('type = ?');
    values.push(fields.type);
  }

  if (setClauses.length === 0) return getObservation(db, id);

  values.push(id);
  db.run(`UPDATE observations SET ${setClauses.join(', ')} WHERE id = ?`, values as any[]);

  return getObservation(db, id);
}

export function getObservationsByTimeRange(
  db: Database,
  project: string,
  start: number,
  end: number,
  opts: { limit?: number } = {},
): ObservationRow[] {
  const limit = opts.limit ?? 50;
  const stmt = db.query(
    `SELECT * FROM observations
     WHERE (project = ? OR scope = 'global')
       AND created_at_epoch BETWEEN ? AND ?
     ORDER BY created_at_epoch DESC
     LIMIT ?`,
  );
  return stmt.all(project, start, end, limit) as ObservationRow[];
}
