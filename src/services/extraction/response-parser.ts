import type { ExtractedObservation, ExtractedSummary, MemoryScope, ObservationType } from '../../shared/types.js';

const VALID_TYPES = new Set<ObservationType>([
  'bugfix',
  'feature',
  'refactor',
  'discovery',
  'decision',
  'pattern',
  'config',
  'dependency',
]);

const VALID_SCOPES = new Set<MemoryScope>(['project', 'global']);

/**
 * Parse XML observations from AI extraction response.
 */
export function parseExtractionResponse(response: string): ExtractedObservation[] {
  const observations: ExtractedObservation[] = [];
  const obsRegex = /<observation>([\s\S]*?)<\/observation>/g;

  for (let match = obsRegex.exec(response); match !== null; match = obsRegex.exec(response)) {
    const xml = match[1];
    const rawType = extractTag(xml, 'type') || 'discovery';
    const type = VALID_TYPES.has(rawType as ObservationType) ? (rawType as ObservationType) : 'discovery';

    const rawScope = extractTag(xml, 'scope') || 'project';
    const scope = VALID_SCOPES.has(rawScope as MemoryScope) ? (rawScope as MemoryScope) : 'project';

    observations.push({
      type,
      title: extractTag(xml, 'title') || 'Untitled observation',
      facts: extractArrayTag(xml, 'facts', 'fact'),
      concepts: extractCsvTag(xml, 'concepts'),
      filesAffected: extractCsvTag(xml, 'files_affected'),
      importance: clamp(parseInt(extractTag(xml, 'importance') || '5', 10), 1, 10),
      scope,
    });
  }

  return observations;
}

/**
 * Parse XML summary from AI response.
 */
export function parseSummaryResponse(response: string): ExtractedSummary | null {
  const summaryMatch = response.match(/<summary>([\s\S]*?)<\/summary>/);
  if (!summaryMatch) return null;

  const xml = summaryMatch[1];
  return {
    request: extractTag(xml, 'request') || '',
    learned: extractTag(xml, 'learned') || '',
    completed: extractTag(xml, 'completed') || '',
    nextSteps: extractTag(xml, 'next_steps') || '',
  };
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].trim() : null;
}

function extractArrayTag(xml: string, container: string, item: string): string[] {
  const containerMatch = xml.match(new RegExp(`<${container}>([\\s\\S]*?)</${container}>`));
  if (!containerMatch) return [];
  const items: string[] = [];
  const itemRegex = new RegExp(`<${item}>([\\s\\S]*?)</${item}>`, 'g');
  for (let m = itemRegex.exec(containerMatch[1]); m !== null; m = itemRegex.exec(containerMatch[1])) {
    const trimmed = m[1].trim();
    if (trimmed) items.push(trimmed);
  }
  return items;
}

function extractCsvTag(xml: string, tag: string): string[] {
  const value = extractTag(xml, tag);
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return 5;
  return Math.min(max, Math.max(min, value));
}
