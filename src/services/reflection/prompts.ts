import type { ObservationRow } from '../../shared/types.js';

/**
 * Build prompt for quick reflection (end of session).
 * Generates 0-3 insights from session observations.
 */
export function buildQuickReflectionPrompt(
  observations: ObservationRow[],
  summary?: { request?: string; learned?: string; completed?: string } | null,
): string {
  const obsText = observations
    .map((o, i) => {
      const facts = o.facts ? JSON.parse(o.facts).join('; ') : '';
      return `${i + 1}. [${o.type}] ${o.title}${facts ? ` — ${facts}` : ''}`;
    })
    .join('\n');

  const summaryText = summary
    ? `\nSession summary:\n- Request: ${summary.request || 'N/A'}\n- Learned: ${summary.learned || 'N/A'}\n- Completed: ${summary.completed || 'N/A'}`
    : '';

  return `Analyze these observations from a coding session and extract 0-3 key insights.
Only output insights that represent meaningful patterns, lessons, or warnings — not trivial facts.
If nothing insightful, output an empty <reflections/> tag.

Observations:
${obsText}
${summaryText}

Respond with XML:
<reflections>
  <insight category="pattern|lesson|warning|improvement" confidence="0.0-1.0">
    <text>The insight description</text>
    <sources>comma-separated observation indices (1-based)</sources>
  </insight>
</reflections>

Categories:
- pattern: Recurring approach or technique
- lesson: Something learned from a mistake or success
- warning: Potential issue or anti-pattern detected
- improvement: Suggestion for better practice`;
}

/**
 * Build prompt for deep reflection (every N sessions).
 * Analyzes patterns across multiple sessions.
 */
export function buildDeepReflectionPrompt(
  observations: ObservationRow[],
  existingProfile: Array<{
    category: string;
    description: string;
    confidence: number;
  }>,
): string {
  const obsText = observations
    .slice(0, 100)
    .map((o, i) => {
      const concepts = o.concepts ? JSON.parse(o.concepts).join(', ') : '';
      return `${i + 1}. [${o.type}] ${o.title}${concepts ? ` (${concepts})` : ''} [importance:${o.importance}]`;
    })
    .join('\n');

  const profileText =
    existingProfile.length > 0
      ? `\nExisting developer profile:\n${existingProfile.map((p) => `- [${p.category}] ${p.description} (confidence: ${p.confidence})`).join('\n')}`
      : '\nNo existing developer profile yet.';

  return `Analyze these observations from multiple coding sessions to identify cross-session patterns and developer characteristics.
Update or create developer profile entries. Be specific and evidence-based.

Observations (from recent sessions):
${obsText}
${profileText}

Respond with XML:
<deep_reflection>
  <patterns>
    <insight category="pattern|lesson|warning|improvement" confidence="0.0-1.0">
      <text>Cross-session pattern description</text>
      <sources>comma-separated observation indices (1-based)</sources>
    </insight>
  </patterns>
  <profile_updates>
    <entry category="preference|pattern|common_mistake|style|expertise" confidence="0.0-1.0" action="create|update">
      <description>Developer characteristic description</description>
      <evidence>comma-separated observation indices (1-based)</evidence>
    </entry>
  </profile_updates>
  <warnings>
    <warning>Warning text if any</warning>
  </warnings>
</deep_reflection>

Profile categories:
- preference: Tool, library, or approach preferences
- pattern: Recurring coding patterns or habits
- common_mistake: Frequently repeated errors
- style: Code style or naming conventions
- expertise: Areas of demonstrated skill`;
}
