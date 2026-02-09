import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { buildContext } from '../../src/services/context/builder';
import { hybridSearch, normalizeImportance, recencyDecay } from '../../src/services/context/search';
import { buildEmbeddableText } from '../../src/services/embeddings/embedding-service';
import { normalizeRank, searchByKeyword } from '../../src/services/sqlite/fts';
import { insertObservation } from '../../src/services/sqlite/observations';
import { countEmbeddings, findSimilarByVector, getEmbedding, insertEmbedding } from '../../src/services/sqlite/vectors';
import { createTestContext } from '../fixtures/helpers';

// Helper: create a test session and return its ID
function createTestSession(db: any, project: string = '/tmp/test-project'): number {
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

// Helper: create an embedding similar to another (small perturbation)
function perturbedEmbedding(base: Float32Array, noise: number = 0.05): Float32Array {
  const arr = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    arr[i] = base[i] + Math.sin(i * 7.3) * noise;
  }
  let norm = 0;
  for (let i = 0; i < 384; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < 384; i++) arr[i] /= norm;
  return arr;
}

describe('Smart Context E2E', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('FTS5 Search', () => {
    it('FTS5 index is populated via triggers on insert', () => {
      const sessionId = createTestSession(ctx.db);
      insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Authentication middleware handles JWT tokens',
        facts: JSON.stringify(['JWT validation in middleware', 'Uses RS256 algorithm']),
        concepts: JSON.stringify(['authentication', 'JWT', 'middleware']),
      });

      const results = searchByKeyword(ctx.db, 'authentication JWT', '/tmp/test');
      expect(results.length).toBe(1);
      expect(results[0].rank).toBeLessThan(0); // BM25 rank is negative
    });

    it('FTS5 search filters by project', () => {
      const session1 = createTestSession(ctx.db, '/project-a');
      const session2 = createTestSession(ctx.db, '/project-b');

      insertObservation(ctx.db, {
        sessionId: session1,
        project: '/project-a',
        type: 'discovery',
        title: 'Database connection pooling',
      });
      insertObservation(ctx.db, {
        sessionId: session2,
        project: '/project-b',
        type: 'discovery',
        title: 'Database migration strategy',
      });

      expect(searchByKeyword(ctx.db, 'database', '/project-a').length).toBe(1);
      expect(searchByKeyword(ctx.db, 'database', '/project-b').length).toBe(1);
    });

    it('FTS5 returns no results for unmatched query', () => {
      const sessionId = createTestSession(ctx.db);
      insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'React component lifecycle',
      });

      const results = searchByKeyword(ctx.db, 'python django', '/tmp/test');
      expect(results.length).toBe(0);
    });

    it('normalizeRank converts BM25 to 0-1 score', () => {
      expect(normalizeRank(-10)).toBeCloseTo(0.5, 1);
      expect(normalizeRank(-20)).toBeCloseTo(1.0, 1);
      expect(normalizeRank(0)).toBe(0);
      expect(normalizeRank(5)).toBe(0);
    });
  });

  describe('Vector Store', () => {
    it('stores and retrieves embeddings', () => {
      const sessionId = createTestSession(ctx.db);
      const obsId = insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Test obs',
      });

      const embedding = seededEmbedding(42);
      insertEmbedding(ctx.db, obsId, embedding);

      const retrieved = getEmbedding(ctx.db, obsId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.length).toBe(384);
      // biome-ignore lint/style/noNonNullAssertion: test assertion - guaranteed by expect above
      expect(Math.abs(retrieved![0] - embedding[0])).toBeLessThan(0.001);
    });

    it('finds similar vectors by cosine distance', () => {
      const sessionId = createTestSession(ctx.db);
      const baseEmb = seededEmbedding(1);
      const similarEmb = perturbedEmbedding(baseEmb, 0.02);
      const differentEmb = seededEmbedding(999);

      const obsId1 = insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Similar observation',
      });
      insertEmbedding(ctx.db, obsId1, similarEmb);

      const obsId2 = insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Different observation',
      });
      insertEmbedding(ctx.db, obsId2, differentEmb);

      const results = findSimilarByVector(ctx.db, baseEmb, '/tmp/test', { limit: 10 });
      expect(results.length).toBe(2);
      // Similar should be closer (lower distance)
      expect(results[0].observationId).toBe(obsId1);
      expect(results[0].distance).toBeLessThan(results[1].distance);
    });

    it('vector search filters by project', () => {
      const session1 = createTestSession(ctx.db, '/project-a');
      const session2 = createTestSession(ctx.db, '/project-b');
      const emb = seededEmbedding(1);

      const obsId1 = insertObservation(ctx.db, {
        sessionId: session1,
        project: '/project-a',
        type: 'discovery',
        title: 'Obs A',
      });
      insertEmbedding(ctx.db, obsId1, emb);

      const obsId2 = insertObservation(ctx.db, {
        sessionId: session2,
        project: '/project-b',
        type: 'discovery',
        title: 'Obs B',
      });
      insertEmbedding(ctx.db, obsId2, emb);

      const results = findSimilarByVector(ctx.db, emb, '/project-a');
      expect(results.length).toBe(1);
      expect(results[0].observationId).toBe(obsId1);
    });

    it('countEmbeddings returns correct count', () => {
      const sessionId = createTestSession(ctx.db);
      expect(countEmbeddings(ctx.db, '/tmp/test')).toBe(0);

      const obsId = insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Test',
      });
      insertEmbedding(ctx.db, obsId, seededEmbedding(1));
      expect(countEmbeddings(ctx.db, '/tmp/test')).toBe(1);
    });
  });

  describe('Hybrid Search', () => {
    it('combines vector and recency signals', () => {
      const sessionId = createTestSession(ctx.db);
      const queryEmb = seededEmbedding(1);

      // Old but similar
      const obsId1 = insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Old similar observation',
        importance: 5,
      });
      ctx.db
        .query('UPDATE observations SET created_at_epoch = ? WHERE id = ?')
        .run(Date.now() - 14 * 24 * 60 * 60 * 1000, obsId1);
      insertEmbedding(ctx.db, obsId1, perturbedEmbedding(queryEmb, 0.02));

      // Recent but different
      const obsId2 = insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Recent different observation',
        importance: 5,
      });
      insertEmbedding(ctx.db, obsId2, seededEmbedding(999));

      const results = hybridSearch(ctx.db, {
        project: '/tmp/test',
        queryEmbedding: queryEmb,
      });

      expect(results.length).toBe(2);
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].signals.recencyDecay).toBeDefined();
      expect(results[0].signals.importanceNorm).toBeDefined();
      expect(results[0].signals.vectorSimilarity).toBeDefined();
    });

    it('falls back to recency when no embeddings exist', () => {
      const sessionId = createTestSession(ctx.db);

      insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'React component lifecycle management',
        importance: 5,
      });
      insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'PostgreSQL query optimization techniques',
        importance: 6,
      });
      insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Docker container networking setup',
        importance: 7,
      });

      const results = hybridSearch(ctx.db, {
        project: '/tmp/test',
        queryEmbedding: seededEmbedding(1),
      });

      expect(results.length).toBe(3);
    });

    it('importance affects scoring', () => {
      const sessionId = createTestSession(ctx.db);

      const lowId = insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Low importance item',
        importance: 1,
      });
      const highId = insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'High importance item',
        importance: 10,
      });

      const results = hybridSearch(ctx.db, { project: '/tmp/test' });
      expect(results.length).toBe(2);

      // biome-ignore lint/style/noNonNullAssertion: test assertion - find is guaranteed by expect above
      const highResult = results.find((r) => r.observation.id === highId)!;
      // biome-ignore lint/style/noNonNullAssertion: test assertion - find is guaranteed by expect above
      const lowResult = results.find((r) => r.observation.id === lowId)!;
      expect(highResult.signals.importanceNorm).toBeGreaterThan(lowResult.signals.importanceNorm);
    });

    it('FTS keyword search integrates with hybrid scoring', () => {
      const sessionId = createTestSession(ctx.db);

      insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'bugfix',
        title: 'Fixed authentication token validation bug',
        facts: JSON.stringify(['JWT validation was broken']),
        concepts: JSON.stringify(['authentication', 'JWT']),
        importance: 7,
      });

      insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'feature',
        title: 'Added JWT token refresh endpoint',
        concepts: JSON.stringify(['authentication', 'tokens']),
        importance: 5,
      });

      const results = hybridSearch(ctx.db, {
        project: '/tmp/test',
        queryText: 'authentication JWT',
      });

      expect(results.length).toBe(2);
      // The first observation should score higher (more keyword hits in title + facts + concepts)
      expect(results[0].observation.title).toContain('authentication');
    });
  });

  describe('Scoring Utilities', () => {
    it('recencyDecay returns 1.0 for now', () => {
      const now = Date.now();
      expect(recencyDecay(now, now)).toBeCloseTo(1.0, 5);
    });

    it('recencyDecay returns ~0.5 after 7 days', () => {
      const now = Date.now();
      expect(recencyDecay(now - 7 * 24 * 60 * 60 * 1000, now)).toBeCloseTo(0.5, 1);
    });

    it('recencyDecay returns ~0.25 after 14 days', () => {
      const now = Date.now();
      expect(recencyDecay(now - 14 * 24 * 60 * 60 * 1000, now)).toBeCloseTo(0.25, 1);
    });

    it('normalizeImportance maps 1-10 to 0.1-1.0', () => {
      expect(normalizeImportance(1)).toBeCloseTo(0.1, 2);
      expect(normalizeImportance(5)).toBeCloseTo(0.5, 2);
      expect(normalizeImportance(10)).toBeCloseTo(1.0, 2);
    });
  });

  describe('buildEmbeddableText', () => {
    it('combines type, title, facts, and concepts', () => {
      const text = buildEmbeddableText({
        type: 'bugfix',
        title: 'Fixed null pointer in auth',
        facts: JSON.stringify(['Token validation missing null check']),
        concepts: JSON.stringify(['authentication', 'null safety']),
      });

      expect(text).toContain('[bugfix]');
      expect(text).toContain('Fixed null pointer in auth');
      expect(text).toContain('Token validation missing null check');
      expect(text).toContain('authentication');
    });

    it('handles null facts and concepts', () => {
      const text = buildEmbeddableText({
        type: 'discovery',
        title: 'Simple observation',
        facts: null,
        concepts: null,
      });
      expect(text).toBe('[discovery] Simple observation');
    });
  });

  describe('Context Builder with Hybrid Search', () => {
    it('context endpoint accepts prompt parameter', async () => {
      const sessionId = createTestSession(ctx.db, '/tmp/test-project');
      insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test-project',
        type: 'discovery',
        title: 'Authentication token handling',
        facts: JSON.stringify(['JWT tokens validated on each request']),
        concepts: JSON.stringify(['authentication', 'JWT']),
        importance: 8,
      });

      const res = await fetch(`${ctx.baseUrl}/context/inject?project=/tmp/test-project&prompt=how does auth work`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Authentication token handling');
    });

    it('buildContext falls back to recency when hybrid finds nothing', () => {
      const sessionId = createTestSession(ctx.db, '/tmp/test');
      insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Test observation',
        importance: 5,
      });

      const context = buildContext(ctx.db, {
        project: '/tmp/test',
        prompt: 'completely unrelated xyzzy abcdef',
        tokenBudget: 4000,
        showInlineSummary: true,
      });

      expect(context).toContain('Test observation');
    });

    it('inline summary shows search type', () => {
      const sessionId = createTestSession(ctx.db, '/tmp/test');
      insertObservation(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Test observation',
      });

      // Without prompt -> recency mode
      const contextRecency = buildContext(ctx.db, {
        project: '/tmp/test',
        tokenBudget: 4000,
        showInlineSummary: true,
      });
      expect(contextRecency).toContain('recency');

      // With prompt -> hybrid mode
      const contextHybrid = buildContext(ctx.db, {
        project: '/tmp/test',
        prompt: 'test query',
        tokenBudget: 4000,
        showInlineSummary: true,
      });
      expect(contextHybrid).toContain('hybrid');
    });
  });

  describe('Settings includes scoring section', () => {
    it('settings endpoint returns scoring config', async () => {
      const res = await fetch(`${ctx.baseUrl}/settings`);
      expect(res.status).toBe(200);
      const settings = (await res.json()) as any;
      expect(settings.scoring).toBeTruthy();
      expect(settings.scoring.vectorWeight).toBe(0.5);
      expect(settings.scoring.recencyWeight).toBe(0.3);
      expect(settings.scoring.importanceWeight).toBe(0.2);
      expect(settings.scoring.dedupeThreshold).toBe(0.92);
    });
  });
});
