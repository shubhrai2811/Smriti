import type { Database } from 'bun:sqlite';

export interface InsertProfileEntryParams {
  project?: string | null; // null = global
  category: 'preference' | 'pattern' | 'common_mistake' | 'style' | 'expertise';
  description: string;
  confidence?: number;
  evidenceCount?: number;
  sourceReflectionIds?: string | null; // JSON array
}

export interface ProfileEntryRow {
  id: number;
  project: string | null;
  category: string;
  description: string;
  confidence: number;
  evidence_count: number;
  source_reflection_ids: string | null;
  created_at: string;
  created_at_epoch: number;
  updated_at_epoch: number;
}

export function insertProfileEntry(db: Database, params: InsertProfileEntryParams): number {
  const now = Date.now();
  db.query(
    `INSERT INTO developer_profile (project, category, description, confidence, evidence_count, source_reflection_ids, created_at_epoch, updated_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.project ?? null,
    params.category,
    params.description,
    params.confidence ?? 0.5,
    params.evidenceCount ?? 1,
    params.sourceReflectionIds ?? null,
    now,
    now,
  );
  return (db.query('SELECT last_insert_rowid() as id').get() as any).id;
}

export function getProfileEntry(db: Database, id: number): ProfileEntryRow | null {
  return db.query('SELECT * FROM developer_profile WHERE id = ?').get(id) as ProfileEntryRow | null;
}

export function getProfileByProject(db: Database, project: string, opts?: { category?: string; limit?: number }): ProfileEntryRow[] {
  const category = opts?.category;
  const limit = opts?.limit ?? 50;
  // Return project-specific + global entries
  if (category) {
    return db.query(
      'SELECT * FROM developer_profile WHERE (project = ? OR project IS NULL) AND category = ? ORDER BY confidence DESC, evidence_count DESC LIMIT ?'
    ).all(project, category, limit) as ProfileEntryRow[];
  }
  return db.query(
    'SELECT * FROM developer_profile WHERE (project = ? OR project IS NULL) ORDER BY confidence DESC, evidence_count DESC LIMIT ?'
  ).all(project, limit) as ProfileEntryRow[];
}

export function updateProfileConfidence(db: Database, id: number, confidence: number, evidenceCount: number, sourceReflectionIds?: string): void {
  const now = Date.now();
  if (sourceReflectionIds) {
    db.query('UPDATE developer_profile SET confidence = ?, evidence_count = ?, source_reflection_ids = ?, updated_at_epoch = ? WHERE id = ?')
      .run(confidence, evidenceCount, sourceReflectionIds, now, id);
  } else {
    db.query('UPDATE developer_profile SET confidence = ?, evidence_count = ?, updated_at_epoch = ? WHERE id = ?')
      .run(confidence, evidenceCount, now, id);
  }
}

export function findSimilarProfileEntry(db: Database, project: string | null, category: string, descriptionFragment: string): ProfileEntryRow | null {
  // Simple keyword match — finds existing profile entry with similar description
  const projClause = project ? '(project = ? OR project IS NULL)' : 'project IS NULL';
  const params = project
    ? [project, category, `%${descriptionFragment.slice(0, 50)}%`]
    : [category, `%${descriptionFragment.slice(0, 50)}%`];
  return db.query(
    `SELECT * FROM developer_profile WHERE ${projClause} AND category = ? AND description LIKE ? LIMIT 1`
  ).get(...params) as ProfileEntryRow | null;
}

export function countProfileEntries(db: Database, project?: string): number {
  if (project) {
    return (db.query('SELECT COUNT(*) as count FROM developer_profile WHERE project = ? OR project IS NULL').get(project) as any).count;
  }
  return (db.query('SELECT COUNT(*) as count FROM developer_profile').get() as any).count;
}
