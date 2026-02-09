import type { Database } from 'bun:sqlite';
import type { MemoryScope } from '../../shared/types.js';

export interface InsertReflectionParams {
  sessionId?: number | null;
  project: string;
  type: 'quick' | 'deep';
  insight: string;
  category?: string | null;
  sourceObservationIds?: string | null; // JSON array
  confidence?: number;
  scope?: MemoryScope;
}

export interface ReflectionRow {
  id: number;
  session_id: number | null;
  project: string;
  type: string;
  insight: string;
  category: string | null;
  source_observation_ids: string | null;
  confidence: number;
  scope: string;
  created_at: string;
  created_at_epoch: number;
}

export function insertReflection(db: Database, params: InsertReflectionParams): number {
  db.query(
    `INSERT INTO reflections (session_id, project, type, insight, category, source_observation_ids, confidence, scope, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    params.sessionId ?? null,
    params.project,
    params.type,
    params.insight,
    params.category ?? null,
    params.sourceObservationIds ?? null,
    params.confidence ?? 0.5,
    params.scope ?? 'project',
    Date.now(),
  );
  return (db.query('SELECT last_insert_rowid() as id').get() as any).id;
}

export function getReflection(db: Database, id: number): ReflectionRow | null {
  return db.query('SELECT * FROM reflections WHERE id = ?').get(id) as ReflectionRow | null;
}

export function getReflectionsByProject(
  db: Database,
  project: string,
  opts?: { type?: string; limit?: number },
): ReflectionRow[] {
  const type = opts?.type;
  const limit = opts?.limit ?? 20;
  if (type) {
    return db
      .query(
        "SELECT * FROM reflections WHERE (project = ? OR scope = 'global') AND type = ? ORDER BY created_at_epoch DESC LIMIT ?",
      )
      .all(project, type, limit) as ReflectionRow[];
  }
  return db
    .query("SELECT * FROM reflections WHERE (project = ? OR scope = 'global') ORDER BY created_at_epoch DESC LIMIT ?")
    .all(project, limit) as ReflectionRow[];
}

export function getReflectionsBySession(db: Database, sessionId: number): ReflectionRow[] {
  return db
    .query('SELECT * FROM reflections WHERE session_id = ? ORDER BY created_at_epoch DESC')
    .all(sessionId) as ReflectionRow[];
}

export function countReflections(db: Database, project: string): number {
  return (
    db.query("SELECT COUNT(*) as count FROM reflections WHERE (project = ? OR scope = 'global')").get(project) as any
  ).count;
}
