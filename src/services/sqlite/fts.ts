import type { Database } from 'bun:sqlite';

/**
 * Search observations using FTS5 full-text search.
 * Returns observation IDs with BM25 relevance scores.
 */
export function searchByKeyword(
  db: Database,
  query: string,
  project: string,
  opts: { limit?: number } = {},
): Array<{ observationId: number; rank: number }> {
  const limit = opts.limit ?? 50;

  // FTS5 MATCH query with BM25 ranking
  // Join with observations table to filter by project
  const rows = db.query(`
    SELECT
      fts.rowid AS observation_id,
      rank AS rank
    FROM observations_fts fts
    JOIN observations o ON o.id = fts.rowid
    WHERE observations_fts MATCH ?
      AND o.project = ?
    ORDER BY rank
    LIMIT ?
  `).all(query, project, limit) as Array<{ observation_id: number; rank: number }>;

  return rows.map(r => ({
    observationId: r.observation_id,
    rank: r.rank,
  }));
}

/**
 * Normalize FTS5 BM25 rank to a 0-1 similarity score.
 * FTS5 rank is negative (more negative = better match).
 * We normalize using: score = min(1, -rank / maxRank)
 */
export function normalizeRank(rank: number, maxRank: number = 20): number {
  if (rank >= 0) return 0;
  return Math.min(1, -rank / maxRank);
}
