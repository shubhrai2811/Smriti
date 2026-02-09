import type { Database } from 'bun:sqlite';
import type { ObservationRow } from '../../shared/types.js';

export type MaskLevel = 'full' | 'brief' | 'minimal';

/**
 * Determine the mask level for an observation based on how many sessions ago it was created.
 * - full: 0-2 sessions ago (title + facts + concepts + files)
 * - brief: 3-5 sessions ago (title + first fact)
 * - minimal: 6+ sessions ago (title only)
 */
export function getMaskLevel(sessionAge: number, briefThreshold: number = 3, minimalThreshold: number = 6): MaskLevel {
  if (sessionAge < briefThreshold) return 'full';
  if (sessionAge < minimalThreshold) return 'brief';
  return 'minimal';
}

/**
 * Count how many completed sessions exist after the given session (for the same project).
 * Returns 0 for the most recent session, 1 for one session ago, etc.
 */
export function getSessionAge(db: Database, sessionId: number, project: string): number {
  const result = db
    .query(
      `SELECT COUNT(*) as count FROM sessions
     WHERE project = ? AND status = 'completed' AND id > ?`,
    )
    .get(project, sessionId) as { count: number };
  return result.count;
}

/**
 * Format an observation with masking applied based on its age.
 */
export function maskObservation(obs: ObservationRow, level: MaskLevel): string {
  const typeTag = `[${obs.type}]`;
  const importanceMarker = obs.importance >= 8 ? '**' : '';

  switch (level) {
    case 'full': {
      const title = importanceMarker ? `${importanceMarker}${obs.title}${importanceMarker}` : obs.title;
      const parts = [typeTag, title];
      if (obs.facts) {
        try {
          const facts = JSON.parse(obs.facts) as string[];
          if (facts.length > 0) parts.push(`\n  Facts: ${facts.join('; ')}`);
        } catch {}
      }
      if (obs.concepts) {
        try {
          const concepts = JSON.parse(obs.concepts) as string[];
          if (concepts.length > 0) parts.push(`\n  Concepts: ${concepts.join(', ')}`);
        } catch {}
      }
      if (obs.files_affected) {
        try {
          const files = JSON.parse(obs.files_affected) as string[];
          if (files.length > 0) parts.push(`\n  Files: ${files.join(', ')}`);
        } catch {}
      }
      return parts.join(' ');
    }
    case 'brief': {
      const parts = [typeTag, obs.title];
      if (obs.facts) {
        try {
          const facts = JSON.parse(obs.facts) as string[];
          if (facts.length > 0) parts.push(`— ${facts[0]}`);
        } catch {}
      }
      return parts.join(' ');
    }
    case 'minimal':
      return `${typeTag} ${obs.title}`;
  }
}
