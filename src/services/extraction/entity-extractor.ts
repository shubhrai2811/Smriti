import type { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';
import { upsertRelationship } from '../sqlite/entity-relationships.js';

/**
 * Extract entities (files, functions, error patterns, dependencies, config keys)
 * from a stored observation and record them in the entity graph.
 *
 * Non-blocking, best-effort — failures are logged but not thrown.
 */
export function extractEntities(
  db: Database,
  observationId: number,
  observation: {
    project: string;
    type: string;
    title: string;
    facts: string[];
    concepts: string[];
    filesAffected: string[];
  },
): void {
  try {
    const { project } = observation;

    // Extract file entities from filesAffected
    for (const file of observation.filesAffected) {
      if (!file || file.length < 2) continue;
      const entityId = upsertEntity(db, project, 'file', file, getFileMetadata(file));
      addMention(db, entityId, observationId, `affected in ${observation.type}`);
    }

    // Extract error patterns from facts (lines mentioning errors/exceptions)
    for (const fact of observation.facts) {
      const errorPattern = extractErrorPattern(fact);
      if (errorPattern) {
        const entityId = upsertEntity(db, project, 'error_pattern', errorPattern);
        addMention(db, entityId, observationId, fact.slice(0, 200));
      }
    }

    // Extract dependencies from dependency-type observations
    if (observation.type === 'dependency') {
      const depNames = extractDependencyNames(observation.title, observation.facts);
      for (const dep of depNames) {
        const entityId = upsertEntity(db, project, 'dependency', dep);
        addMention(db, entityId, observationId, observation.title);
      }
    }

    // Extract config keys from config-type observations
    if (observation.type === 'config') {
      const configKeys = extractConfigKeys(observation.title, observation.facts);
      for (const key of configKeys) {
        const entityId = upsertEntity(db, project, 'config_key', key);
        addMention(db, entityId, observationId, observation.title);
      }
    }

    // Extract function names from facts and title
    const allText = [observation.title, ...observation.facts].join(' ');
    const functions = extractFunctionNames(allText);
    for (const fn of functions) {
      const entityId = upsertEntity(db, project, 'function', fn);
      addMention(db, entityId, observationId, observation.title.slice(0, 200));
    }

    // Extract relationships between entities
    extractRelationships(db, project, observation);
  } catch (error) {
    logger.debug('ENTITY_EXTRACTOR', `Entity extraction failed for observation ${observationId}`, {
      error: (error as Error).message,
    });
  }
}

/**
 * Upsert an entity — insert or increment mention_count + update last_seen.
 * Returns the entity ID.
 */
function upsertEntity(db: Database, project: string, entityType: string, name: string, metadata?: string): number {
  const now = Date.now();

  // Try update first (more common path after initial creation)
  const updated = db
    .query(
      `UPDATE entities SET mention_count = mention_count + 1, last_seen_epoch = ?
     WHERE project = ? AND entity_type = ? AND name = ?`,
    )
    .run(now, project, entityType, name);

  if ((updated as any).changes > 0) {
    const row = db
      .query('SELECT id FROM entities WHERE project = ? AND entity_type = ? AND name = ?')
      .get(project, entityType, name) as { id: number };
    return row.id;
  }

  // Insert new entity
  db.query(
    `INSERT OR IGNORE INTO entities (project, entity_type, name, metadata, first_seen_epoch, last_seen_epoch, mention_count)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  ).run(project, entityType, name, metadata ?? null, now, now);

  const row = db
    .query('SELECT id FROM entities WHERE project = ? AND entity_type = ? AND name = ?')
    .get(project, entityType, name) as { id: number };
  return row.id;
}

/**
 * Add an entity mention for an observation (idempotent via UNIQUE constraint).
 */
function addMention(db: Database, entityId: number, observationId: number, context?: string): void {
  db.query(
    `INSERT OR IGNORE INTO entity_mentions (entity_id, observation_id, context, created_at_epoch)
     VALUES (?, ?, ?, ?)`,
  ).run(entityId, observationId, context ?? null, Date.now());
}

// --- Pattern extractors ---

/** Get file metadata (extension, language guess) */
function getFileMetadata(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    rb: 'ruby',
    css: 'css',
    html: 'html',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
  };
  const lang = langMap[ext];
  return lang ? JSON.stringify({ extension: ext, language: lang }) : JSON.stringify({ extension: ext });
}

/** Extract error/exception patterns from a fact string */
function extractErrorPattern(fact: string): string | null {
  // Match common error class names
  const errorClassMatch = fact.match(/\b([A-Z][a-zA-Z]*(?:Error|Exception|Failure|Fault))\b/);
  if (errorClassMatch) return errorClassMatch[1];

  // Match "error:" or "Error:" prefixed messages (take first ~60 chars)
  const errorMsgMatch = fact.match(/\b(?:error|Error|ERROR):\s*(.{10,60})/);
  if (errorMsgMatch) return errorMsgMatch[1].trim().replace(/[.!,;]+$/, '');

  return null;
}

/** Extract dependency/package names */
function extractDependencyNames(title: string, facts: string[]): string[] {
  const names = new Set<string>();
  const allText = [title, ...facts].join(' ');

  // npm/bun packages: word patterns like @scope/package or package-name
  const pkgMatches = allText.matchAll(/\b(@[a-z0-9_-]+\/[a-z0-9_.-]+|[a-z][a-z0-9_.-]{1,50})\b/g);
  for (const m of pkgMatches) {
    const name = m[1];
    // Skip common English words that look like packages
    if (name.length > 2 && !COMMON_WORDS.has(name)) {
      names.add(name);
    }
  }

  return [...names].slice(0, 10); // Cap at 10
}

/** Extract config keys from config-type observations */
function extractConfigKeys(title: string, facts: string[]): string[] {
  const keys = new Set<string>();
  const allText = [title, ...facts].join(' ');

  // Match KEY=value or key: value patterns
  const kvMatches = allText.matchAll(/\b([A-Z_][A-Z0-9_]{2,})\s*[=:]/g);
  for (const m of kvMatches) {
    keys.add(m[1]);
  }

  // Match dotted config paths like worker.port, extraction.batchSize
  const dottedMatches = allText.matchAll(/\b([a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+)\b/g);
  for (const m of dottedMatches) {
    keys.add(m[1]);
  }

  return [...keys].slice(0, 10);
}

/** Extract function/method names from text */
function extractFunctionNames(text: string): string[] {
  const names = new Set<string>();

  // Match function-call patterns: functionName( or method.name(
  const fnMatches = text.matchAll(/\b([a-z_$][a-zA-Z0-9_$]{2,50})\s*\(/g);
  for (const m of fnMatches) {
    const name = m[1];
    // Skip common keywords and language constructs
    if (!FUNCTION_SKIPLIST.has(name) && !COMMON_WORDS.has(name)) {
      names.add(name);
    }
  }

  return [...names].slice(0, 10);
}

const COMMON_WORDS = new Set([
  'the',
  'and',
  'for',
  'that',
  'this',
  'with',
  'from',
  'not',
  'was',
  'are',
  'but',
  'can',
  'has',
  'had',
  'been',
  'will',
  'use',
  'new',
  'all',
  'get',
  'set',
  'add',
  'run',
  'try',
  'let',
  'var',
  'any',
  'each',
  'then',
]);

/**
 * Extract relationships between entities in an observation.
 * Best-effort — creates edges between co-mentioned entities.
 */
function extractRelationships(
  db: Database,
  project: string,
  observation: {
    type: string;
    title: string;
    facts: string[];
    filesAffected: string[];
  },
): void {
  try {
    // File-to-file relationships: when multiple files are mentioned together
    if (observation.filesAffected.length >= 2) {
      const fileEntities: number[] = [];
      for (const file of observation.filesAffected) {
        if (!file || file.length < 2) continue;
        const row = db
          .query('SELECT id FROM entities WHERE project = ? AND entity_type = ? AND name = ?')
          .get(project, 'file', file) as { id: number } | null;
        if (row) fileEntities.push(row.id);
      }

      // Create 'related_to' edges between co-mentioned files
      for (let i = 0; i < fileEntities.length; i++) {
        for (let j = i + 1; j < fileEntities.length; j++) {
          upsertRelationship(db, {
            sourceEntityId: fileEntities[i],
            targetEntityId: fileEntities[j],
            relationshipType: 'related_to',
            confidence: 0.5,
          });
        }
      }
    }

    // Dependency-type: file depends_on dependency
    if (observation.type === 'dependency') {
      const depNames = extractDependencyNames(observation.title, observation.facts);
      for (const dep of depNames) {
        const depEntity = db
          .query('SELECT id FROM entities WHERE project = ? AND entity_type = ? AND name = ?')
          .get(project, 'dependency', dep) as { id: number } | null;
        if (!depEntity) continue;

        // Link files to this dependency
        for (const file of observation.filesAffected) {
          if (!file || file.length < 2) continue;
          const fileEntity = db
            .query('SELECT id FROM entities WHERE project = ? AND entity_type = ? AND name = ?')
            .get(project, 'file', file) as { id: number } | null;
          if (fileEntity) {
            upsertRelationship(db, {
              sourceEntityId: fileEntity.id,
              targetEntityId: depEntity.id,
              relationshipType: 'depends_on',
              confidence: 0.6,
            });
          }
        }
      }
    }

    // Function-to-file: link extracted functions to their file context
    const allText = [observation.title, ...observation.facts].join(' ');
    const fnNames = extractFunctionNames(allText);
    for (const fn of fnNames) {
      const fnEntity = db
        .query('SELECT id FROM entities WHERE project = ? AND entity_type = ? AND name = ?')
        .get(project, 'function', fn) as { id: number } | null;
      if (!fnEntity) continue;

      for (const file of observation.filesAffected) {
        if (!file || file.length < 2) continue;
        const fileEntity = db
          .query('SELECT id FROM entities WHERE project = ? AND entity_type = ? AND name = ?')
          .get(project, 'file', file) as { id: number } | null;
        if (fileEntity) {
          upsertRelationship(db, {
            sourceEntityId: fnEntity.id,
            targetEntityId: fileEntity.id,
            relationshipType: 'calls',
            confidence: 0.4,
          });
        }
      }
    }
  } catch (error) {
    // Non-critical, don't propagate
    logger.debug('ENTITY_EXTRACTOR', 'Relationship extraction failed (non-critical)', {
      error: (error as Error).message,
    });
  }
}

const FUNCTION_SKIPLIST = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'typeof',
  'instanceof',
  'require',
  'import',
  'export',
  'function',
  'class',
  'const',
  'let',
  'var',
  'async',
  'await',
  'yield',
  'throw',
  'delete',
  'void',
  'new',
  'super',
  'expect',
  'describe',
  'test',
  'log',
  'warn',
  'error',
  'info',
  'debug',
  'console',
  'process',
  'parseInt',
  'parseFloat',
  'isNaN',
  'toString',
  'stringify',
  'parse',
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'slice',
  'map',
  'filter',
  'reduce',
  'forEach',
  'find',
  'some',
  'every',
  'includes',
  'indexOf',
  'join',
  'split',
  'trim',
  'replace',
  'match',
  'Math',
  'Date',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Promise',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
]);
