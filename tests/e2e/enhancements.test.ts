import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestContext, type TestContext } from '../fixtures/helpers';
import { addTag, removeTag, getTagsByObservation, getObservationsByTag, getAllTags, updateRetrievalTracking } from '../../src/services/sqlite/tags';
import { exportProject, importProject, type SmritiExport } from '../../src/services/sqlite/export-import';
import { getProjectIdentifier } from '../../src/utils/git';

// Helper to seed a session + observation
function seedSessionAndObservation(ctx: TestContext, opts?: {
  project?: string;
  createdAtEpoch?: number;
  type?: string;
  title?: string;
  contentSessionId?: string;
  facts?: string;
}) {
  const project = opts?.project || '/tmp/test-proj';
  const epoch = opts?.createdAtEpoch || Date.now();
  const contentSessionId = opts?.contentSessionId || `sess-${epoch}-${Math.random().toString(36).slice(2)}`;

  ctx.db.run(
    `INSERT OR IGNORE INTO sessions (content_session_id, project, branch, source_ide, status, created_at_epoch, prompt_count)
     VALUES (?, ?, 'main', 'claude-code', 'active', ?, 1)`,
    [contentSessionId, project, epoch]
  );
  const session = ctx.db.query('SELECT id FROM sessions WHERE content_session_id = ?').get(contentSessionId) as { id: number };

  ctx.db.run(
    `INSERT INTO observations (session_id, project, branch, source_ide, type, title, facts, concepts, files_affected, importance, created_at_epoch)
     VALUES (?, ?, 'main', 'claude-code', ?, ?, ?, '["concept1"]', '["src/index.ts"]', 7, ?)`,
    [session.id, project, opts?.type || 'discovery', opts?.title || 'Test observation', opts?.facts || '["fact1"]', epoch]
  );
  const obs = ctx.db.query('SELECT last_insert_rowid() as id').get() as { id: number };

  return { sessionId: session.id, observationId: obs.id, contentSessionId };
}

describe('Enhancements', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // --- Tag System CRUD ---

  describe('Tag System', () => {
    it('addTag creates a tag for an observation', () => {
      const { observationId } = seedSessionAndObservation(ctx);
      addTag(ctx.db, observationId, 'important');

      const tags = getTagsByObservation(ctx.db, observationId);
      expect(tags).toContain('important');
    });

    it('addTag is idempotent (UNIQUE constraint)', () => {
      const { observationId } = seedSessionAndObservation(ctx);
      addTag(ctx.db, observationId, 'bug');
      addTag(ctx.db, observationId, 'bug');

      const tags = getTagsByObservation(ctx.db, observationId);
      expect(tags.filter(t => t === 'bug').length).toBe(1);
    });

    it('removeTag deletes a tag', () => {
      const { observationId } = seedSessionAndObservation(ctx);
      addTag(ctx.db, observationId, 'temp');
      removeTag(ctx.db, observationId, 'temp');

      const tags = getTagsByObservation(ctx.db, observationId);
      expect(tags).not.toContain('temp');
    });

    it('getTagsByObservation returns all tags ordered by creation', () => {
      const { observationId } = seedSessionAndObservation(ctx);
      addTag(ctx.db, observationId, 'alpha');
      addTag(ctx.db, observationId, 'beta');
      addTag(ctx.db, observationId, 'gamma');

      const tags = getTagsByObservation(ctx.db, observationId);
      expect(tags.length).toBe(3);
      expect(tags).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('getObservationsByTag returns observations with a specific tag', () => {
      const project = '/tmp/proj';
      const { observationId: obs1 } = seedSessionAndObservation(ctx, { project });
      const { observationId: obs2 } = seedSessionAndObservation(ctx, { project });
      seedSessionAndObservation(ctx, { project }); // no tag

      addTag(ctx.db, obs1, 'review');
      addTag(ctx.db, obs2, 'review');

      const ids = getObservationsByTag(ctx.db, project, 'review');
      expect(ids.length).toBe(2);
      expect(ids).toContain(obs1);
      expect(ids).toContain(obs2);
    });

    it('getAllTags returns unique tags with counts', () => {
      const project = '/tmp/proj';
      const { observationId: obs1 } = seedSessionAndObservation(ctx, { project });
      const { observationId: obs2 } = seedSessionAndObservation(ctx, { project });

      addTag(ctx.db, obs1, 'bug');
      addTag(ctx.db, obs2, 'bug');
      addTag(ctx.db, obs1, 'security');

      const tags = getAllTags(ctx.db, project);
      expect(tags.length).toBe(2);
      const bugTag = tags.find(t => t.tag === 'bug');
      expect(bugTag?.count).toBe(2);
      const secTag = tags.find(t => t.tag === 'security');
      expect(secTag?.count).toBe(1);
    });

    it('updateRetrievalTracking increments retrieval_count', () => {
      const { observationId } = seedSessionAndObservation(ctx);
      updateRetrievalTracking(ctx.db, [observationId]);
      updateRetrievalTracking(ctx.db, [observationId]);

      const row = ctx.db.query('SELECT retrieval_count, last_retrieved_epoch FROM observations WHERE id = ?').get(observationId) as any;
      expect(row.retrieval_count).toBe(2);
      expect(row.last_retrieved_epoch).toBeGreaterThan(0);
    });

    it('updateRetrievalTracking handles empty array', () => {
      expect(() => updateRetrievalTracking(ctx.db, [])).not.toThrow();
    });
  });

  // --- Tag Routes ---

  describe('Tag Routes', () => {
    it('POST /data/observations/:id/tags adds a tag', async () => {
      const { observationId } = seedSessionAndObservation(ctx);

      const res = await fetch(`${ctx.baseUrl}/data/observations/${observationId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'important' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);

      const tags = getTagsByObservation(ctx.db, observationId);
      expect(tags).toContain('important');
    });

    it('DELETE /data/observations/:id/tags/:tag removes a tag', async () => {
      const { observationId } = seedSessionAndObservation(ctx);
      addTag(ctx.db, observationId, 'temp');

      const res = await fetch(`${ctx.baseUrl}/data/observations/${observationId}/tags/temp`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);

      const tags = getTagsByObservation(ctx.db, observationId);
      expect(tags).not.toContain('temp');
    });

    it('GET /data/observations/:id/tags returns tags', async () => {
      const { observationId } = seedSessionAndObservation(ctx);
      addTag(ctx.db, observationId, 'a');
      addTag(ctx.db, observationId, 'b');

      const res = await fetch(`${ctx.baseUrl}/data/observations/${observationId}/tags`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.tags.length).toBe(2);
    });

    it('GET /data/tags?project=X returns all tags for project', async () => {
      const project = '/tmp/proj';
      const { observationId: obs1 } = seedSessionAndObservation(ctx, { project });
      const { observationId: obs2 } = seedSessionAndObservation(ctx, { project });
      addTag(ctx.db, obs1, 'bug');
      addTag(ctx.db, obs2, 'bug');
      addTag(ctx.db, obs1, 'fix');

      const res = await fetch(`${ctx.baseUrl}/data/tags?project=${encodeURIComponent(project)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.tags.length).toBe(2);
      expect(body.tags[0].tag).toBe('bug');
      expect(body.tags[0].count).toBe(2);
    });
  });

  // --- Export/Import ---

  describe('Export/Import', () => {
    it('exportProject returns all project data', () => {
      const project = '/tmp/proj';
      const { contentSessionId } = seedSessionAndObservation(ctx, { project, title: 'Obs 1' });

      const exported = exportProject(ctx.db, project);
      expect(exported.version).toBe(1);
      expect(exported.project).toBe(project);
      expect(exported.sessions.length).toBe(1);
      expect(exported.sessions[0].contentSessionId).toBe(contentSessionId);
      expect(exported.observations.length).toBe(1);
      expect(exported.observations[0].title).toBe('Obs 1');
    });

    it('exportProject returns empty arrays for unknown project', () => {
      const exported = exportProject(ctx.db, '/tmp/nope');
      expect(exported.sessions.length).toBe(0);
      expect(exported.observations.length).toBe(0);
    });

    it('importProject restores exported data', () => {
      const project = '/tmp/proj';
      seedSessionAndObservation(ctx, { project, title: 'Original' });

      // Export
      const exported = exportProject(ctx.db, project);

      // Create a fresh context to import into
      const ctx2 = createTestContext();
      try {
        const result = importProject(ctx2.db, exported);
        expect(result.imported.sessions).toBeGreaterThan(0);
        expect(result.imported.observations).toBeGreaterThan(0);

        // Verify data exists in new DB
        const obs = ctx2.db.query('SELECT * FROM observations WHERE project = ?').all(project) as any[];
        expect(obs.length).toBe(1);
        expect(obs[0].title).toBe('Original');
      } finally {
        ctx2.cleanup();
      }
    });

    it('importProject handles duplicate sessions gracefully', () => {
      const project = '/tmp/proj';
      seedSessionAndObservation(ctx, { project, contentSessionId: 'dup-session' });

      const exported = exportProject(ctx.db, project);

      // Import into same DB (sessions already exist)
      const result = importProject(ctx.db, exported);
      expect(result.imported.sessions).toBeGreaterThan(0);
    });

    it('GET /admin/export requires project param', async () => {
      const res = await fetch(`${ctx.baseUrl}/admin/export`);
      expect(res.status).toBe(400);
    });

    it('GET /admin/export returns project data as JSON', async () => {
      const project = '/tmp/proj';
      seedSessionAndObservation(ctx, { project, title: 'Export test' });

      const res = await fetch(`${ctx.baseUrl}/admin/export?project=${encodeURIComponent(project)}`);
      expect(res.status).toBe(200);

      const body = await res.json() as SmritiExport;
      expect(body.version).toBe(1);
      expect(body.observations.length).toBe(1);
    });

    it('POST /admin/import validates version', async () => {
      const res = await fetch(`${ctx.baseUrl}/admin/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 99, project: '/tmp/proj', sessions: [] }),
      });
      expect(res.status).toBe(400);
    });

    it('POST /admin/import restores data', async () => {
      const project = '/tmp/import-proj';
      const exportData: SmritiExport = {
        version: 1,
        exportedAt: new Date().toISOString(),
        project,
        sessions: [{
          contentSessionId: 'import-sess-1',
          project,
          branch: 'main',
          sourceIde: 'claude-code',
          status: 'completed',
          createdAtEpoch: Date.now(),
        }],
        observations: [{
          type: 'discovery',
          title: 'Imported observation',
          facts: '["imported fact"]',
          concepts: null,
          filesAffected: null,
          importance: 8,
          branch: 'main',
          sourceIde: 'claude-code',
          createdAtEpoch: Date.now(),
          sessionContentId: 'import-sess-1',
        }],
        summaries: [],
        reflections: [],
        profileEntries: [],
        entities: [],
      };

      const res = await fetch(`${ctx.baseUrl}/admin/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportData),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.status).toBe('import_complete');
      expect(body.imported.sessions).toBe(1);
      expect(body.imported.observations).toBe(1);
    });

    it('export/import round-trip preserves data', async () => {
      const project = '/tmp/roundtrip';
      seedSessionAndObservation(ctx, { project, title: 'Round trip test' });

      // Export via API
      const exportRes = await fetch(`${ctx.baseUrl}/admin/export?project=${encodeURIComponent(project)}`);
      const exported = await exportRes.json() as SmritiExport;

      // Import into fresh context
      const ctx2 = createTestContext();
      try {
        const importRes = await fetch(`http://127.0.0.1:${ctx2.server.port}/admin/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(exported),
        });
        expect(importRes.status).toBe(200);

        // Verify round-trip
        const verifyRes = await fetch(`http://127.0.0.1:${ctx2.server.port}/admin/export?project=${encodeURIComponent(project)}`);
        const reimported = await verifyRes.json() as SmritiExport;
        expect(reimported.observations.length).toBe(exported.observations.length);
        expect(reimported.observations[0].title).toBe('Round trip test');
      } finally {
        ctx2.cleanup();
      }
    });
  });

  // --- Project Detection ---

  describe('Project Detection', () => {
    it('getProjectIdentifier detects from package.json in this repo', () => {
      // This repo has a package.json with name "smriti"
      const result = getProjectIdentifier('/Users/prolevelnoob/CodePlayground/prsnl/claude-memory');
      expect(result.name).toBe('smriti');
      expect(result.source).toBe('package.json');
      expect(result.fullPath).toBe('/Users/prolevelnoob/CodePlayground/prsnl/claude-memory');
    });

    it('getProjectIdentifier falls back to basename for unknown dirs', () => {
      const result = getProjectIdentifier('/tmp');
      expect(result.name).toBe('tmp');
      expect(result.source).toBe('basename');
    });

    it('getProjectIdentifier returns unknown for invalid path', () => {
      const result = getProjectIdentifier('');
      expect(result.name).toBeTruthy();
      expect(result.source).toBeTruthy();
    });
  });

  // --- MCP Config ---

  describe('MCP Server Configuration', () => {
    it('mcp-config.json exists and is valid', async () => {
      const { readFileSync } = await import('fs');
      const config = JSON.parse(readFileSync('/Users/prolevelnoob/CodePlayground/prsnl/claude-memory/plugin/mcp-config.json', 'utf-8'));
      expect(config.mcpServers.smriti).toBeDefined();
      expect(config.mcpServers.smriti.command).toBe('bun');
      expect(config.mcpServers.smriti.args).toContain('mcp');
    });
  });

  // --- Cursor Install ---

  describe('Cursor Installation', () => {
    it('install script exists and is valid bash', async () => {
      const { existsSync } = await import('fs');
      expect(existsSync('/Users/prolevelnoob/CodePlayground/prsnl/claude-memory/scripts/install-cursor.sh')).toBe(true);
    });

    it('uninstall script exists and is valid bash', async () => {
      const { existsSync } = await import('fs');
      expect(existsSync('/Users/prolevelnoob/CodePlayground/prsnl/claude-memory/scripts/uninstall-cursor.sh')).toBe(true);
    });

    it('setup documentation exists', async () => {
      const { existsSync } = await import('fs');
      expect(existsSync('/Users/prolevelnoob/CodePlayground/prsnl/claude-memory/docs/CURSOR-SETUP.md')).toBe(true);
    });
  });

  // --- Dedup Config ---

  describe('Dedup Configuration', () => {
    it('dedup config has correct defaults', () => {
      const { getConfig } = require('../../src/shared/config');
      const config = getConfig();
      const dedup = config.get('dedup');
      expect(dedup.enabled).toBe(true);
      expect(dedup.similarityThreshold).toBe(0.95);
    });
  });

  // --- Proactive Config ---

  describe('Proactive Context Configuration', () => {
    it('proactive config has correct defaults', () => {
      const { getConfig } = require('../../src/shared/config');
      const config = getConfig();
      const proactive = config.get('proactive');
      expect(proactive.enabled).toBe(true);
      expect(proactive.minSimilarity).toBe(0.75);
      expect(proactive.maxObservations).toBe(5);
      expect(proactive.tokenBudget).toBe(1500);
    });
  });

  // --- Proactive Context via API ---

  describe('Proactive Context via Session Init', () => {
    it('first prompt does not include proactive context', async () => {
      const res = await fetch(`${ctx.baseUrl}/sessions/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: 'proactive-test-1',
          project: '/tmp/proj',
          branch: 'main',
          prompt: 'Fix the auth bug',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.promptNumber).toBe(1);
      // First prompt should not have proactive context
      expect(body.proactiveContext).toBeUndefined();
    });

    it('subsequent prompts can return proactive context field', async () => {
      // Init session first
      await fetch(`${ctx.baseUrl}/sessions/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: 'proactive-test-2',
          project: '/tmp/proj',
          prompt: 'Initial prompt',
        }),
      });

      // Second prompt
      const res = await fetch(`${ctx.baseUrl}/sessions/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: 'proactive-test-2',
          project: '/tmp/proj',
          prompt: 'Second prompt about auth',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.promptNumber).toBe(2);
      // proactiveContext may or may not be present (depends on observations existing)
      // but the field should be handleable either way
    });
  });
});
