import type { Database } from 'bun:sqlite';
import { getObservationsByBranchFilter } from '../sqlite/observations.js';
import { getLastSummary } from '../sqlite/summaries.js';
import { getProfileByProject } from '../sqlite/developer-profile.js';
import { getReflectionsByProject } from '../sqlite/reflections.js';
import { hybridSearch, type ScoredObservation } from './search.js';
import { formatObservation, formatSummary, formatEmptyState } from './formatter.js';
import { getMaskLevel, getSessionAge, maskObservation } from './masking.js';
import { estimateTokens } from './token-counter.js';
import { getConfig } from '../../shared/config.js';
import { logger } from '../../utils/logger.js';
import { updateRetrievalTracking } from '../sqlite/tags.js';

export interface ContextBuildOptions {
  project: string;
  branch?: string;
  prompt?: string;
  promptEmbedding?: Float32Array;
  tokenBudget: number;
  showInlineSummary: boolean;
}

/**
 * Build context markdown for injection into a new Claude Code session.
 *
 * Uses hybrid search (vector + FTS5 + recency + importance) when embeddings
 * are available. Falls back to recency + importance sorting otherwise.
 */
export function buildContext(
  db: Database,
  options: ContextBuildOptions,
): string {
  const { project, branch, prompt, promptEmbedding, tokenBudget, showInlineSummary } = options;

  const lastSummary = getLastSummary(db, project);

  // Try hybrid search first
  let scoredObservations: ScoredObservation[] = [];
  const useHybridSearch = promptEmbedding || prompt;

  if (useHybridSearch) {
    try {
      const config = getConfig();
      const scoring = config.get('scoring');

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
        limit: 50,
      });
    } catch (error) {
      logger.debug('CONTEXT', 'Hybrid search failed, falling back to recency', {
        error: (error as Error).message,
      });
    }
  }

  // Fallback: recency + importance sort with branch filtering
  if (scoredObservations.length === 0) {
    const config = getConfig();
    const branchConfig = config.get('branch');
    const observations = getObservationsByBranchFilter(db, project, {
      branch,
      filterMode: branchConfig.filterMode,
      mainBranch: branchConfig.defaultBranch,
      limit: 50,
    });
    scoredObservations = observations.map(obs => ({
      observation: obs,
      score: 0,
      signals: { vectorSimilarity: 0, keywordRelevance: 0, recencyDecay: 0, importanceNorm: 0 },
    }));
    // Sort: recency first, importance as tiebreaker
    scoredObservations.sort((a, b) => {
      const epochDiff = b.observation.created_at_epoch - a.observation.created_at_epoch;
      if (epochDiff !== 0) return epochDiff;
      return b.observation.importance - a.observation.importance;
    });
  }

  // Empty state
  if (scoredObservations.length === 0 && !lastSummary) {
    return formatEmptyState(project);
  }

  const sections: string[] = [];
  let tokensUsed = 0;

  // Header
  const header = `## Memory Context for ${project}\n\n`;
  tokensUsed += estimateTokens(header);
  sections.push(header);

  // Last session summary (always included if available, high value)
  if (lastSummary) {
    const summarySection = formatSummary(lastSummary);
    const summaryTokens = estimateTokens(summarySection);
    if (tokensUsed + summaryTokens < tokenBudget) {
      sections.push(summarySection + '\n');
      tokensUsed += summaryTokens;
    }
  }

  // Developer profile (if entries exist)
  const profileEntries = getProfileByProject(db, project, { limit: 10 });
  if (profileEntries.length > 0) {
    const profileLines = profileEntries.map(p =>
      `- **[${p.category}]** ${p.description} _(confidence: ${p.confidence.toFixed(1)})_`
    );
    const profileSection = `### Developer Profile\n\n${profileLines.join('\n')}\n\n`;
    const profileTokens = estimateTokens(profileSection);
    if (tokensUsed + profileTokens < tokenBudget) {
      sections.push(profileSection);
      tokensUsed += profileTokens;
    }
  }

  // Recent insights from reflections
  const reflections = getReflectionsByProject(db, project, { limit: 5 });
  if (reflections.length > 0) {
    const insightLines = reflections.map(r =>
      `- ${r.insight}${r.category ? ` _(${r.category})_` : ''}`
    );
    const insightsSection = `### Insights\n\n${insightLines.join('\n')}\n\n`;
    const insightsTokens = estimateTokens(insightsSection);
    if (tokensUsed + insightsTokens < tokenBudget) {
      sections.push(insightsSection);
      tokensUsed += insightsTokens;
    }
  }

  // Observations (fill remaining budget, already scored/sorted)
  let observationCount = 0;
  const observationSections: string[] = [];
  const retrievedObservationIds: number[] = [];

  for (const scored of scoredObservations) {
    const config = getConfig();
    const maskingEnabled = config.get('masking', 'enabled');
    let obsSection: string;
    if (maskingEnabled) {
      const sessionAge = getSessionAge(db, scored.observation.session_id, project);
      const level = getMaskLevel(sessionAge, config.get('masking', 'briefThreshold'), config.get('masking', 'minimalThreshold'));
      obsSection = `- ${maskObservation(scored.observation, level)}\n`;
    } else {
      obsSection = formatObservation(scored.observation);
    }
    const obsTokens = estimateTokens(obsSection);

    if (tokensUsed + obsTokens > tokenBudget) break;

    observationSections.push(obsSection);
    retrievedObservationIds.push(scored.observation.id);
    tokensUsed += obsTokens;
    observationCount++;
  }

  if (observationSections.length > 0) {
    const sectionHeader = useHybridSearch && scoredObservations.some(s => s.signals.vectorSimilarity > 0)
      ? '### Relevant Observations\n\n'
      : '### Recent Observations\n\n';
    sections.push(sectionHeader);
    sections.push(...observationSections);
  }

  // Track which observations were surfaced in this context build
  if (retrievedObservationIds.length > 0) {
    try {
      updateRetrievalTracking(db, retrievedObservationIds);
    } catch (error) {
      logger.debug('CONTEXT', 'Failed to update retrieval tracking', {
        error: (error as Error).message,
      });
    }
  }

  // Inline summary footer
  if (showInlineSummary) {
    const searchType = useHybridSearch ? 'hybrid' : 'recency';
    // Detect multi-IDE sources
    const sourceIdes = new Set(scoredObservations.map(s => s.observation.source_ide).filter(Boolean));
    const sourceSuffix = sourceIdes.size > 1 ? ` | sources: ${[...sourceIdes].join(', ')}` : '';
    sections.push(`\n[smriti: ${observationCount} observations | ${tokensUsed.toLocaleString()} tokens | ${searchType}${sourceSuffix}]`);
  }

  return sections.join('');
}
