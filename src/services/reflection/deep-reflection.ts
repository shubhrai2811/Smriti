import type { Database } from 'bun:sqlite';
import type { ObservationRow } from '../../shared/types.js';
import { logger } from '../../utils/logger.js';
import type { AIProvider } from '../providers/provider.js';
import {
  findSimilarProfileEntry,
  getProfileByProject,
  insertProfileEntry,
  updateProfileConfidence,
} from '../sqlite/developer-profile.js';
import { insertReflection } from '../sqlite/reflections.js';
import { buildDeepReflectionPrompt } from './prompts.js';
import { parseDeepReflectionResponse } from './response-parser.js';

/**
 * Check if deep reflection should trigger (every N completed sessions).
 */
export function shouldRunDeepReflection(db: Database, project: string, interval: number = 5): boolean {
  const result = db
    .query("SELECT COUNT(*) as count FROM sessions WHERE project = ? AND status = 'completed'")
    .get(project) as { count: number };
  return result.count > 0 && result.count % interval === 0;
}

/**
 * Run deep reflection analyzing observations across recent sessions.
 * Generates cross-session patterns and updates developer profile.
 */
export async function deepReflect(
  db: Database,
  provider: AIProvider,
  project: string,
): Promise<{ patterns: number; profileUpdates: number }> {
  try {
    // Get recent observations across sessions (last 20 sessions worth)
    const observations = db
      .query(
        `SELECT o.* FROM observations o
       JOIN sessions s ON o.session_id = s.id
       WHERE (o.project = ? OR o.scope = 'global') AND s.status = 'completed'
       ORDER BY o.created_at_epoch DESC
       LIMIT 200`,
      )
      .all(project) as ObservationRow[];

    if (observations.length < 5) {
      logger.debug('REFLECTION', 'Skipping deep reflection — too few observations', {
        project,
        count: observations.length,
      });
      return { patterns: 0, profileUpdates: 0 };
    }

    // Get existing profile entries for prompt context
    const existingProfile = getProfileByProject(db, project).map((p) => ({
      category: p.category,
      description: p.description,
      confidence: p.confidence,
    }));

    // Build prompt and call AI
    const prompt = buildDeepReflectionPrompt(observations, existingProfile);
    const response = await provider.extract(prompt, { operation: 'deep_reflection' });

    // Parse response
    const observationIds = observations.map((o) => o.id);
    const result = parseDeepReflectionResponse(response, observationIds);

    // Store pattern insights as reflections
    let patternsStored = 0;
    for (const pattern of result.patterns) {
      insertReflection(db, {
        project,
        type: 'deep',
        insight: pattern.text,
        category: pattern.category,
        sourceObservationIds: JSON.stringify(pattern.sourceObservationIds),
        confidence: pattern.confidence,
      });
      patternsStored++;
    }

    // Process profile updates
    let profileUpdates = 0;
    for (const update of result.profileUpdates) {
      // Check if similar profile entry already exists
      const existing = findSimilarProfileEntry(db, project, update.category, update.description);

      if (existing) {
        // Reinforce existing: bump confidence and evidence count
        const newConfidence = Math.min(1, existing.confidence + 0.1);
        const newEvidence = existing.evidence_count + 1;
        updateProfileConfidence(db, existing.id, newConfidence, newEvidence);
      } else {
        // Create new profile entry
        insertProfileEntry(db, {
          project,
          category: update.category,
          description: update.description,
          confidence: update.confidence,
        });
      }
      profileUpdates++;
    }

    // Log any warnings from the AI response
    for (const warning of result.warnings) {
      logger.warn('REFLECTION', `Deep reflection warning: ${warning}`, {
        project,
      });
    }

    logger.info('REFLECTION', 'Deep reflection complete', {
      project,
      patternsStored,
      profileUpdates,
    });
    return { patterns: patternsStored, profileUpdates };
  } catch (error) {
    logger.error('REFLECTION', 'Deep reflection failed', {
      project,
      error: (error as Error).message,
    });
    return { patterns: 0, profileUpdates: 0 };
  }
}
