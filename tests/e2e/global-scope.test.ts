import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { hybridSearch } from '../../src/services/context/search';
import { parseExtractionResponse } from '../../src/services/extraction/response-parser';
import { archiveOldObservations } from '../../src/services/sqlite/archival';
import { exportProject, importProject } from '../../src/services/sqlite/export-import';
import { searchByKeyword } from '../../src/services/sqlite/fts';
import {
  countObservationsByProject,
  getRecentObservations,
  insertObservation,
} from '../../src/services/sqlite/observations';
import { getReflectionsByProject, insertReflection } from '../../src/services/sqlite/reflections';
import { findSimilarByVector, insertEmbedding } from '../../src/services/sqlite/vectors';
import { createTestContext } from '../fixtures/helpers';

// Helper: create a test session and return its ID
function createTestSession(db: any, project: string): number {
  db.query('INSERT INTO sessions (content_session_id, project, branch, created_at_epoch) VALUES (?, ?, ?, ?)').run(
    `test-${Date.now()}-${Math.random()}`,
    project,
    'main',
    Date.now(),
  );
  return (db.query('SELECT last_insert_rowid() as id').get() as any).id;
}

// Helper: create a normalized 384-dim embedding from a seed
function seededEmbedding(seed: number): Float32Array {
  const arr = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    arr[i] = Math.sin(seed * 100 + i * 0.1);
  }
  let norm = 0;
  for (let i = 0; i < 384; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < 384; i++) arr[i] /= norm;
  return arr;
}

describe('Global vs Project Memory Scope', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('migration adds scope column with default "project"', () => {
    const sessionId = createTestSession(ctx.db, '/tmp/project-a');
    const id = insertObservation(ctx.db, {
      sessionId,
      project: '/tmp/project-a',
      type: 'discovery',
      title: 'Default scope test',
    });

    const row = ctx.db.query('SELECT scope FROM observations WHERE id = ?').get(id) as any;
    expect(row.scope).toBe('project');
  });

  it('project-scoped observation NOT visible from another project', () => {
    const sessionA = createTestSession(ctx.db, '/tmp/project-a');
    const sessionB = createTestSession(ctx.db, '/tmp/project-b');

    insertObservation(ctx.db, {
      sessionId: sessionA,
      project: '/tmp/project-a',
      type: 'discovery',
      title: 'Project A only observation',
      scope: 'project',
    });

    insertObservation(ctx.db, {
      sessionId: sessionB,
      project: '/tmp/project-b',
      type: 'discovery',
      title: 'Project B only observation',
      scope: 'project',
    });

    const fromA = getRecentObservations(ctx.db, '/tmp/project-a');
    const fromB = getRecentObservations(ctx.db, '/tmp/project-b');

    expect(fromA.length).toBe(1);
    expect(fromA[0].title).toBe('Project A only observation');
    expect(fromB.length).toBe(1);
    expect(fromB[0].title).toBe('Project B only observation');
  });

  it('global-scoped observation IS visible from another project', () => {
    const sessionA = createTestSession(ctx.db, '/tmp/project-a');

    insertObservation(ctx.db, {
      sessionId: sessionA,
      project: '/tmp/project-a',
      type: 'decision',
      title: 'Developer prefers tabs over spaces',
      scope: 'global',
    });

    // Should appear when querying from project-b
    const fromB = getRecentObservations(ctx.db, '/tmp/project-b');
    expect(fromB.length).toBe(1);
    expect(fromB[0].title).toBe('Developer prefers tabs over spaces');
    expect(fromB[0].scope).toBe('global');
    expect(fromB[0].project).toBe('/tmp/project-a'); // provenance preserved

    // Should also appear from original project
    const fromA = getRecentObservations(ctx.db, '/tmp/project-a');
    expect(fromA.length).toBe(1);
  });

  it('vector search includes global observations', () => {
    const sessionA = createTestSession(ctx.db, '/tmp/project-a');

    const globalId = insertObservation(ctx.db, {
      sessionId: sessionA,
      project: '/tmp/project-a',
      type: 'decision',
      title: 'Global preference for Bun runtime',
      scope: 'global',
    });

    const projectId = insertObservation(ctx.db, {
      sessionId: sessionA,
      project: '/tmp/project-a',
      type: 'discovery',
      title: 'Project A uses Hono framework',
      scope: 'project',
    });

    const emb1 = seededEmbedding(1);
    const emb2 = seededEmbedding(2);
    insertEmbedding(ctx.db, globalId, emb1);
    insertEmbedding(ctx.db, projectId, emb2);

    // Search from project-b should find the global observation
    const results = findSimilarByVector(ctx.db, seededEmbedding(1), '/tmp/project-b', { limit: 10 });
    const ids = results.map((r) => r.observationId);
    expect(ids).toContain(globalId);
    // project-scoped observation should NOT appear for project-b
    expect(ids).not.toContain(projectId);
  });

  it('FTS search includes global observations', () => {
    const sessionA = createTestSession(ctx.db, '/tmp/project-a');

    insertObservation(ctx.db, {
      sessionId: sessionA,
      project: '/tmp/project-a',
      type: 'decision',
      title: 'Developer prefers TypeScript strict mode',
      scope: 'global',
    });

    insertObservation(ctx.db, {
      sessionId: sessionA,
      project: '/tmp/project-a',
      type: 'discovery',
      title: 'Project A config uses strict TypeScript',
      scope: 'project',
    });

    // FTS search from project-b should find the global observation
    const results = searchByKeyword(ctx.db, 'TypeScript strict', '/tmp/project-b');
    expect(results.length).toBe(1);
    expect(results[0].observationId).toBeTruthy();
  });

  it('hybridSearch returns global + project observations mixed by score', () => {
    const sessionA = createTestSession(ctx.db, '/tmp/project-a');
    const sessionB = createTestSession(ctx.db, '/tmp/project-b');

    insertObservation(ctx.db, {
      sessionId: sessionA,
      project: '/tmp/project-a',
      type: 'decision',
      title: 'Developer prefers tabs over spaces globally',
      scope: 'global',
      importance: 8,
    });

    insertObservation(ctx.db, {
      sessionId: sessionB,
      project: '/tmp/project-b',
      type: 'discovery',
      title: 'Project B uses Hono framework for HTTP routes',
      scope: 'project',
      importance: 5,
    });

    const results = hybridSearch(ctx.db, {
      project: '/tmp/project-b',
    });

    expect(results.length).toBe(2);
    // Both should appear — global from project-a + local from project-b
    const titles = results.map((r) => r.observation.title);
    expect(titles).toContain('Developer prefers tabs over spaces globally');
    expect(titles).toContain('Project B uses Hono framework for HTTP routes');
  });

  it('insertObservation with scope="global" creates global observation (MCP save path)', () => {
    const session = createTestSession(ctx.db, '/tmp/project-a');

    // Simulates what MCP handleSave does with scope='global'
    insertObservation(ctx.db, {
      sessionId: session,
      project: '/tmp/project-a',
      sourceIde: 'mcp',
      type: 'decision',
      title: 'I prefer functional programming patterns',
      facts: JSON.stringify(['Use map/filter/reduce over for loops']),
      importance: 5,
      scope: 'global',
    });

    // Verify the observation has global scope
    const obs = getRecentObservations(ctx.db, '/tmp/project-a');
    const saved = obs.find((o) => o.title === 'I prefer functional programming patterns');
    expect(saved).toBeTruthy();
    expect(saved?.scope).toBe('global');

    // Verify it's visible from another project
    const fromB = getRecentObservations(ctx.db, '/tmp/project-b');
    const fromBSaved = fromB.find((o) => o.title === 'I prefer functional programming patterns');
    expect(fromBSaved).toBeTruthy();
  });

  it('correction observations have scope="global"', async () => {
    // Create a session first
    const initRes = await fetch(`${ctx.baseUrl}/sessions/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentSessionId: 'correction-test-session',
        project: '/tmp/project-a',
        prompt: 'test prompt',
      }),
    });
    const initJson = (await initRes.json()) as any;
    const sessionId = initJson.sessionId;

    const res = await fetch(`${ctx.baseUrl}/sessions/${sessionId}/observe-correction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        promptText: 'No, use Bun instead of Node',
        matchedPattern: 'no, use X',
        project: '/tmp/project-a',
      }),
    });

    const json = (await res.json()) as any;
    expect(json.recorded).toBe(true);

    // Verify the correction observation has global scope
    const row = ctx.db.query('SELECT scope FROM observations WHERE id = ?').get(json.id) as any;
    expect(row.scope).toBe('global');
  });

  it('export/import preserves scope field', () => {
    const sessionA = createTestSession(ctx.db, '/tmp/project-a');

    insertObservation(ctx.db, {
      sessionId: sessionA,
      project: '/tmp/project-a',
      type: 'decision',
      title: 'Global preference exported',
      scope: 'global',
    });

    insertObservation(ctx.db, {
      sessionId: sessionA,
      project: '/tmp/project-a',
      type: 'discovery',
      title: 'Project-scoped exported',
      scope: 'project',
    });

    insertReflection(ctx.db, {
      sessionId: sessionA,
      project: '/tmp/project-a',
      type: 'quick',
      insight: 'Global reflection',
      scope: 'global',
    });

    const exported = exportProject(ctx.db, '/tmp/project-a');

    expect(exported.observations.length).toBe(2);
    const globalObs = exported.observations.find((o) => o.title === 'Global preference exported');
    expect(globalObs?.scope).toBe('global');
    const projectObs = exported.observations.find((o) => o.title === 'Project-scoped exported');
    expect(projectObs?.scope).toBe('project');

    expect(exported.reflections.length).toBe(1);
    expect(exported.reflections[0].scope).toBe('global');

    // Import into a fresh context
    const ctx2 = createTestContext();
    try {
      const result = importProject(ctx2.db, exported);
      expect(result.imported.observations).toBe(2);
      expect(result.imported.reflections).toBe(1);

      // Verify scope was preserved
      const obs = ctx2.db.query('SELECT title, scope FROM observations ORDER BY created_at_epoch ASC').all() as any[];

      const importedGlobal = obs.find((o: any) => o.title === 'Global preference exported');
      expect(importedGlobal.scope).toBe('global');

      const importedProject = obs.find((o: any) => o.title === 'Project-scoped exported');
      expect(importedProject.scope).toBe('project');

      const ref = ctx2.db.query('SELECT scope FROM reflections').get() as any;
      expect(ref.scope).toBe('global');
    } finally {
      ctx2.cleanup();
    }
  });

  it('countObservationsByProject includes globals', () => {
    const sessionA = createTestSession(ctx.db, '/tmp/project-a');
    const sessionB = createTestSession(ctx.db, '/tmp/project-b');

    insertObservation(ctx.db, {
      sessionId: sessionA,
      project: '/tmp/project-a',
      type: 'decision',
      title: 'Global pref',
      scope: 'global',
    });

    insertObservation(ctx.db, {
      sessionId: sessionB,
      project: '/tmp/project-b',
      type: 'discovery',
      title: 'Project B local',
      scope: 'project',
    });

    // project-b count should include the global from project-a + its own local
    const countB = countObservationsByProject(ctx.db, '/tmp/project-b');
    expect(countB).toBe(2);

    // project-a count should include just its own global
    const countA = countObservationsByProject(ctx.db, '/tmp/project-a');
    expect(countA).toBe(1);
  });

  it('archival does NOT archive other project globals', () => {
    const sessionA = createTestSession(ctx.db, '/tmp/project-a');

    // Insert a global observation from project-a with old timestamp
    ctx.db.run(
      `INSERT INTO observations (session_id, project, type, title, importance, scope, created_at_epoch)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionA,
        '/tmp/project-a',
        'decision',
        'Old global preference',
        5,
        'global',
        Date.now() - 100 * 24 * 60 * 60 * 1000,
      ],
    );

    // Archive from project-b with a short retention
    const result = archiveOldObservations(ctx.db, '/tmp/project-b', 30);
    expect(result.archived).toBe(0);

    // The global observation should still exist in the main table
    const count = (ctx.db.query('SELECT COUNT(*) as count FROM observations').get() as any).count;
    expect(count).toBe(1);

    // Archive from project-a — this should archive it
    const result2 = archiveOldObservations(ctx.db, '/tmp/project-a', 30);
    expect(result2.archived).toBe(1);

    // Verify archived_observations has scope preserved
    const archived = ctx.db.query('SELECT scope FROM archived_observations').get() as any;
    expect(archived.scope).toBe('global');
  });

  it('extraction response parser correctly parses scope', () => {
    const response = `
<observation>
<type>decision</type>
<title>Prefers Bun over Node</title>
<scope>global</scope>
<facts><fact>Chose Bun for CLI project</fact></facts>
<concepts>bun, nodejs</concepts>
<files_affected></files_affected>
<importance>6</importance>
</observation>
<observation>
<type>bugfix</type>
<title>Fixed auth middleware</title>
<scope>project</scope>
<facts><fact>req.user was null</fact></facts>
<concepts>auth</concepts>
<files_affected>src/auth.ts</files_affected>
<importance>7</importance>
</observation>
<observation>
<type>discovery</type>
<title>No scope specified defaults to project</title>
<facts><fact>Testing default</fact></facts>
<concepts>test</concepts>
<files_affected></files_affected>
<importance>3</importance>
</observation>`;

    const obs = parseExtractionResponse(response);
    expect(obs.length).toBe(3);
    expect(obs[0].scope).toBe('global');
    expect(obs[1].scope).toBe('project');
    expect(obs[2].scope).toBe('project'); // default when not specified
  });

  it('reflections with global scope visible from other projects', () => {
    insertReflection(ctx.db, {
      project: '/tmp/project-a',
      type: 'quick',
      insight: 'Developer consistently avoids ORMs',
      scope: 'global',
    });

    insertReflection(ctx.db, {
      project: '/tmp/project-a',
      type: 'quick',
      insight: 'Project A uses raw SQL queries',
      scope: 'project',
    });

    const fromB = getReflectionsByProject(ctx.db, '/tmp/project-b');
    expect(fromB.length).toBe(1);
    expect(fromB[0].insight).toBe('Developer consistently avoids ORMs');

    const fromA = getReflectionsByProject(ctx.db, '/tmp/project-a');
    expect(fromA.length).toBe(2);
  });
});
