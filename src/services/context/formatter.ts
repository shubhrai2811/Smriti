import type { ObservationRow, SummaryRow } from '../../shared/types.js';

export function formatObservation(obs: ObservationRow): string {
  const importanceIndicator = obs.importance >= 8 ? ' **' : obs.importance >= 6 ? ' *' : '';
  const facts = safeParseArray(obs.facts);
  const files = safeParseArray(obs.files_affected);

  let result = `- **[${obs.type}]** ${obs.title}${importanceIndicator}\n`;

  if (facts.length > 0) {
    result += `${facts.map((f) => `  - ${f}`).join('\n')}\n`;
  }

  if (files.length > 0) {
    result += `  _Files: ${files.join(', ')}_\n`;
  }

  return result;
}

export function formatSummary(summary: SummaryRow): string {
  let result = '### Last Session Summary\n';
  if (summary.request) result += `- **Request:** ${summary.request}\n`;
  if (summary.completed) result += `- **Completed:** ${summary.completed}\n`;
  if (summary.learned) result += `- **Learned:** ${summary.learned}\n`;
  if (summary.next_steps && summary.next_steps !== 'None') {
    result += `- **Next steps:** ${summary.next_steps}\n`;
  }
  return result;
}

export function formatEmptyState(project: string): string {
  return `## Memory Context for ${project}\n\n_No previous sessions recorded. Smriti will start building context as you work._\n`;
}

function safeParseArray(jsonStr: string | null): string[] {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
