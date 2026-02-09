import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { getConfig, resetConfig } from '../../src/shared/config';
import { createTestContext, type TestContext } from '../fixtures/helpers';

describe('CLI Commands', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
    resetConfig();
  });

  afterEach(() => {
    ctx.cleanup();
    resetConfig();
  });

  describe('Config', () => {
    it('getConfig returns all settings', () => {
      const config = getConfig();
      const all = config.getAll();
      expect(all.worker).toBeTruthy();
      expect(all.extraction).toBeTruthy();
      expect(all.context).toBeTruthy();
      expect(all.gotcha).toBeTruthy();
      expect(all.claudemd).toBeTruthy();
    });

    it('config get/set works for string values', () => {
      const config = getConfig();
      config.set('provider', 'claudeBaseUrl', 'https://test.example.com');
      expect(config.get('provider', 'claudeBaseUrl')).toBe('https://test.example.com');
    });

    it('config get/set works for numeric values', () => {
      const config = getConfig();
      config.set('context', 'tokenBudget', 8000);
      expect(config.get('context', 'tokenBudget')).toBe(8000);
    });

    it('config get/set works for boolean values', () => {
      const config = getConfig();
      config.set('gotcha', 'enabled', false);
      expect(config.get('gotcha', 'enabled')).toBe(false);
    });

    it('config get returns section object', () => {
      const config = getConfig();
      const scoring = config.get('scoring');
      expect(scoring.vectorWeight).toBe(0.5);
      expect(scoring.recencyWeight).toBe(0.3);
    });

    it('resetConfig creates fresh instance', () => {
      const config1 = getConfig();
      config1.set('context', 'tokenBudget', 9999);
      resetConfig();
      const config2 = getConfig();
      expect(config2.get('context', 'tokenBudget')).toBe(4000); // default
    });

    it('new config sections have correct defaults', () => {
      const config = getConfig();
      expect(config.get('gotcha', 'enabled')).toBe(true);
      expect(config.get('gotcha', 'minImportance')).toBe(7);
      expect(config.get('claudemd', 'enabled')).toBe(true);
      expect(config.get('claudemd', 'maxEntries')).toBe(15);
      expect(config.get('embeddings', 'model')).toBe('Xenova/all-MiniLM-L6-v2');
      expect(config.get('embeddings', 'dimensions')).toBe(384);
      expect(config.get('provider', 'claudeBaseUrl')).toBe('');
      expect(config.get('provider', 'claudeApiKey')).toBe('');
    });
  });

  describe('Stats Endpoint', () => {
    it('GET /data/stats returns aggregate statistics', async () => {
      // Seed some data
      ctx.db.run(
        `INSERT INTO sessions (content_session_id, project, source_ide, status, created_at_epoch, prompt_count)
         VALUES ('stats-test', '/tmp/proj', 'claude-code', 'active', ?, 1)`,
        [Date.now()],
      );
      const session = ctx.db.query('SELECT id FROM sessions WHERE content_session_id = ?').get('stats-test') as any;
      ctx.db.run(
        `INSERT INTO observations (session_id, project, source_ide, type, title, importance, created_at_epoch)
         VALUES (?, '/tmp/proj', 'claude-code', 'discovery', 'Test obs', 5, ?)`,
        [session.id, Date.now()],
      );

      const res = await fetch(`${ctx.baseUrl}/data/stats`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.observations).toBeGreaterThanOrEqual(1);
      expect(body.sessions).toBeGreaterThanOrEqual(1);
      expect(body.typeBreakdown).toBeTruthy();
      expect(body.dbSizeMB).toBeTruthy();
    });

    it('GET /data/stats filters by project', async () => {
      const res = await fetch(`${ctx.baseUrl}/data/stats?project=/tmp/nonexistent`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.observations).toBe(0);
    });
  });
});
