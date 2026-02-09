/**
 * E2E tests for P1/P2/P3 enhancement features.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { generateClaudeMdSection } from '../../src/services/claudemd/generator';
import {
  getRelatedEntities,
  getRelationships,
  upsertRelationship,
} from '../../src/services/sqlite/entity-relationships';
import {
  deleteObservation,
  getObservation,
  getObservationsByTimeRange,
  insertObservation,
  updateObservation,
} from '../../src/services/sqlite/observations';
import { createSession } from '../../src/services/sqlite/sessions';
import { getConfig, resetConfig } from '../../src/shared/config';
import { parseTimeExpression } from '../../src/utils/time-expressions';
import { createTestContext, type TestContext } from '../fixtures/helpers';

describe('P1: CLAUDE.md Integration', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
    resetConfig();
  });

  it('claudemd is enabled by default', () => {
    const config = getConfig();
    expect(config.get('claudemd', 'enabled')).toBe(true);
  });

  it('generates CLAUDE.md section with global subsection', () => {
    const session = createSession(ctx.db, {
      contentSessionId: 'test-1',
      project: 'test-project',
    });

    // Insert a global observation
    insertObservation(ctx.db, {
      sessionId: session.id,
      project: 'test-project',
      type: 'pattern',
      title: 'Always use TypeScript strict mode',
      facts: JSON.stringify(['Enable strict in tsconfig.json']),
      importance: 8,
      scope: 'global',
    });

    // Insert a project observation
    insertObservation(ctx.db, {
      sessionId: session.id,
      project: 'test-project',
      type: 'decision',
      title: 'Use Hono for API layer',
      facts: JSON.stringify(['Hono is lighter than Express']),
      importance: 9,
    });

    const section = generateClaudeMdSection(ctx.db, 'test-project');
    expect(section).toContain('<!-- smriti-context:start -->');
    expect(section).toContain('<!-- smriti-context:end -->');
    expect(section).toContain('Global Preferences');
    expect(section).toContain('[global]');
    expect(section).toContain('Always use TypeScript strict mode');
    expect(section).toContain('Use Hono for API layer');
  });
});

describe('P1: Observation Delete & Edit', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('deleteObservation removes an observation', () => {
    const session = createSession(ctx.db, {
      contentSessionId: 'del-test',
      project: 'test-project',
    });

    const id = insertObservation(ctx.db, {
      sessionId: session.id,
      project: 'test-project',
      type: 'bugfix',
      title: 'Fix null pointer',
      importance: 5,
    });

    expect(getObservation(ctx.db, id)).not.toBeNull();
    const deleted = deleteObservation(ctx.db, id);
    expect(deleted).toBe(true);
    expect(getObservation(ctx.db, id)).toBeNull();
  });

  it('deleteObservation returns false for non-existent ID', () => {
    expect(deleteObservation(ctx.db, 9999)).toBe(false);
  });

  it('updateObservation updates fields', () => {
    const session = createSession(ctx.db, {
      contentSessionId: 'upd-test',
      project: 'test-project',
    });

    const id = insertObservation(ctx.db, {
      sessionId: session.id,
      project: 'test-project',
      type: 'feature',
      title: 'Original title',
      importance: 5,
    });

    const updated = updateObservation(ctx.db, id, {
      title: 'Updated title',
      importance: 9,
      type: 'decision',
      scope: 'global',
    });

    expect(updated).not.toBeNull();
    expect(updated?.title).toBe('Updated title');
    expect(updated?.importance).toBe(9);
    expect(updated?.type).toBe('decision');
    expect(updated?.scope).toBe('global');
  });

  it('DELETE /data/observations/:id via API', async () => {
    const session = createSession(ctx.db, {
      contentSessionId: 'api-del',
      project: 'test-project',
    });

    const id = insertObservation(ctx.db, {
      sessionId: session.id,
      project: 'test-project',
      type: 'bugfix',
      title: 'API delete test',
      importance: 5,
    });

    const res = await fetch(`${ctx.baseUrl}/data/observations/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(getObservation(ctx.db, id)).toBeNull();
  });

  it('PUT /data/observations/:id via API', async () => {
    const session = createSession(ctx.db, {
      contentSessionId: 'api-upd',
      project: 'test-project',
    });

    const id = insertObservation(ctx.db, {
      sessionId: session.id,
      project: 'test-project',
      type: 'feature',
      title: 'Before update',
      importance: 5,
    });

    const res = await fetch(`${ctx.baseUrl}/data/observations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'After update', importance: 8 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; importance: number };
    expect(body.title).toBe('After update');
    expect(body.importance).toBe(8);
  });
});

describe('P2: SSE Endpoint', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('GET /data/events returns SSE stream', async () => {
    const res = await fetch(`${ctx.baseUrl}/data/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    // Read first event (the connected event)
    const reader = res.body?.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: connected');
    reader.cancel();
  });
});

describe('P2: Configurable Embeddings', () => {
  afterEach(() => {
    resetConfig();
  });

  it('has default embedding config', () => {
    const config = getConfig();
    expect(config.get('embeddings', 'model')).toBe('Xenova/all-MiniLM-L6-v2');
    expect(config.get('embeddings', 'dimensions')).toBe(384);
  });
});

describe('P3: Entity Relationships', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('upserts and retrieves relationships', () => {
    // Create two entities
    ctx.db.run(
      `INSERT INTO entities (project, entity_type, name, first_seen_epoch, last_seen_epoch, mention_count)
       VALUES ('test', 'file', 'a.ts', ?, ?, 1)`,
      [Date.now(), Date.now()],
    );
    ctx.db.run(
      `INSERT INTO entities (project, entity_type, name, first_seen_epoch, last_seen_epoch, mention_count)
       VALUES ('test', 'file', 'b.ts', ?, ?, 1)`,
      [Date.now(), Date.now()],
    );

    const entities = ctx.db.query('SELECT id FROM entities ORDER BY id').all() as { id: number }[];
    const [e1, e2] = entities;

    upsertRelationship(ctx.db, {
      sourceEntityId: e1.id,
      targetEntityId: e2.id,
      relationshipType: 'related_to',
    });

    const rels = getRelationships(ctx.db, e1.id);
    expect(rels.length).toBe(1);
    expect(rels[0].relationship_type).toBe('related_to');
    expect(rels[0].source_name).toBe('a.ts');
    expect(rels[0].target_name).toBe('b.ts');
  });

  it('increments evidence_count on duplicate upsert', () => {
    ctx.db.run(
      `INSERT INTO entities (project, entity_type, name, first_seen_epoch, last_seen_epoch, mention_count)
       VALUES ('test', 'file', 'x.ts', ?, ?, 1)`,
      [Date.now(), Date.now()],
    );
    ctx.db.run(
      `INSERT INTO entities (project, entity_type, name, first_seen_epoch, last_seen_epoch, mention_count)
       VALUES ('test', 'file', 'y.ts', ?, ?, 1)`,
      [Date.now(), Date.now()],
    );

    const entities = ctx.db.query('SELECT id FROM entities ORDER BY id').all() as { id: number }[];
    const [e1, e2] = entities;

    upsertRelationship(ctx.db, {
      sourceEntityId: e1.id,
      targetEntityId: e2.id,
      relationshipType: 'imports',
    });

    upsertRelationship(ctx.db, {
      sourceEntityId: e1.id,
      targetEntityId: e2.id,
      relationshipType: 'imports',
    });

    const rels = getRelationships(ctx.db, e1.id);
    expect(rels[0].evidence_count).toBe(2);
  });

  it('getRelatedEntities returns directional results', () => {
    ctx.db.run(
      `INSERT INTO entities (project, entity_type, name, first_seen_epoch, last_seen_epoch, mention_count)
       VALUES ('test', 'function', 'foo', ?, ?, 1)`,
      [Date.now(), Date.now()],
    );
    ctx.db.run(
      `INSERT INTO entities (project, entity_type, name, first_seen_epoch, last_seen_epoch, mention_count)
       VALUES ('test', 'file', 'main.ts', ?, ?, 1)`,
      [Date.now(), Date.now()],
    );

    const entities = ctx.db.query('SELECT id FROM entities ORDER BY id').all() as { id: number }[];
    const [fn, file] = entities;

    upsertRelationship(ctx.db, {
      sourceEntityId: fn.id,
      targetEntityId: file.id,
      relationshipType: 'calls',
    });

    const related = getRelatedEntities(ctx.db, fn.id);
    expect(related.length).toBe(1);
    expect(related[0].direction).toBe('outgoing');
    expect(related[0].name).toBe('main.ts');
  });

  it('GET /data/entities/:id/relationships via API', async () => {
    ctx.db.run(
      `INSERT INTO entities (project, entity_type, name, first_seen_epoch, last_seen_epoch, mention_count)
       VALUES ('test', 'file', 'api.ts', ?, ?, 1)`,
      [Date.now(), Date.now()],
    );
    ctx.db.run(
      `INSERT INTO entities (project, entity_type, name, first_seen_epoch, last_seen_epoch, mention_count)
       VALUES ('test', 'dependency', 'hono', ?, ?, 1)`,
      [Date.now(), Date.now()],
    );

    const entities = ctx.db.query('SELECT id FROM entities ORDER BY id').all() as { id: number }[];
    const [e1, e2] = entities;

    upsertRelationship(ctx.db, {
      sourceEntityId: e1.id,
      targetEntityId: e2.id,
      relationshipType: 'depends_on',
    });

    const res = await fetch(`${ctx.baseUrl}/data/entities/${e1.id}/relationships`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { relationships: any[] };
    expect(body.relationships.length).toBe(1);
    expect(body.relationships[0].relationship_type).toBe('depends_on');
  });

  it('GET /data/entity-graph returns nodes and edges', async () => {
    ctx.db.run(
      `INSERT INTO entities (project, entity_type, name, first_seen_epoch, last_seen_epoch, mention_count)
       VALUES ('proj1', 'file', 'a.ts', ?, ?, 1)`,
      [Date.now(), Date.now()],
    );
    ctx.db.run(
      `INSERT INTO entities (project, entity_type, name, first_seen_epoch, last_seen_epoch, mention_count)
       VALUES ('proj1', 'file', 'b.ts', ?, ?, 1)`,
      [Date.now(), Date.now()],
    );

    const entities = ctx.db.query('SELECT id FROM entities ORDER BY id').all() as { id: number }[];
    const [e1, e2] = entities;

    upsertRelationship(ctx.db, {
      sourceEntityId: e1.id,
      targetEntityId: e2.id,
      relationshipType: 'related_to',
    });

    const res = await fetch(`${ctx.baseUrl}/data/entity-graph?project=proj1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: any[]; edges: any[] };
    expect(body.nodes.length).toBe(2);
    expect(body.edges.length).toBe(1);
  });
});

describe('P3: Time Expression Parser', () => {
  it('parses "today"', () => {
    const result = parseTimeExpression('today');
    expect(result).not.toBeNull();
    expect(result?.end).toBeGreaterThan(result?.start);
    expect(result?.end - result?.start).toBeLessThanOrEqual(86400000);
  });

  it('parses "yesterday"', () => {
    const result = parseTimeExpression('yesterday');
    expect(result).not.toBeNull();
    expect(result?.end - result?.start).toBe(86400000);
  });

  it('parses "last 3 days"', () => {
    const result = parseTimeExpression('last 3 days');
    expect(result).not.toBeNull();
    const threeDays = 3 * 86400000;
    expect(result?.end - result?.start).toBeCloseTo(threeDays, -2);
  });

  it('parses "last 2 hours"', () => {
    const result = parseTimeExpression('last 2 hours');
    expect(result).not.toBeNull();
    const twoHours = 2 * 3600000;
    expect(result?.end - result?.start).toBeCloseTo(twoHours, -2);
  });

  it('parses "this week"', () => {
    const result = parseTimeExpression('this week');
    expect(result).not.toBeNull();
    expect(result?.start).toBeLessThan(result?.end);
  });

  it('parses "last week"', () => {
    const result = parseTimeExpression('last week');
    expect(result).not.toBeNull();
    expect(result?.end - result?.start).toBe(7 * 86400000);
  });

  it('parses "5 hours ago"', () => {
    const result = parseTimeExpression('5 hours ago');
    expect(result).not.toBeNull();
    expect(result?.end - result?.start).toBeCloseTo(5 * 3600000, -2);
  });

  it('returns null for unrecognized expressions', () => {
    expect(parseTimeExpression('next tuesday')).toBeNull();
    expect(parseTimeExpression('sometime')).toBeNull();
    expect(parseTimeExpression('')).toBeNull();
  });
});

describe('P3: Time Range Query', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('getObservationsByTimeRange filters by epoch range', () => {
    const session = createSession(ctx.db, {
      contentSessionId: 'time-test',
      project: 'test-project',
    });

    // Insert observation (will have current epoch)
    insertObservation(ctx.db, {
      sessionId: session.id,
      project: 'test-project',
      type: 'feature',
      title: 'Recent observation',
      importance: 5,
    });

    const now = Date.now();
    const results = getObservationsByTimeRange(ctx.db, 'test-project', now - 60000, now + 60000);
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('Recent observation');
  });

  it('GET /data/observations with timeExpr filter', async () => {
    const session = createSession(ctx.db, {
      contentSessionId: 'time-api-test',
      project: 'test-project',
    });

    insertObservation(ctx.db, {
      sessionId: session.id,
      project: 'test-project',
      type: 'feature',
      title: 'Today observation',
      importance: 5,
    });

    const res = await fetch(`${ctx.baseUrl}/data/observations?project=test-project&timeExpr=today`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { observations: any[] };
    expect(body.observations.length).toBeGreaterThanOrEqual(1);
    expect(body.observations[0].title).toBe('Today observation');
  });
});

describe('P2: Migration 008 - Entity Relationships', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('entity_relationships table exists after migration', () => {
    const tables = ctx.db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='entity_relationships'")
      .all() as { name: string }[];
    expect(tables.length).toBe(1);
  });

  it('relationship type constraint works', () => {
    ctx.db.run(
      `INSERT INTO entities (project, entity_type, name, first_seen_epoch, last_seen_epoch, mention_count)
       VALUES ('test', 'file', 'a.ts', ?, ?, 1)`,
      [Date.now(), Date.now()],
    );
    ctx.db.run(
      `INSERT INTO entities (project, entity_type, name, first_seen_epoch, last_seen_epoch, mention_count)
       VALUES ('test', 'file', 'b.ts', ?, ?, 1)`,
      [Date.now(), Date.now()],
    );

    const entities = ctx.db.query('SELECT id FROM entities ORDER BY id').all() as { id: number }[];

    // Valid type should work
    expect(() => {
      ctx.db.run(
        `INSERT INTO entity_relationships (source_entity_id, target_entity_id, relationship_type, first_seen_epoch, last_seen_epoch)
         VALUES (?, ?, 'imports', ?, ?)`,
        [entities[0].id, entities[1].id, Date.now(), Date.now()],
      );
    }).not.toThrow();

    // Invalid type should fail
    expect(() => {
      ctx.db.run(
        `INSERT INTO entity_relationships (source_entity_id, target_entity_id, relationship_type, first_seen_epoch, last_seen_epoch)
         VALUES (?, ?, 'invalid_type', ?, ?)`,
        [entities[0].id, entities[1].id, Date.now(), Date.now()],
      );
    }).toThrow();
  });
});
