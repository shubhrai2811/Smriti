import type { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';
import { isVecLoaded } from './database.js';

const EMBEDDING_DIM = 384;

/**
 * Store an embedding for an observation.
 */
export function insertEmbedding(
  db: Database,
  observationId: number,
  embedding: Float32Array,
  model: string = 'all-MiniLM-L6-v2',
): void {
  if (embedding.length !== EMBEDDING_DIM) {
    throw new Error(`Expected ${EMBEDDING_DIM}-dim embedding, got ${embedding.length}`);
  }

  const now = Date.now();
  db.query(
    'INSERT OR REPLACE INTO observation_embeddings (observation_id, embedding, model, created_at_epoch) VALUES (?, ?, ?, ?)',
  ).run(observationId, Buffer.from(embedding.buffer), model, now);
}

/**
 * Get the embedding for an observation.
 */
export function getEmbedding(db: Database, observationId: number): Float32Array | null {
  const row = db.query('SELECT embedding FROM observation_embeddings WHERE observation_id = ?').get(observationId) as {
    embedding: Buffer;
  } | null;

  if (!row) return null;
  return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, EMBEDDING_DIM);
}

/**
 * Check if an observation has an embedding.
 */
export function hasEmbedding(db: Database, observationId: number): boolean {
  const row = db.query('SELECT 1 FROM observation_embeddings WHERE observation_id = ?').get(observationId);
  return row !== null;
}

/**
 * Find similar observations using cosine distance via sqlite-vec scalar functions.
 * Returns observation IDs sorted by similarity (most similar first).
 *
 * Falls back to empty results if sqlite-vec is not loaded.
 */
export function findSimilarByVector(
  db: Database,
  queryEmbedding: Float32Array,
  project: string,
  opts: { limit?: number; excludeIds?: number[] } = {},
): Array<{ observationId: number; distance: number }> {
  if (!isVecLoaded()) {
    logger.debug('VECTORS', 'sqlite-vec not loaded, skipping vector search');
    return [];
  }

  const limit = opts.limit ?? 50;
  const queryBuffer = Buffer.from(queryEmbedding.buffer);

  // Use sqlite-vec's vec_distance_cosine() scalar function for cosine distance
  // Join with observations to filter by project
  let sql = `
    SELECT
      oe.observation_id,
      vec_distance_cosine(oe.embedding, ?) AS distance
    FROM observation_embeddings oe
    JOIN observations o ON o.id = oe.observation_id
    WHERE (o.project = ? OR o.scope = 'global')
  `;
  const params: (Buffer | string | number)[] = [queryBuffer, project];

  if (opts.excludeIds && opts.excludeIds.length > 0) {
    const placeholders = opts.excludeIds.map(() => '?').join(',');
    sql += ` AND oe.observation_id NOT IN (${placeholders})`;
    params.push(...opts.excludeIds);
  }

  sql += ` ORDER BY distance ASC LIMIT ?`;
  params.push(limit);

  try {
    const rows = db.query(sql).all(...params) as Array<{ observation_id: number; distance: number }>;
    return rows.map((r) => ({
      observationId: r.observation_id,
      distance: r.distance,
    }));
  } catch (error) {
    logger.error('VECTORS', 'Vector search failed', { error: (error as Error).message });
    return [];
  }
}

/**
 * Compute cosine similarity from cosine distance.
 * cosine_similarity = 1 - cosine_distance
 */
export function distanceToSimilarity(distance: number): number {
  return 1 - distance;
}

/**
 * Count embeddings for a project.
 */
export function countEmbeddings(db: Database, project: string): number {
  const row = db
    .query(`
    SELECT COUNT(*) as count
    FROM observation_embeddings oe
    JOIN observations o ON o.id = oe.observation_id
    WHERE (o.project = ? OR o.scope = 'global')
  `)
    .get(project) as { count: number };
  return row.count;
}

/**
 * Get observation IDs that are missing embeddings for a project.
 */
export function getUnembeddedObservationIds(db: Database, project: string, limit: number = 100): number[] {
  const rows = db
    .query(`
    SELECT o.id
    FROM observations o
    LEFT JOIN observation_embeddings oe ON o.id = oe.observation_id
    WHERE (o.project = ? OR o.scope = 'global') AND oe.observation_id IS NULL
    ORDER BY o.created_at_epoch DESC
    LIMIT ?
  `)
    .all(project, limit) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}
