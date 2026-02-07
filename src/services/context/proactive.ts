import type { Database } from 'bun:sqlite';
import { hybridSearch, type ScoredObservation } from './search.js';
import { estimateTokens } from './token-counter.js';
import { updateRetrievalTracking } from '../sqlite/tags.js';
import { getConfig } from '../../shared/config.js';
import { logger } from '../../utils/logger.js';

export interface ProactiveContextOptions {
  project: string;
  prompt: string;
  promptEmbedding?: Float32Array;
  branch?: string;
}

/**
 * Build a concise proactive context block for mid-session injection.
 *
 * Searches for highly relevant past observations based on the current prompt,
 * filtering to those above the configured similarity threshold. Returns a
 * compact markdown string, or null if no observations meet the bar.
 *
 * This is intentionally much shorter than session-start context — it only
 * surfaces observations that are directly relevant to the current prompt.
 */
export function buildProactiveContext(
  db: Database,
  options: ProactiveContextOptions,
): string | null {
  const { project, prompt, promptEmbedding, branch } = options;
  const config = getConfig();
  const proactiveConfig = config.get('proactive');
  const scoring = config.get('scoring');

  if (!proactiveConfig.enabled) return null;

  // Need either embedding or text for search
  if (!promptEmbedding && !prompt) return null;

  let scoredObservations: ScoredObservation[];
  try {
    scoredObservations = hybridSearch(db, {
      project,
      queryText: prompt,
      queryEmbedding: promptEmbedding,
      weights: {
        vector: scoring.vectorWeight,
        recency: scoring.recencyWeight,
        importance: scoring.importanceWeight,
      },
      dedupeThreshold: scoring.dedupeThreshold,
      limit: proactiveConfig.maxObservations * 3, // fetch more to filter
    });
  } catch (error) {
    logger.debug('PROACTIVE', 'Hybrid search failed for proactive context', {
      error: (error as Error).message,
    });
    return null;
  }

  // Filter to observations above the similarity threshold.
  // We check vectorSimilarity since that best captures semantic relevance.
  // When vector search is not available, fall back to composite score threshold.
  const hasVectorSignals = scoredObservations.some(s => s.signals.vectorSimilarity > 0);

  const relevant = scoredObservations.filter(scored => {
    if (hasVectorSignals) {
      return scored.signals.vectorSimilarity >= proactiveConfig.minSimilarity;
    }
    // Fallback: use composite score with a scaled threshold
    // Composite scores are typically lower (0-1 weighted sum), so scale threshold
    return scored.score >= proactiveConfig.minSimilarity * 0.6;
  });

  if (relevant.length === 0) return null;

  // Take at most maxObservations
  const selected = relevant.slice(0, proactiveConfig.maxObservations);

  // Format as concise markdown
  const header = '## Relevant memories for this task\n\n';
  let tokensUsed = estimateTokens(header);
  const lines: string[] = [];
  const retrievedIds: number[] = [];

  for (const scored of selected) {
    const obs = scored.observation;
    let line = `- **[${obs.type}]** ${obs.title}`;

    // Add files affected if available (concise)
    if (obs.files_affected) {
      try {
        const files = JSON.parse(obs.files_affected) as string[];
        if (files.length > 0) {
          const fileList = files.slice(0, 3).join(', ');
          line += ` -- affects ${fileList}`;
        }
      } catch { /* ignore parse errors */ }
    }

    const lineTokens = estimateTokens(line + '\n');
    if (tokensUsed + lineTokens > proactiveConfig.tokenBudget) break;

    lines.push(line);
    retrievedIds.push(obs.id);
    tokensUsed += lineTokens;
  }

  if (lines.length === 0) return null;

  // Track retrieval
  if (retrievedIds.length > 0) {
    try {
      updateRetrievalTracking(db, retrievedIds);
    } catch (error) {
      logger.debug('PROACTIVE', 'Failed to update retrieval tracking', {
        error: (error as Error).message,
      });
    }
  }

  const context = header + lines.join('\n') + '\n';

  logger.debug('PROACTIVE', 'Built proactive context', {
    project,
    observations: lines.length,
    tokens: tokensUsed,
  });

  return context;
}
