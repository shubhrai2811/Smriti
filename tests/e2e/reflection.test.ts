import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { buildContext } from '../../src/services/context/builder';
import { autoLink } from '../../src/services/reflection/auto-linker';
import { deepReflect, shouldRunDeepReflection } from '../../src/services/reflection/deep-reflection';
import { buildDeepReflectionPrompt, buildQuickReflectionPrompt } from '../../src/services/reflection/prompts';
import { quickReflect } from '../../src/services/reflection/quick-reflection';
import {
  parseDeepReflectionResponse,
  parseQuickReflectionResponse,
} from '../../src/services/reflection/response-parser';
import {
  findSimilarProfileEntry,
  getProfileByProject,
  insertProfileEntry,
  updateProfileConfidence,
} from '../../src/services/sqlite/developer-profile';
import { countLinks, getLinksByObservation, insertLink } from '../../src/services/sqlite/observation-links';
import { insertObservation } from '../../src/services/sqlite/observations';
import {
  getReflectionsByProject,
  getReflectionsBySession,
  insertReflection,
} from '../../src/services/sqlite/reflections';
import { insertEmbedding } from '../../src/services/sqlite/vectors';
import { createTestContext } from '../fixtures/helpers';

// Helper: create a test session and return its ID
function createTestSession(db: any, project: string = '/tmp/test-project', status: string = 'active'): number {
  db.query(
    'INSERT INTO sessions (content_session_id, project, branch, status, created_at_epoch) VALUES (?, ?, ?, ?, ?)',
  ).run(`test-${Date.now()}-${Math.random()}`, project, 'main', status, Date.now());
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
function perturbedEmbedding(base: Float32Array, noise: number = 0.02): Float32Array {
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

// Mock AI provider for testing
const mockQuickReflectionResponse = `<reflections>
  <insight category="pattern" confidence="0.8">
    <text>Developer uses middleware pattern for cross-cutting concerns</text>
    <sources>1,2</sources>
  </insight>
  <insight category="lesson" confidence="0.6">
    <text>Error handling should be centralized</text>
    <sources>3</sources>
  </insight>
</reflections>`;

const mockDeepReflectionResponse = `<deep_reflection>
  <patterns>
    <insight category="pattern" confidence="0.9">
      <text>Consistent use of TypeScript strict mode across projects</text>
      <sources>1,3,5</sources>
    </insight>
  </patterns>
  <profile_updates>
    <entry category="preference" confidence="0.85" action="create">
      <description>Prefers functional composition over class inheritance</description>
      <evidence>2,4,6</evidence>
    </entry>
    <entry category="style" confidence="0.7" action="create">
      <description>Uses kebab-case for file names</description>
      <evidence>1,5</evidence>
    </entry>
  </profile_updates>
  <warnings>
    <warning>Inconsistent error handling across services</warning>
  </warnings>
</deep_reflection>`;

const mockProvider = {
  name: 'mock',
  extract: async (_prompt: string): Promise<string> => mockQuickReflectionResponse,
  isAvailable: async () => true,
  getLastUsage: () => null,
};

describe('Reflection E2E', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('Reflection CRUD', () => {
    it('inserts and retrieves reflections', () => {
      const sessionId = createTestSession(ctx.db);
      const _id = insertReflection(ctx.db, {
        sessionId,
        project: '/tmp/test',
        type: 'quick',
        insight: 'Developer prefers functional patterns',
        category: 'pattern',
        sourceObservationIds: JSON.stringify([1, 2, 3]),
        confidence: 0.8,
      });

      const reflections = getReflectionsBySession(ctx.db, sessionId);
      expect(reflections.length).toBe(1);
      expect(reflections[0].insight).toBe('Developer prefers functional patterns');
      expect(reflections[0].category).toBe('pattern');
      expect(reflections[0].confidence).toBe(0.8);
    });

    it('filters reflections by project and type', () => {
      const session = createTestSession(ctx.db);
      insertReflection(ctx.db, { sessionId: session, project: '/tmp/a', type: 'quick', insight: 'Quick insight' });
      insertReflection(ctx.db, { sessionId: session, project: '/tmp/a', type: 'deep', insight: 'Deep insight' });
      insertReflection(ctx.db, { sessionId: session, project: '/tmp/b', type: 'quick', insight: 'Other project' });

      expect(getReflectionsByProject(ctx.db, '/tmp/a').length).toBe(2);
      expect(getReflectionsByProject(ctx.db, '/tmp/a', { type: 'quick' }).length).toBe(1);
      expect(getReflectionsByProject(ctx.db, '/tmp/b').length).toBe(1);
    });
  });

  describe('Developer Profile CRUD', () => {
    it('inserts and retrieves profile entries', () => {
      insertProfileEntry(ctx.db, {
        project: '/tmp/test',
        category: 'preference',
        description: 'Prefers Bun over Node.js',
        confidence: 0.7,
      });

      const entries = getProfileByProject(ctx.db, '/tmp/test');
      expect(entries.length).toBe(1);
      expect(entries[0].description).toBe('Prefers Bun over Node.js');
      expect(entries[0].confidence).toBe(0.7);
    });

    it('global entries appear for all projects', () => {
      insertProfileEntry(ctx.db, {
        project: null,
        category: 'style',
        description: 'Uses 2-space indentation',
        confidence: 0.9,
      });

      // Should appear for any project query
      expect(getProfileByProject(ctx.db, '/tmp/any-project').length).toBe(1);
      expect(getProfileByProject(ctx.db, '/some/other/project').length).toBe(1);
    });

    it('updates confidence and evidence count', () => {
      const id = insertProfileEntry(ctx.db, {
        project: '/tmp/test',
        category: 'pattern',
        description: 'Uses middleware pattern',
        confidence: 0.5,
        evidenceCount: 1,
      });

      updateProfileConfidence(ctx.db, id, 0.7, 3);
      const entries = getProfileByProject(ctx.db, '/tmp/test');
      expect(entries[0].confidence).toBe(0.7);
      expect(entries[0].evidence_count).toBe(3);
    });

    it('finds similar profile entries by description', () => {
      insertProfileEntry(ctx.db, {
        project: '/tmp/test',
        category: 'preference',
        description: 'Prefers functional composition over class inheritance',
        confidence: 0.8,
      });

      const found = findSimilarProfileEntry(ctx.db, '/tmp/test', 'preference', 'Prefers functional composition');
      expect(found).not.toBeNull();
      expect(found?.description).toContain('functional composition');

      const notFound = findSimilarProfileEntry(ctx.db, '/tmp/test', 'preference', 'Uses microservices architecture');
      expect(notFound).toBeNull();
    });
  });

  describe('Observation Links CRUD', () => {
    it('creates and retrieves observation links', () => {
      const session = createTestSession(ctx.db);
      const obs1 = insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Obs A',
      });
      const obs2 = insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Obs B',
      });

      insertLink(ctx.db, { sourceId: obs1, targetId: obs2, linkType: 'related', confidence: 0.9 });
      const links = getLinksByObservation(ctx.db, obs1);
      expect(links.length).toBe(1);
      expect(links[0].link_type).toBe('related');
      expect(links[0].confidence).toBe(0.9);
    });

    it('prevents duplicate links', () => {
      const session = createTestSession(ctx.db);
      const obs1 = insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Obs A',
      });
      const obs2 = insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Obs B',
      });

      insertLink(ctx.db, { sourceId: obs1, targetId: obs2, linkType: 'related', confidence: 0.9 });
      insertLink(ctx.db, { sourceId: obs1, targetId: obs2, linkType: 'related', confidence: 0.95 }); // duplicate
      expect(countLinks(ctx.db, obs1)).toBe(1);
    });
  });

  describe('Response Parsers', () => {
    it('parseQuickReflectionResponse extracts insights', () => {
      const obsIds = [10, 20, 30];
      const insights = parseQuickReflectionResponse(mockQuickReflectionResponse, obsIds);

      expect(insights.length).toBe(2);
      expect(insights[0].text).toBe('Developer uses middleware pattern for cross-cutting concerns');
      expect(insights[0].category).toBe('pattern');
      expect(insights[0].confidence).toBe(0.8);
      expect(insights[0].sourceObservationIds).toEqual([10, 20]); // indices 1,2 → ids 10,20
      expect(insights[1].category).toBe('lesson');
      expect(insights[1].sourceObservationIds).toEqual([30]); // index 3 → id 30
    });

    it('parseDeepReflectionResponse extracts patterns and profile updates', () => {
      const obsIds = [100, 200, 300, 400, 500, 600];
      const result = parseDeepReflectionResponse(mockDeepReflectionResponse, obsIds);

      expect(result.patterns.length).toBe(1);
      expect(result.patterns[0].text).toContain('TypeScript strict mode');
      expect(result.patterns[0].sourceObservationIds).toEqual([100, 300, 500]);

      expect(result.profileUpdates.length).toBe(2);
      expect(result.profileUpdates[0].category).toBe('preference');
      expect(result.profileUpdates[0].description).toContain('functional composition');
      expect(result.profileUpdates[1].category).toBe('style');

      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain('error handling');
    });

    it('handles empty/malformed XML gracefully', () => {
      expect(parseQuickReflectionResponse('', []).length).toBe(0);
      expect(parseQuickReflectionResponse('<reflections/>', []).length).toBe(0);
      expect(parseQuickReflectionResponse('not xml at all', []).length).toBe(0);

      const deepResult = parseDeepReflectionResponse('garbage', []);
      expect(deepResult.patterns.length).toBe(0);
      expect(deepResult.profileUpdates.length).toBe(0);
      expect(deepResult.warnings.length).toBe(0);
    });

    it('limits quick reflection to 3 insights', () => {
      const manyInsights = Array.from(
        { length: 5 },
        (_, i) =>
          `<insight category="pattern" confidence="0.5"><text>Insight ${i}</text><sources>${i + 1}</sources></insight>`,
      ).join('');
      const response = `<reflections>${manyInsights}</reflections>`;
      const insights = parseQuickReflectionResponse(response, [1, 2, 3, 4, 5]);
      expect(insights.length).toBe(3);
    });
  });

  describe('Quick Reflection Service', () => {
    it('generates insights from session observations', async () => {
      const session = createTestSession(ctx.db);
      for (let i = 0; i < 3; i++) {
        insertObservation(ctx.db, {
          sessionId: session,
          project: '/tmp/test',
          type: 'discovery',
          title: `Authentication middleware pattern ${i}`,
          importance: 7,
        });
      }

      const stored = await quickReflect(ctx.db, mockProvider, session, '/tmp/test');
      expect(stored).toBe(2); // Mock returns 2 insights

      const reflections = getReflectionsBySession(ctx.db, session);
      expect(reflections.length).toBe(2);
      expect(reflections[0].type).toBe('quick');
    });

    it('skips when too few observations', async () => {
      const session = createTestSession(ctx.db);
      insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Single obs',
      });

      const stored = await quickReflect(ctx.db, mockProvider, session, '/tmp/test');
      expect(stored).toBe(0);
    });

    it('handles AI failure gracefully', async () => {
      const session = createTestSession(ctx.db);
      for (let i = 0; i < 3; i++) {
        insertObservation(ctx.db, {
          sessionId: session,
          project: '/tmp/test',
          type: 'discovery',
          title: `Obs ${i}`,
        });
      }

      const failingProvider = {
        name: 'failing',
        extract: async () => {
          throw new Error('AI unavailable');
        },
        isAvailable: async () => false,
        getLastUsage: () => null,
      };

      const stored = await quickReflect(ctx.db, failingProvider, session, '/tmp/test');
      expect(stored).toBe(0);
    });
  });

  describe('Deep Reflection Service', () => {
    it('shouldRunDeepReflection triggers at correct interval', () => {
      // No sessions yet
      expect(shouldRunDeepReflection(ctx.db, '/tmp/test', 5)).toBe(false);

      // Create 5 completed sessions
      for (let i = 0; i < 5; i++) {
        createTestSession(ctx.db, '/tmp/test', 'completed');
      }
      expect(shouldRunDeepReflection(ctx.db, '/tmp/test', 5)).toBe(true);

      // 6 sessions — not on interval
      createTestSession(ctx.db, '/tmp/test', 'completed');
      expect(shouldRunDeepReflection(ctx.db, '/tmp/test', 5)).toBe(false);

      // 10 sessions — on interval again
      for (let i = 0; i < 4; i++) {
        createTestSession(ctx.db, '/tmp/test', 'completed');
      }
      expect(shouldRunDeepReflection(ctx.db, '/tmp/test', 5)).toBe(true);
    });

    it('generates patterns and profile entries', async () => {
      const deepProvider = {
        name: 'mock-deep',
        extract: async () => mockDeepReflectionResponse,
        isAvailable: async () => true,
        getLastUsage: () => null,
      };

      // Need completed sessions with observations
      for (let i = 0; i < 5; i++) {
        const session = createTestSession(ctx.db, '/tmp/test', 'completed');
        for (let j = 0; j < 2; j++) {
          insertObservation(ctx.db, {
            sessionId: session,
            project: '/tmp/test',
            type: 'discovery',
            title: `Cross-session observation ${i}-${j}`,
            importance: 5 + j,
          });
        }
      }

      const result = await deepReflect(ctx.db, deepProvider, '/tmp/test');
      expect(result.patterns).toBe(1);
      expect(result.profileUpdates).toBe(2);

      // Verify reflections stored
      const reflections = getReflectionsByProject(ctx.db, '/tmp/test', { type: 'deep' });
      expect(reflections.length).toBe(1);

      // Verify profile entries created
      const profile = getProfileByProject(ctx.db, '/tmp/test');
      expect(profile.length).toBe(2);
    });

    it('skips when too few observations', async () => {
      const session = createTestSession(ctx.db, '/tmp/test', 'completed');
      insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Lonely obs',
      });

      const result = await deepReflect(ctx.db, mockProvider, '/tmp/test');
      expect(result.patterns).toBe(0);
      expect(result.profileUpdates).toBe(0);
    });
  });

  describe('Auto-Linker', () => {
    it('links similar observations via embeddings', () => {
      const session = createTestSession(ctx.db);
      const baseEmb = seededEmbedding(1);

      const obs1 = insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Auth middleware setup',
      });
      insertEmbedding(ctx.db, obs1, baseEmb);

      const obs2 = insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Auth middleware extension',
      });
      const similarEmb = perturbedEmbedding(baseEmb, 0.01);
      insertEmbedding(ctx.db, obs2, similarEmb);

      const linksCreated = autoLink(ctx.db, obs2, '/tmp/test', 0.85);
      expect(linksCreated).toBe(1);

      const links = getLinksByObservation(ctx.db, obs2);
      expect(links.length).toBe(1);
      expect(links[0].link_type).toBe('related');
      expect(links[0].confidence).toBeGreaterThan(0.85);
    });

    it('does not link dissimilar observations', () => {
      const session = createTestSession(ctx.db);

      const obs1 = insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Database setup',
      });
      insertEmbedding(ctx.db, obs1, seededEmbedding(1));

      const obs2 = insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test',
        type: 'discovery',
        title: 'UI rendering',
      });
      insertEmbedding(ctx.db, obs2, seededEmbedding(999));

      const linksCreated = autoLink(ctx.db, obs2, '/tmp/test', 0.85);
      expect(linksCreated).toBe(0);
    });

    it('returns 0 when observation has no embedding', () => {
      const session = createTestSession(ctx.db);
      insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test',
        type: 'discovery',
        title: 'No embedding',
      });

      const linksCreated = autoLink(ctx.db, 1, '/tmp/test');
      expect(linksCreated).toBe(0);
    });
  });

  describe('Prompt Builders', () => {
    it('buildQuickReflectionPrompt includes observations and summary', () => {
      const observations = [
        {
          id: 1,
          session_id: 1,
          project: '/tmp/test',
          branch: null,
          source_ide: 'claude-code',
          type: 'bugfix' as const,
          title: 'Fixed null check',
          facts: JSON.stringify(['Added null guard']),
          concepts: null,
          files_affected: null,
          importance: 7,
          scope: 'project' as const,
          prompt_number: null,
          created_at: '',
          created_at_epoch: Date.now(),
        },
      ];
      const summary = { request: 'Fix auth bug', learned: 'Need null checks', completed: 'Bug fixed' };
      const prompt = buildQuickReflectionPrompt(observations, summary);

      expect(prompt).toContain('Fixed null check');
      expect(prompt).toContain('Added null guard');
      expect(prompt).toContain('Fix auth bug');
    });

    it('buildDeepReflectionPrompt includes profile context', () => {
      const observations = [
        {
          id: 1,
          session_id: 1,
          project: '/tmp/test',
          branch: null,
          source_ide: 'claude-code',
          type: 'discovery' as const,
          title: 'Found pattern',
          facts: null,
          concepts: JSON.stringify(['TypeScript']),
          files_affected: null,
          importance: 5,
          scope: 'project' as const,
          prompt_number: null,
          created_at: '',
          created_at_epoch: Date.now(),
        },
      ];
      const profile = [{ category: 'preference', description: 'Prefers TypeScript', confidence: 0.8 }];
      const prompt = buildDeepReflectionPrompt(observations, profile);

      expect(prompt).toContain('Found pattern');
      expect(prompt).toContain('TypeScript');
      expect(prompt).toContain('Prefers TypeScript');
    });
  });

  describe('Context Builder with Reflections', () => {
    it('includes developer profile section', () => {
      const session = createTestSession(ctx.db);
      insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Test obs',
        importance: 5,
      });
      insertProfileEntry(ctx.db, {
        project: '/tmp/test',
        category: 'preference',
        description: 'Prefers Bun runtime over Node.js',
        confidence: 0.8,
      });

      const context = buildContext(ctx.db, {
        project: '/tmp/test',
        tokenBudget: 4000,
        showInlineSummary: true,
      });

      expect(context).toContain('Developer Profile');
      expect(context).toContain('Prefers Bun runtime');
    });

    it('includes insights section from reflections', () => {
      const session = createTestSession(ctx.db);
      insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test',
        type: 'discovery',
        title: 'Test obs',
        importance: 5,
      });
      insertReflection(ctx.db, {
        sessionId: session,
        project: '/tmp/test',
        type: 'quick',
        insight: 'Middleware pattern used consistently',
        category: 'pattern',
      });

      const context = buildContext(ctx.db, {
        project: '/tmp/test',
        tokenBudget: 4000,
        showInlineSummary: true,
      });

      expect(context).toContain('Insights');
      expect(context).toContain('Middleware pattern used consistently');
    });

    it('respects token budget across all sections', () => {
      const session = createTestSession(ctx.db);

      // Add many profile entries and reflections
      for (let i = 0; i < 20; i++) {
        insertProfileEntry(ctx.db, {
          project: '/tmp/test',
          category: 'pattern',
          description: `Pattern ${i}: ${'x'.repeat(100)}`,
          confidence: 0.5,
        });
      }

      for (let i = 0; i < 20; i++) {
        insertObservation(ctx.db, {
          sessionId: session,
          project: '/tmp/test',
          type: 'discovery',
          title: `Observation with lots of detail ${i}: ${'y'.repeat(200)}`,
          importance: 5,
        });
      }

      // Very small budget
      const context = buildContext(ctx.db, {
        project: '/tmp/test',
        tokenBudget: 500,
        showInlineSummary: true,
      });

      // Should be within budget (rough check: 500 tokens ≈ 2000 chars)
      expect(context.length).toBeLessThan(3000);
    });
  });

  describe('Data Routes', () => {
    it('GET /data/reflections returns reflections', async () => {
      const session = createTestSession(ctx.db);
      insertReflection(ctx.db, {
        sessionId: session,
        project: '/tmp/test-project',
        type: 'quick',
        insight: 'Test insight',
        category: 'pattern',
      });

      const res = await fetch(`${ctx.baseUrl}/data/reflections?project=/tmp/test-project`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.reflections.length).toBe(1);
      expect(data.reflections[0].insight).toBe('Test insight');
    });

    it('GET /data/profile returns profile entries', async () => {
      insertProfileEntry(ctx.db, {
        project: '/tmp/test-project',
        category: 'preference',
        description: 'Prefers TypeScript',
        confidence: 0.9,
      });

      const res = await fetch(`${ctx.baseUrl}/data/profile?project=/tmp/test-project`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.entries.length).toBe(1);
      expect(data.entries[0].description).toBe('Prefers TypeScript');
    });

    it('GET /data/links returns observation links', async () => {
      const session = createTestSession(ctx.db);
      const obs1 = insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test-project',
        type: 'discovery',
        title: 'Obs 1',
      });
      const obs2 = insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/test-project',
        type: 'discovery',
        title: 'Obs 2',
      });
      insertLink(ctx.db, { sourceId: obs1, targetId: obs2, linkType: 'related', confidence: 0.95 });

      const res = await fetch(`${ctx.baseUrl}/data/links?observationId=${obs1}`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.links.length).toBe(1);
      expect(data.links[0].link_type).toBe('related');
    });
  });

  describe('Settings includes reflection config', () => {
    it('settings endpoint returns reflection section', async () => {
      const res = await fetch(`${ctx.baseUrl}/settings`);
      expect(res.status).toBe(200);
      const settings = (await res.json()) as any;
      expect(settings.reflection).toBeTruthy();
      expect(settings.reflection.enabled).toBe(true);
      expect(settings.reflection.deepReflectionInterval).toBe(5);
      expect(settings.reflection.autoLinkingEnabled).toBe(true);
      expect(settings.reflection.autoLinkThreshold).toBe(0.85);
    });
  });
});
