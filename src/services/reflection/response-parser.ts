import type {
  ReflectionInsight,
  DeepReflectionResult,
} from '../../shared/types.js';

/**
 * Parse quick reflection XML response into structured insights.
 */
export function parseQuickReflectionResponse(
  response: string,
  observationIds: number[],
): ReflectionInsight[] {
  const insights: ReflectionInsight[] = [];

  try {
    // Match individual insight elements
    const insightRegex =
      /<insight\s+category="([^"]*)"(?:\s+confidence="([^"]*)")?\s*>([\s\S]*?)<\/insight>/g;
    let match;

    while ((match = insightRegex.exec(response)) !== null) {
      const category = match[1] as ReflectionInsight['category'];
      const confidence = match[2] ? parseFloat(match[2]) : 0.5;
      const inner = match[3];

      // Extract text
      const textMatch = inner.match(/<text>([\s\S]*?)<\/text>/);
      const text = textMatch ? textMatch[1].trim() : '';
      if (!text) continue;

      // Extract source indices and map to observation IDs
      const sourcesMatch = inner.match(/<sources>([\s\S]*?)<\/sources>/);
      const sourceObservationIds: number[] = [];
      if (sourcesMatch) {
        const indices = sourcesMatch[1]
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n));
        for (const idx of indices) {
          // Convert 1-based index to observation ID
          if (idx >= 1 && idx <= observationIds.length) {
            sourceObservationIds.push(observationIds[idx - 1]);
          }
        }
      }

      // Validate category
      const validCategories = ['pattern', 'lesson', 'warning', 'improvement'];
      if (!validCategories.includes(category)) continue;

      insights.push({
        text,
        category,
        confidence: Math.max(0, Math.min(1, confidence)),
        sourceObservationIds,
      });
    }
  } catch {
    // Return empty on parse failure
  }

  // Limit to 3 insights
  return insights.slice(0, 3);
}

/**
 * Parse deep reflection XML response.
 */
export function parseDeepReflectionResponse(
  response: string,
  observationIds: number[],
): DeepReflectionResult {
  const result: DeepReflectionResult = {
    patterns: [],
    profileUpdates: [],
    warnings: [],
  };

  try {
    // Parse patterns (same format as quick reflection insights)
    const patternsBlock = response.match(
      /<patterns>([\s\S]*?)<\/patterns>/,
    );
    if (patternsBlock) {
      const insightRegex =
        /<insight\s+category="([^"]*)"(?:\s+confidence="([^"]*)")?\s*>([\s\S]*?)<\/insight>/g;
      let match;

      while ((match = insightRegex.exec(patternsBlock[1])) !== null) {
        const category = match[1] as ReflectionInsight['category'];
        const confidence = match[2] ? parseFloat(match[2]) : 0.5;
        const inner = match[3];

        const textMatch = inner.match(/<text>([\s\S]*?)<\/text>/);
        const text = textMatch ? textMatch[1].trim() : '';
        if (!text) continue;

        const sourcesMatch = inner.match(/<sources>([\s\S]*?)<\/sources>/);
        const sourceObservationIds: number[] = [];
        if (sourcesMatch) {
          const indices = sourcesMatch[1]
            .split(',')
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !isNaN(n));
          for (const idx of indices) {
            if (idx >= 1 && idx <= observationIds.length) {
              sourceObservationIds.push(observationIds[idx - 1]);
            }
          }
        }

        const validCategories = [
          'pattern',
          'lesson',
          'warning',
          'improvement',
        ];
        if (!validCategories.includes(category)) continue;

        result.patterns.push({
          text,
          category,
          confidence: Math.max(0, Math.min(1, confidence)),
          sourceObservationIds,
        });
      }
    }

    // Parse profile updates
    const profileBlock = response.match(
      /<profile_updates>([\s\S]*?)<\/profile_updates>/,
    );
    if (profileBlock) {
      const entryRegex =
        /<entry\s+category="([^"]*)"(?:\s+confidence="([^"]*)")?(?:\s+action="([^"]*)")?\s*>([\s\S]*?)<\/entry>/g;
      let match;

      while ((match = entryRegex.exec(profileBlock[1])) !== null) {
        const category =
          match[1] as DeepReflectionResult['profileUpdates'][0]['category'];
        const confidence = match[2] ? parseFloat(match[2]) : 0.5;
        const inner = match[4];

        const descMatch = inner.match(
          /<description>([\s\S]*?)<\/description>/,
        );
        const description = descMatch ? descMatch[1].trim() : '';
        if (!description) continue;

        const evidenceMatch = inner.match(
          /<evidence>([\s\S]*?)<\/evidence>/,
        );
        const evidenceObservationIds: number[] = [];
        if (evidenceMatch) {
          const indices = evidenceMatch[1]
            .split(',')
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !isNaN(n));
          for (const idx of indices) {
            if (idx >= 1 && idx <= observationIds.length) {
              evidenceObservationIds.push(observationIds[idx - 1]);
            }
          }
        }

        const validCategories = [
          'preference',
          'pattern',
          'common_mistake',
          'style',
          'expertise',
        ];
        if (!validCategories.includes(category)) continue;

        result.profileUpdates.push({
          category,
          description,
          confidence: Math.max(0, Math.min(1, confidence)),
          evidenceObservationIds,
        });
      }
    }

    // Parse warnings
    const warningsBlock = response.match(
      /<warnings>([\s\S]*?)<\/warnings>/,
    );
    if (warningsBlock) {
      const warningRegex = /<warning>([\s\S]*?)<\/warning>/g;
      let match;
      while ((match = warningRegex.exec(warningsBlock[1])) !== null) {
        const text = match[1].trim();
        if (text) result.warnings.push(text);
      }
    }
  } catch {
    // Return partial results on parse failure
  }

  return result;
}
