import type { Database } from 'bun:sqlite';
import { isVecLoaded } from '../sqlite/database.js';
import { getEmbedding, findSimilarByVector, distanceToSimilarity } from '../sqlite/vectors.js';
import { getObservation } from '../sqlite/observations.js';
import { logger } from '../../utils/logger.js';

/**
 * Check if a newly embedded observation is a near-duplicate of an existing one.
 * If so, merge them: keep the newer observation, combine unique facts,
 * take max importance, and delete the older duplicate.
 *
 * Returns true if the observation was merged (and a duplicate was removed).
 */
export function deduplicateObservation(
  db: Database,
  observationId: number,
  project: string,
  threshold: number,
): boolean {
  if (!isVecLoaded()) return false;

  // 1. Get this observation's embedding
  const embedding = getEmbedding(db, observationId);
  if (!embedding) return false;

  // 2. Find the single closest observation (excluding self) within threshold
  //    cosine distance = 1 - cosine similarity
  //    e.g., threshold 0.95 similarity -> distance < 0.05
  const similar = findSimilarByVector(db, embedding, project, {
    limit: 1,
    excludeIds: [observationId],
  });

  if (similar.length === 0) return false;

  const match = similar[0];
  const similarity = distanceToSimilarity(match.distance);

  if (similarity < threshold) return false;

  // 3. Load both observations
  const newObs = getObservation(db, observationId);
  const oldObs = getObservation(db, match.observationId);

  if (!newObs || !oldObs) return false;

  // 4. Merge data into the newer observation
  const mergedFacts = mergeJsonArrays(newObs.facts, oldObs.facts);
  const mergedConcepts = mergeJsonArrays(newObs.concepts, oldObs.concepts);
  const mergedFiles = mergeJsonArrays(newObs.files_affected, oldObs.files_affected);
  const mergedImportance = Math.max(newObs.importance, oldObs.importance);

  // 5. Atomic: update newer observation + delete older duplicate
  try {
    db.transaction(() => {
      // Update the newer observation with merged data
      db.run(
        `UPDATE observations
         SET facts = ?, concepts = ?, files_affected = ?, importance = ?
         WHERE id = ?`,
        [mergedFacts, mergedConcepts, mergedFiles, mergedImportance, observationId],
      );

      // Delete the older duplicate (CASCADE will clean up embeddings, links, tags)
      db.run('DELETE FROM observations WHERE id = ?', [match.observationId]);
    })();

    logger.info('DEDUP', `Merged observation ${match.observationId} into ${observationId}`, {
      project,
      similarity: similarity.toFixed(4),
      oldId: match.observationId,
      newId: observationId,
    });

    return true;
  } catch (error) {
    logger.error('DEDUP', `Failed to merge observations ${match.observationId} -> ${observationId}`, {
      error: (error as Error).message,
    });
    return false;
  }
}

/**
 * Parse two JSON array strings, merge their elements, deduplicate, and re-stringify.
 * Handles null/empty/invalid inputs gracefully.
 */
function mergeJsonArrays(a: string | null, b: string | null): string {
  const arrA = safeParseArray(a);
  const arrB = safeParseArray(b);

  // Use a Set for deduplication (works for string elements)
  const merged = new Set<string>([...arrA, ...arrB]);
  return JSON.stringify([...merged]);
}

/**
 * Safely parse a JSON string as an array of strings.
 * Returns empty array on null, empty, or invalid input.
 */
function safeParseArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed.map(String);
    return [];
  } catch {
    return [];
  }
}
