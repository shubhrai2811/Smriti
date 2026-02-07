import type { Database } from 'bun:sqlite';
import { findSimilarByVector, getEmbedding, distanceToSimilarity } from '../sqlite/vectors.js';
import { insertLink } from '../sqlite/observation-links.js';
import { isVecLoaded } from '../sqlite/database.js';
import { logger } from '../../utils/logger.js';

/**
 * Auto-link a newly embedded observation to similar existing observations.
 * Creates 'related' links for observations with cosine similarity above threshold.
 *
 * Non-blocking, best-effort -- failures are logged but not thrown.
 *
 * @param db - Database instance
 * @param observationId - The newly embedded observation to link from
 * @param project - Project to scope the search
 * @param threshold - Minimum cosine similarity to create a link (default 0.85)
 * @param maxLinks - Maximum number of links to create per observation (default 5)
 * @returns Number of links created
 */
export function autoLink(
  db: Database,
  observationId: number,
  project: string,
  threshold: number = 0.85,
  maxLinks: number = 5,
): number {
  if (!isVecLoaded()) return 0;

  try {
    // Get the embedding for this observation
    const embedding = getEmbedding(db, observationId);
    if (!embedding) return 0;

    // Find similar observations (excluding self)
    const similar = findSimilarByVector(db, embedding, project, {
      limit: maxLinks + 1, // +1 buffer in case of edge cases
      excludeIds: [observationId],
    });

    let linksCreated = 0;
    for (const result of similar) {
      const similarity = distanceToSimilarity(result.distance);
      if (similarity < threshold) break; // Results sorted by distance ASC, so we can stop early

      insertLink(db, {
        sourceId: observationId,
        targetId: result.observationId,
        linkType: 'related',
        confidence: similarity,
      });
      linksCreated++;

      if (linksCreated >= maxLinks) break;
    }

    if (linksCreated > 0) {
      logger.debug('AUTOLINKER', `Linked observation ${observationId} to ${linksCreated} similar observations`, { project });
    }

    return linksCreated;
  } catch (error) {
    logger.error('AUTOLINKER', `Auto-linking failed for observation ${observationId}`, {
      error: (error as Error).message,
    });
    return 0;
  }
}
