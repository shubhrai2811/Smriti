import type { Database } from 'bun:sqlite';
import type { ObservationRow } from '../../shared/types.js';
import { getRecentObservations } from '../sqlite/observations.js';

export function findGotchas(
  db: Database,
  filesBeingTouched: string[],
  project: string,
  minImportance: number = 7,
): ObservationRow[] {
  if (filesBeingTouched.length === 0) return [];

  const allObs = getRecentObservations(db, project, { limit: 200 });
  return allObs.filter(obs => {
    if (obs.importance < minImportance) return false;
    if (!['bugfix', 'decision', 'pattern'].includes(obs.type)) return false;
    const files: string[] = obs.files_affected ? JSON.parse(obs.files_affected) : [];
    return files.some((f: string) => filesBeingTouched.some(t =>
      f.endsWith(t) || t.endsWith(f) || f.includes(t) || t.includes(f)
    ));
  });
}

export function formatGotchaWarning(gotchas: ObservationRow[]): string {
  if (gotchas.length === 0) return '';
  const lines = gotchas.map(g => {
    const facts: string[] = g.facts ? JSON.parse(g.facts) : [];
    return `- **[${g.type}]** ${g.title}${facts[0] ? ': ' + facts[0] : ''}`;
  });
  return `### Gotchas for files you're touching\n\n${lines.join('\n')}\n`;
}
