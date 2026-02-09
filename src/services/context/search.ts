import type { Database } from 'bun:sqlite';
import type { ObservationRow } from '../../shared/types.js';
import { logger } from '../../utils/logger.js';
import { isVecLoaded } from '../sqlite/database.js';
import { normalizeRank, searchByKeyword } from '../sqlite/fts.js';
import { getObservation } from '../sqlite/observations.js';
import { distanceToSimilarity, findSimilarByVector } from '../sqlite/vectors.js';

export interface ScoredObservation {
  observation: ObservationRow;
  score: number;
  signals: {
    vectorSimilarity: number;
    keywordRelevance: number;
    recencyDecay: number;
    importanceNorm: number;
  };
}

export interface SearchWeights {
  vector: number; // default 0.5
  keyword: number; // default 0.0 (only used when query has keywords)
  recency: number; // default 0.3
  importance: number; // default 0.2
}

export interface HybridSearchOptions {
  project: string;
  queryText?: string;
  queryEmbedding?: Float32Array;
  weights?: Partial<SearchWeights>;
  limit?: number;
  dedupeThreshold?: number; // cosine similarity threshold for dedup (default 0.92)
}

const DEFAULT_WEIGHTS: SearchWeights = {
  vector: 0.5,
  keyword: 0.0,
  recency: 0.3,
  importance: 0.2,
};

/**
 * Compute recency decay score. More recent = higher score.
 * Uses exponential decay with a half-life of 7 days.
 */
export function recencyDecay(createdAtEpoch: number, nowEpoch?: number): number {
  const now = nowEpoch ?? Date.now();
  const ageMs = now - createdAtEpoch;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const halfLifeDays = 7;
  return 0.5 ** (ageDays / halfLifeDays);
}

/**
 * Normalize importance from 1-10 scale to 0-1.
 */
export function normalizeImportance(importance: number): number {
  return Math.max(0, Math.min(1, importance / 10));
}

/**
 * Perform hybrid search combining multiple signals.
 *
 * When queryEmbedding is provided:
 *   score = weights.vector * vectorSimilarity
 *         + weights.recency * recencyDecay
 *         + weights.importance * importanceNorm
 *
 * When queryText is provided (for FTS5):
 *   The keyword signal replaces some of the vector weight
 *
 * Falls back to recency + importance when no embedding available.
 */
export function hybridSearch(db: Database, options: HybridSearchOptions): ScoredObservation[] {
  const { project, queryText, queryEmbedding, limit = 30, dedupeThreshold = 0.92 } = options;

  const weights: SearchWeights = {
    ...DEFAULT_WEIGHTS,
    ...options.weights,
  };

  // Collect candidate observation IDs from multiple sources
  const candidateScores = new Map<
    number,
    {
      vectorSimilarity: number;
      keywordRelevance: number;
    }
  >();

  // Source 1: Vector similarity search
  if (queryEmbedding && isVecLoaded()) {
    const vectorResults = findSimilarByVector(db, queryEmbedding, project, { limit: 50 });
    for (const result of vectorResults) {
      const similarity = distanceToSimilarity(result.distance);
      candidateScores.set(result.observationId, {
        vectorSimilarity: similarity,
        keywordRelevance: 0,
      });
    }
  }

  // Source 2: FTS5 keyword search
  if (queryText) {
    try {
      // Sanitize query for FTS5 - escape special characters
      const sanitized = sanitizeFtsQuery(queryText);
      if (sanitized) {
        const ftsResults = searchByKeyword(db, sanitized, project, { limit: 50 });
        for (const result of ftsResults) {
          const existing = candidateScores.get(result.observationId);
          const keywordScore = normalizeRank(result.rank);
          if (existing) {
            existing.keywordRelevance = keywordScore;
          } else {
            candidateScores.set(result.observationId, {
              vectorSimilarity: 0,
              keywordRelevance: keywordScore,
            });
          }
        }
      }
    } catch (error) {
      logger.debug('SEARCH', 'FTS5 search failed, continuing with vector results', {
        error: (error as Error).message,
      });
    }
  }

  // Source 3: If no vector/keyword results, fall back to recent observations
  if (candidateScores.size === 0) {
    const recent = db
      .query(
        "SELECT id FROM observations WHERE (project = ? OR scope = 'global') ORDER BY created_at_epoch DESC LIMIT ?",
      )
      .all(project, 50) as Array<{ id: number }>;

    for (const row of recent) {
      candidateScores.set(row.id, {
        vectorSimilarity: 0,
        keywordRelevance: 0,
      });
    }
  }

  // Score all candidates
  const scored: ScoredObservation[] = [];
  const now = Date.now();

  for (const [obsId, signals] of candidateScores) {
    const observation = getObservation(db, obsId);
    if (!observation) continue;

    const recency = recencyDecay(observation.created_at_epoch, now);
    const importanceNorm = normalizeImportance(observation.importance);

    // Compute composite score
    // If we have keyword results, redistribute weights
    let effectiveWeights = { ...weights };
    if (queryText && signals.keywordRelevance > 0) {
      // When keyword matches exist, give them some weight from the vector portion
      effectiveWeights = {
        vector: weights.vector * 0.7,
        keyword: weights.vector * 0.3,
        recency: weights.recency,
        importance: weights.importance,
      };
    }

    const score =
      effectiveWeights.vector * signals.vectorSimilarity +
      effectiveWeights.keyword * signals.keywordRelevance +
      effectiveWeights.recency * recency +
      effectiveWeights.importance * importanceNorm;

    scored.push({
      observation,
      score,
      signals: {
        vectorSimilarity: signals.vectorSimilarity,
        keywordRelevance: signals.keywordRelevance,
        recencyDecay: recency,
        importanceNorm,
      },
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Deduplicate: if two observations are very similar, keep the higher-scored one
  // We check title similarity as a proxy when embeddings aren't available
  const deduped = deduplicateResults(scored, dedupeThreshold);

  // Return top N
  return deduped.slice(0, limit);
}

/**
 * Deduplicate results by checking for near-identical titles.
 * In Phase 2 with embeddings, we could use cosine similarity.
 * For now, simple title similarity check.
 */
function deduplicateResults(scored: ScoredObservation[], _threshold: number): ScoredObservation[] {
  const kept: ScoredObservation[] = [];
  const seenTitles = new Set<string>();

  for (const item of scored) {
    const normalizedTitle = item.observation.title.toLowerCase().trim();

    // Check if we already have a very similar title
    let isDupe = false;
    for (const seen of seenTitles) {
      if (titleSimilarity(normalizedTitle, seen) > 0.85) {
        isDupe = true;
        break;
      }
    }

    if (!isDupe) {
      kept.push(item);
      seenTitles.add(normalizedTitle);
    }
  }

  return kept;
}

/**
 * Simple title similarity using Jaccard index on word sets.
 */
function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Sanitize a query string for FTS5 MATCH syntax.
 * Removes special FTS5 operators and wraps terms.
 */
function sanitizeFtsQuery(query: string): string {
  // Remove FTS5 special characters
  const cleaned = query
    .replace(/[*:"^(){}[\]\\]/g, ' ')
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, ' ')
    .trim();

  if (!cleaned) return '';

  // Split into words and join with spaces (implicit AND in FTS5)
  const words = cleaned.split(/\s+/).filter((w) => w.length > 1);
  return words.join(' ');
}
