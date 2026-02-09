import type { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';
import type { AIProvider } from '../providers/provider.js';
import { getObservationsBySession } from '../sqlite/observations.js';
import { insertReflection } from '../sqlite/reflections.js';
import { getSummaryBySession } from '../sqlite/summaries.js';
import { buildQuickReflectionPrompt } from './prompts.js';
import { parseQuickReflectionResponse } from './response-parser.js';

/**
 * Generate quick reflections at the end of a session.
 * Non-blocking, best-effort -- failures are logged but not thrown.
 */
export async function quickReflect(
  db: Database,
  provider: AIProvider,
  sessionId: number,
  project: string,
): Promise<number> {
  try {
    const observations = getObservationsBySession(db, sessionId);
    if (observations.length < 2) {
      logger.debug('REFLECTION', 'Skipping quick reflection -- too few observations', {
        sessionId,
        count: observations.length,
      });
      return 0;
    }

    // Get summary if available
    const summary = getSummaryBySession(db, sessionId);

    // Build prompt and call AI — convert null fields to undefined for type compat
    const summaryArg = summary
      ? {
          request: summary.request ?? undefined,
          learned: summary.learned ?? undefined,
          completed: summary.completed ?? undefined,
        }
      : null;
    const prompt = buildQuickReflectionPrompt(observations, summaryArg);
    const response = await provider.extract(prompt, { sessionId, operation: 'quick_reflection' });

    // Parse insights
    const observationIds = observations.map((o) => o.id);
    const insights = parseQuickReflectionResponse(response, observationIds);

    if (insights.length === 0) {
      logger.debug('REFLECTION', 'Quick reflection produced no insights', { sessionId });
      return 0;
    }

    // Store reflections
    let stored = 0;
    for (const insight of insights) {
      insertReflection(db, {
        sessionId,
        project,
        type: 'quick',
        insight: insight.text,
        category: insight.category,
        sourceObservationIds: JSON.stringify(insight.sourceObservationIds),
        confidence: insight.confidence,
      });
      stored++;
    }

    logger.info('REFLECTION', `Quick reflection: ${stored} insights`, { sessionId });
    return stored;
  } catch (error) {
    logger.error('REFLECTION', 'Quick reflection failed', {
      sessionId,
      error: (error as Error).message,
    });
    return 0;
  }
}
