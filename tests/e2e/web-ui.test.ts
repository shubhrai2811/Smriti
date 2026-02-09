import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'fs';
import { join } from 'path';
import { insertProfileEntry } from '../../src/services/sqlite/developer-profile';
import { insertLink } from '../../src/services/sqlite/observation-links';
import { insertObservation } from '../../src/services/sqlite/observations';
import { insertReflection } from '../../src/services/sqlite/reflections';
import { createTestContext } from '../fixtures/helpers';

// Helper: create a test session
function createTestSession(
  db: any,
  project: string = '/tmp/test-project',
  status: string = 'completed',
  sourceIde: string = 'claude-code',
): number {
  db.query(
    'INSERT INTO sessions (content_session_id, project, branch, source_ide, status, created_at_epoch) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(`test-${Date.now()}-${Math.random()}`, project, 'main', sourceIde, status, Date.now());
  return (db.query('SELECT last_insert_rowid() as id').get() as any).id;
}

describe('Web UI E2E', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('UI Serve Route', () => {
    it('GET /ui returns HTML', async () => {
      const res = await fetch(`${ctx.baseUrl}/ui`);
      // Serves fallback HTML if viewer.html not found from cwd
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<html');
      expect(html).toContain('Smriti');
    });

    it('GET /ui/ returns HTML', async () => {
      const res = await fetch(`${ctx.baseUrl}/ui/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<html');
    });

    it('GET /ui/timeline returns HTML (SPA catchall)', async () => {
      const res = await fetch(`${ctx.baseUrl}/ui/timeline`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<html');
    });

    it('GET /ui/sessions returns HTML (SPA catchall)', async () => {
      const res = await fetch(`${ctx.baseUrl}/ui/sessions`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<html');
    });
  });

  describe('Data API: Sessions', () => {
    it('GET /data/sessions returns empty list initially', async () => {
      const res = await fetch(`${ctx.baseUrl}/data/sessions`);
      expect(res.ok).toBe(true);
      const json = (await res.json()) as any;
      expect(json.sessions).toBeArray();
      expect(json.sessions.length).toBe(0);
    });

    it('GET /data/sessions returns sessions after creation', async () => {
      createTestSession(ctx.db, '/tmp/proj');
      createTestSession(ctx.db, '/tmp/proj');

      const res = await fetch(`${ctx.baseUrl}/data/sessions?project=/tmp/proj`);
      const json = (await res.json()) as any;
      expect(json.sessions.length).toBe(2);
    });

    it('GET /data/sessions filters by project', async () => {
      createTestSession(ctx.db, '/tmp/project-a');
      createTestSession(ctx.db, '/tmp/project-b');

      const res = await fetch(`${ctx.baseUrl}/data/sessions?project=/tmp/project-a`);
      const json = (await res.json()) as any;
      expect(json.sessions.length).toBe(1);
      expect(json.sessions[0].project).toBe('/tmp/project-a');
    });

    it('GET /data/sessions respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        createTestSession(ctx.db, '/tmp/proj');
      }

      const res = await fetch(`${ctx.baseUrl}/data/sessions?project=/tmp/proj&limit=3`);
      const json = (await res.json()) as any;
      expect(json.sessions.length).toBe(3);
    });
  });

  describe('Data API: Observations', () => {
    it('GET /data/observations returns empty list initially', async () => {
      const res = await fetch(`${ctx.baseUrl}/data/observations`);
      expect(res.ok).toBe(true);
      const json = (await res.json()) as any;
      expect(json.observations).toBeArray();
      expect(json.observations.length).toBe(0);
    });

    it('GET /data/observations returns observations', async () => {
      const session = createTestSession(ctx.db, '/tmp/proj');
      insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/proj',
        type: 'discovery',
        title: 'Found the bug',
        importance: 7,
      });
      insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/proj',
        type: 'bugfix',
        title: 'Fixed the bug',
        importance: 8,
      });

      const res = await fetch(`${ctx.baseUrl}/data/observations?project=/tmp/proj`);
      const json = (await res.json()) as any;
      expect(json.observations.length).toBe(2);
    });

    it('GET /data/observations filters by project', async () => {
      const s1 = createTestSession(ctx.db, '/tmp/proj-a');
      const s2 = createTestSession(ctx.db, '/tmp/proj-b');
      insertObservation(ctx.db, {
        sessionId: s1,
        project: '/tmp/proj-a',
        type: 'discovery',
        title: 'Obs A',
        importance: 5,
      });
      insertObservation(ctx.db, {
        sessionId: s2,
        project: '/tmp/proj-b',
        type: 'discovery',
        title: 'Obs B',
        importance: 5,
      });

      const res = await fetch(`${ctx.baseUrl}/data/observations?project=/tmp/proj-a`);
      const json = (await res.json()) as any;
      expect(json.observations.length).toBe(1);
      expect(json.observations[0].title).toBe('Obs A');
    });

    it('GET /data/observations filters by branch', async () => {
      const session = createTestSession(ctx.db, '/tmp/proj');
      insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/proj',
        branch: 'main',
        type: 'discovery',
        title: 'Main obs',
        importance: 5,
      });
      insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/proj',
        branch: 'feature',
        type: 'discovery',
        title: 'Feature obs',
        importance: 5,
      });

      const res = await fetch(`${ctx.baseUrl}/data/observations?project=/tmp/proj&branch=feature`);
      const json = (await res.json()) as any;
      expect(json.observations.length).toBe(1);
      expect(json.observations[0].title).toBe('Feature obs');
    });

    it('GET /data/observations respects limit', async () => {
      const session = createTestSession(ctx.db, '/tmp/proj');
      for (let i = 0; i < 10; i++) {
        insertObservation(ctx.db, {
          sessionId: session,
          project: '/tmp/proj',
          type: 'discovery',
          title: `Obs ${i}`,
          importance: 5,
        });
      }

      const res = await fetch(`${ctx.baseUrl}/data/observations?project=/tmp/proj&limit=3`);
      const json = (await res.json()) as any;
      expect(json.observations.length).toBe(3);
    });

    it('observation response includes expected fields', async () => {
      const session = createTestSession(ctx.db, '/tmp/proj');
      insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/proj',
        type: 'bugfix',
        title: 'Fix crash',
        facts: '["app crashes on start"]',
        concepts: '["error handling"]',
        filesAffected: '["main.ts"]',
        importance: 9,
      });

      const res = await fetch(`${ctx.baseUrl}/data/observations?project=/tmp/proj`);
      const json = (await res.json()) as any;
      const obs = json.observations[0];
      expect(obs.id).toBeNumber();
      expect(obs.type).toBe('bugfix');
      expect(obs.title).toBe('Fix crash');
      expect(obs.facts).toBe('["app crashes on start"]');
      expect(obs.concepts).toBe('["error handling"]');
      expect(obs.files_affected).toBe('["main.ts"]');
      expect(obs.importance).toBe(9);
      expect(obs.project).toBe('/tmp/proj');
    });
  });

  describe('Data API: Reflections', () => {
    it('GET /data/reflections returns empty list initially', async () => {
      const res = await fetch(`${ctx.baseUrl}/data/reflections`);
      expect(res.ok).toBe(true);
      const json = (await res.json()) as any;
      expect(json.reflections).toBeArray();
      expect(json.reflections.length).toBe(0);
    });

    it('GET /data/reflections returns reflections', async () => {
      const session = createTestSession(ctx.db, '/tmp/proj');
      insertReflection(ctx.db, {
        sessionId: session,
        project: '/tmp/proj',
        type: 'quick',
        insight: 'Tests should run fast',
        category: 'pattern',
      });
      insertReflection(ctx.db, {
        sessionId: session,
        project: '/tmp/proj',
        type: 'deep',
        insight: 'Architecture needs refactoring',
        category: 'improvement',
      });

      const res = await fetch(`${ctx.baseUrl}/data/reflections?project=/tmp/proj`);
      const json = (await res.json()) as any;
      expect(json.reflections.length).toBe(2);
    });

    it('GET /data/reflections filters by type', async () => {
      const session = createTestSession(ctx.db, '/tmp/proj');
      insertReflection(ctx.db, {
        sessionId: session,
        project: '/tmp/proj',
        type: 'quick',
        insight: 'Quick insight',
      });
      insertReflection(ctx.db, {
        sessionId: session,
        project: '/tmp/proj',
        type: 'deep',
        insight: 'Deep insight',
      });

      const res = await fetch(`${ctx.baseUrl}/data/reflections?project=/tmp/proj&type=quick`);
      const json = (await res.json()) as any;
      expect(json.reflections.length).toBe(1);
      expect(json.reflections[0].insight).toBe('Quick insight');
    });

    it('GET /data/reflections filters by project', async () => {
      const s1 = createTestSession(ctx.db, '/tmp/proj-a');
      const s2 = createTestSession(ctx.db, '/tmp/proj-b');
      insertReflection(ctx.db, {
        sessionId: s1,
        project: '/tmp/proj-a',
        type: 'quick',
        insight: 'Insight A',
      });
      insertReflection(ctx.db, {
        sessionId: s2,
        project: '/tmp/proj-b',
        type: 'quick',
        insight: 'Insight B',
      });

      const res = await fetch(`${ctx.baseUrl}/data/reflections?project=/tmp/proj-a`);
      const json = (await res.json()) as any;
      expect(json.reflections.length).toBe(1);
      expect(json.reflections[0].insight).toBe('Insight A');
    });
  });

  describe('Data API: Profile', () => {
    it('GET /data/profile returns empty list initially', async () => {
      const res = await fetch(`${ctx.baseUrl}/data/profile`);
      expect(res.ok).toBe(true);
      const json = (await res.json()) as any;
      expect(json.entries).toBeArray();
      expect(json.entries.length).toBe(0);
    });

    it('GET /data/profile returns profile entries', async () => {
      insertProfileEntry(ctx.db, {
        project: '/tmp/proj',
        category: 'preference',
        description: 'Prefers functional style',
      });
      insertProfileEntry(ctx.db, {
        project: '/tmp/proj',
        category: 'pattern',
        description: 'Uses early returns',
      });

      const res = await fetch(`${ctx.baseUrl}/data/profile?project=/tmp/proj`);
      const json = (await res.json()) as any;
      expect(json.entries.length).toBe(2);
    });

    it('GET /data/profile filters by category', async () => {
      insertProfileEntry(ctx.db, {
        project: '/tmp/proj',
        category: 'preference',
        description: 'Prefers TypeScript',
      });
      insertProfileEntry(ctx.db, {
        project: '/tmp/proj',
        category: 'pattern',
        description: 'Uses early returns',
      });

      const res = await fetch(`${ctx.baseUrl}/data/profile?project=/tmp/proj&category=preference`);
      const json = (await res.json()) as any;
      expect(json.entries.length).toBe(1);
      expect(json.entries[0].description).toBe('Prefers TypeScript');
    });

    it('profile entry includes expected fields', async () => {
      insertProfileEntry(ctx.db, {
        project: '/tmp/proj',
        category: 'style',
        description: 'Minimal comments',
        confidence: 0.8,
        evidenceCount: 5,
        sourceReflectionIds: '[1, 2]',
      });

      const res = await fetch(`${ctx.baseUrl}/data/profile?project=/tmp/proj`);
      const json = (await res.json()) as any;
      const entry = json.entries[0];
      expect(entry.id).toBeNumber();
      expect(entry.category).toBe('style');
      expect(entry.description).toBe('Minimal comments');
      expect(entry.confidence).toBe(0.8);
      expect(entry.evidence_count).toBe(5);
      expect(entry.source_reflection_ids).toBe('[1, 2]');
    });
  });

  describe('Data API: Links', () => {
    it('GET /data/links requires observationId', async () => {
      const res = await fetch(`${ctx.baseUrl}/data/links`);
      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.error).toBeTruthy();
    });

    it('GET /data/links returns empty for observation with no links', async () => {
      const session = createTestSession(ctx.db, '/tmp/proj');
      const obsId = insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/proj',
        type: 'discovery',
        title: 'Lonely observation',
        importance: 5,
      });

      const res = await fetch(`${ctx.baseUrl}/data/links?observationId=${obsId}`);
      expect(res.ok).toBe(true);
      const json = (await res.json()) as any;
      expect(json.links).toBeArray();
      expect(json.links.length).toBe(0);
    });

    it('GET /data/links returns linked observations', async () => {
      const session = createTestSession(ctx.db, '/tmp/proj');
      const obs1 = insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/proj',
        type: 'discovery',
        title: 'Found issue',
        importance: 7,
      });
      const obs2 = insertObservation(ctx.db, {
        sessionId: session,
        project: '/tmp/proj',
        type: 'bugfix',
        title: 'Fixed issue',
        importance: 8,
      });

      insertLink(ctx.db, {
        sourceId: obs1,
        targetId: obs2,
        linkType: 'fixed_by',
        confidence: 0.9,
      });

      const res = await fetch(`${ctx.baseUrl}/data/links?observationId=${obs1}`);
      const json = (await res.json()) as any;
      expect(json.links.length).toBeGreaterThanOrEqual(1);
      expect(json.links[0].link_type).toBe('fixed_by');
    });
  });

  describe('Settings API', () => {
    it('GET /settings returns all settings sections', async () => {
      const res = await fetch(`${ctx.baseUrl}/settings`);
      expect(res.ok).toBe(true);
      const settings = (await res.json()) as any;

      expect(settings.worker).toBeTruthy();
      expect(settings.extraction).toBeTruthy();
      expect(settings.context).toBeTruthy();
      expect(settings.scoring).toBeTruthy();
      expect(settings.reflection).toBeTruthy();
      expect(settings.provider).toBeTruthy();
      expect(settings.masking).toBeTruthy();
      expect(settings.privacy).toBeTruthy();
      expect(settings.log).toBeTruthy();
    });

    it('settings have expected defaults', async () => {
      const res = await fetch(`${ctx.baseUrl}/settings`);
      const settings = (await res.json()) as any;

      expect(settings.context.tokenBudget).toBe(4000);
      expect(settings.context.showInlineSummary).toBe(true);
      expect(settings.extraction.batchSize).toBe(5);
    });
  });

  describe('Core Endpoints', () => {
    it('GET /health returns ok', async () => {
      const res = await fetch(`${ctx.baseUrl}/health`);
      expect(res.ok).toBe(true);
      const json = (await res.json()) as any;
      expect(json.status).toBe('ok');
      expect(json.uptime).toBeNumber();
    });

    it('GET /readiness returns ready', async () => {
      const res = await fetch(`${ctx.baseUrl}/readiness`);
      expect(res.ok).toBe(true);
      const json = (await res.json()) as any;
      expect(json.status).toBe('ready');
    });

    it('GET /version returns version', async () => {
      const res = await fetch(`${ctx.baseUrl}/version`);
      expect(res.ok).toBe(true);
      const json = (await res.json()) as any;
      expect(json.version).toBeTruthy();
    });
  });

  describe('Build Output', () => {
    it('viewer.html exists in build output', () => {
      const viewerPath = join(process.cwd(), 'plugin/scripts/viewer.html');
      expect(existsSync(viewerPath)).toBe(true);
    });

    it('worker-service.cjs exists in build output', () => {
      const workerPath = join(process.cwd(), 'plugin/scripts/worker-service.cjs');
      expect(existsSync(workerPath)).toBe(true);
    });
  });
});
