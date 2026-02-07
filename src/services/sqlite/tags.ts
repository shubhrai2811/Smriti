import type { Database } from 'bun:sqlite';

/**
 * Add a tag to an observation. Silently ignores duplicates.
 */
export function addTag(db: Database, observationId: number, tag: string): void {
  const now = Date.now();
  db.run(
    'INSERT OR IGNORE INTO observation_tags (observation_id, tag, created_at_epoch) VALUES (?, ?, ?)',
    [observationId, tag, now]
  );
}

/**
 * Remove a tag from an observation.
 */
export function removeTag(db: Database, observationId: number, tag: string): void {
  db.run(
    'DELETE FROM observation_tags WHERE observation_id = ? AND tag = ?',
    [observationId, tag]
  );
}

/**
 * Get all tags for a specific observation.
 */
export function getTagsByObservation(db: Database, observationId: number): string[] {
  const rows = db.query(
    'SELECT tag FROM observation_tags WHERE observation_id = ? ORDER BY created_at_epoch ASC'
  ).all(observationId) as { tag: string }[];

  return rows.map(r => r.tag);
}

/**
 * Get observation IDs that have a given tag, filtered by project.
 */
export function getObservationsByTag(
  db: Database,
  project: string,
  tag: string,
  limit?: number
): number[] {
  const effectiveLimit = limit ?? 50;

  const rows = db.query(
    `SELECT ot.observation_id FROM observation_tags ot
     INNER JOIN observations o ON o.id = ot.observation_id
     WHERE o.project = ? AND ot.tag = ?
     ORDER BY o.created_at_epoch DESC
     LIMIT ?`
  ).all(project, tag, effectiveLimit) as { observation_id: number }[];

  return rows.map(r => r.observation_id);
}

/**
 * Get all unique tags with counts for a project.
 */
export function getAllTags(
  db: Database,
  project: string
): { tag: string; count: number }[] {
  return db.query(
    `SELECT ot.tag, COUNT(*) as count FROM observation_tags ot
     INNER JOIN observations o ON o.id = ot.observation_id
     WHERE o.project = ?
     GROUP BY ot.tag
     ORDER BY count DESC`
  ).all(project) as { tag: string; count: number }[];
}

/**
 * Update retrieval tracking for observations that were surfaced in context.
 * Batch updates last_retrieved_epoch and increments retrieval_count.
 */
export function updateRetrievalTracking(db: Database, observationIds: number[]): void {
  if (observationIds.length === 0) return;

  const now = Date.now();
  const stmt = db.prepare(
    'UPDATE observations SET last_retrieved_epoch = ?, retrieval_count = COALESCE(retrieval_count, 0) + 1 WHERE id = ?'
  );

  const batchUpdate = db.transaction(() => {
    for (const id of observationIds) {
      stmt.run(now, id);
    }
  });

  batchUpdate();
}
