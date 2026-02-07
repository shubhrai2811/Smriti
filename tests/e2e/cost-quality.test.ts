import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestContext } from '../fixtures/helpers';
import { insertObservation } from '../../src/services/sqlite/observations';
import { insertTokenUsage, getTokenUsageBySession, getTokenUsageSummary, getRecentTokenUsage } from '../../src/services/sqlite/token-usage';
import { getMaskLevel, getSessionAge, maskObservation } from '../../src/services/context/masking';
import { ProviderManager } from '../../src/services/providers/provider-manager';
import { OpenRouterProvider } from '../../src/services/providers/openrouter';
import { buildContext } from '../../src/services/context/builder';
import type { AIProvider, TokenUsageInfo } from '../../src/services/providers/provider';
import type { ObservationRow } from '../../src/shared/types';

// Helper: create a test session
function createTestSession(db: any, project: string = '/tmp/test-project', status: string = 'active'): number {
  db.query(
    'INSERT INTO sessions (content_session_id, project, branch, status, created_at_epoch) VALUES (?, ?, ?, ?, ?)'
  ).run(`test-${Date.now()}-${Math.random()}`, project, 'main', status, Date.now());
  return (db.query('SELECT last_insert_rowid() as id').get() as any).id;
}

// Helper: create a mock provider with configurable behavior
function createMockProvider(opts: {
  name?: string;
  response?: string;
  shouldFail?: boolean;
  usage?: TokenUsageInfo;
} = {}): AIProvider {
  return {
    name: opts.name ?? 'mock',
    extract: async () => {
      if (opts.shouldFail) throw new Error('Provider failure');
      return opts.response ?? '<observation><type>discovery</type><title>Test</title></observation>';
    },
    isAvailable: async () => !opts.shouldFail,
    getLastUsage: () => opts.usage ?? null,
  };
}

// Helper: create a mock observation row
function createMockObsRow(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    id: 1,
    session_id: 1,
    project: '/tmp/test',
    branch: null,
    source_ide: 'claude-code',
    type: 'discovery',
    title: 'Test observation title',
    facts: JSON.stringify(['Fact one', 'Fact two']),
    concepts: JSON.stringify(['concept-a', 'concept-b']),
    files_affected: JSON.stringify(['src/main.ts', 'src/util.ts']),
    importance: 5,
    prompt_number: null,
    created_at: '',
    created_at_epoch: Date.now(),
    ...overrides,
  };
}

describe('Cost & Quality E2E', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('Token Usage CRUD', () => {
    it('inserts and retrieves token usage', () => {
      const sessionId = createTestSession(ctx.db);
      insertTokenUsage(ctx.db, {
        sessionId,
        provider: 'claude-sdk',
        operation: 'extraction',
        inputTokens: 500,
        outputTokens: 200,
        estimatedCostUsd: 0.003,
        model: 'claude-sonnet-4-5',
      });

      const rows = getTokenUsageBySession(ctx.db, sessionId);
      expect(rows.length).toBe(1);
      expect(rows[0].provider).toBe('claude-sdk');
      expect(rows[0].input_tokens).toBe(500);
      expect(rows[0].output_tokens).toBe(200);
      expect(rows[0].estimated_cost_usd).toBe(0.003);
      expect(rows[0].model).toBe('claude-sonnet-4-5');
    });

    it('aggregates token usage summary', () => {
      const session = createTestSession(ctx.db);

      insertTokenUsage(ctx.db, {
        sessionId: session, provider: 'claude-sdk', operation: 'extraction',
        inputTokens: 500, outputTokens: 200, estimatedCostUsd: 0.003,
      });
      insertTokenUsage(ctx.db, {
        sessionId: session, provider: 'claude-sdk', operation: 'summary',
        inputTokens: 300, outputTokens: 150, estimatedCostUsd: 0.002,
      });
      insertTokenUsage(ctx.db, {
        sessionId: session, provider: 'openrouter', operation: 'extraction',
        inputTokens: 400, outputTokens: 100, estimatedCostUsd: 0.001,
      });

      const summary = getTokenUsageSummary(ctx.db);
      expect(summary.totalInputTokens).toBe(1200);
      expect(summary.totalOutputTokens).toBe(450);
      expect(summary.totalCostUsd).toBeCloseTo(0.006, 4);

      expect(summary.byProvider['claude-sdk'].inputTokens).toBe(800);
      expect(summary.byProvider['openrouter'].inputTokens).toBe(400);

      expect(summary.byOperation['extraction'].inputTokens).toBe(900);
      expect(summary.byOperation['summary'].inputTokens).toBe(300);
    });

    it('filters summary by session', () => {
      const session1 = createTestSession(ctx.db);
      const session2 = createTestSession(ctx.db);

      insertTokenUsage(ctx.db, {
        sessionId: session1, provider: 'claude-sdk', operation: 'extraction',
        inputTokens: 500, outputTokens: 200,
      });
      insertTokenUsage(ctx.db, {
        sessionId: session2, provider: 'claude-sdk', operation: 'extraction',
        inputTokens: 300, outputTokens: 100,
      });

      const summary = getTokenUsageSummary(ctx.db, { sessionId: session1 });
      expect(summary.totalInputTokens).toBe(500);
    });

    it('getRecentTokenUsage returns latest records', () => {
      const session = createTestSession(ctx.db);
      for (let i = 0; i < 5; i++) {
        insertTokenUsage(ctx.db, {
          sessionId: session, provider: 'mock', operation: 'extraction',
          inputTokens: 100 * (i + 1), outputTokens: 50,
        });
      }

      const recent = getRecentTokenUsage(ctx.db, 3);
      expect(recent.length).toBe(3);
      // Most recent first
      expect(recent[0].input_tokens).toBe(500);
    });
  });

  describe('Observation Masking', () => {
    it('getMaskLevel returns correct levels', () => {
      expect(getMaskLevel(0)).toBe('full');
      expect(getMaskLevel(1)).toBe('full');
      expect(getMaskLevel(2)).toBe('full');
      expect(getMaskLevel(3)).toBe('brief');
      expect(getMaskLevel(4)).toBe('brief');
      expect(getMaskLevel(5)).toBe('brief');
      expect(getMaskLevel(6)).toBe('minimal');
      expect(getMaskLevel(10)).toBe('minimal');
    });

    it('getMaskLevel respects custom thresholds', () => {
      expect(getMaskLevel(0, 2, 4)).toBe('full');
      expect(getMaskLevel(2, 2, 4)).toBe('brief');
      expect(getMaskLevel(4, 2, 4)).toBe('minimal');
    });

    it('maskObservation full includes all details', () => {
      const obs = createMockObsRow();
      const text = maskObservation(obs, 'full');

      expect(text).toContain('[discovery]');
      expect(text).toContain('Test observation title');
      expect(text).toContain('Fact one');
      expect(text).toContain('Fact two');
      expect(text).toContain('concept-a');
      expect(text).toContain('src/main.ts');
    });

    it('maskObservation brief includes title and first fact only', () => {
      const obs = createMockObsRow();
      const text = maskObservation(obs, 'brief');

      expect(text).toContain('[discovery]');
      expect(text).toContain('Test observation title');
      expect(text).toContain('Fact one');
      expect(text).not.toContain('Fact two');
      expect(text).not.toContain('concept-a');
      expect(text).not.toContain('src/main.ts');
    });

    it('maskObservation minimal includes only title', () => {
      const obs = createMockObsRow();
      const text = maskObservation(obs, 'minimal');

      expect(text).toContain('[discovery]');
      expect(text).toContain('Test observation title');
      expect(text).not.toContain('Fact');
      expect(text).not.toContain('concept');
      expect(text).not.toContain('src/');
    });

    it('maskObservation marks high importance with **', () => {
      const obs = createMockObsRow({ importance: 10 });
      const text = maskObservation(obs, 'full');
      expect(text).toContain('**');
    });

    it('getSessionAge counts newer completed sessions', () => {
      const s1 = createTestSession(ctx.db, '/tmp/test', 'completed');
      const s2 = createTestSession(ctx.db, '/tmp/test', 'completed');
      const s3 = createTestSession(ctx.db, '/tmp/test', 'completed');

      // s1 is oldest, s3 is newest
      expect(getSessionAge(ctx.db, s1, '/tmp/test')).toBe(2);
      expect(getSessionAge(ctx.db, s2, '/tmp/test')).toBe(1);
      expect(getSessionAge(ctx.db, s3, '/tmp/test')).toBe(0);
    });

    it('context builder applies masking to old observations', () => {
      // Create sessions of different ages
      const oldSession = createTestSession(ctx.db, '/tmp/test', 'completed');
      for (let i = 0; i < 6; i++) {
        createTestSession(ctx.db, '/tmp/test', 'completed');
      }

      insertObservation(ctx.db, {
        sessionId: oldSession, project: '/tmp/test', type: 'discovery',
        title: 'Old observation with detailed facts',
        facts: JSON.stringify(['This detail should be masked']),
        concepts: JSON.stringify(['should-not-appear']),
        importance: 5,
      });

      const context = buildContext(ctx.db, {
        project: '/tmp/test',
        tokenBudget: 4000,
        showInlineSummary: false,
      });

      // Old observation (6+ sessions ago) should be minimal — title only
      expect(context).toContain('Old observation with detailed facts');
      expect(context).not.toContain('This detail should be masked');
      expect(context).not.toContain('should-not-appear');
    });
  });

  describe('Provider Manager', () => {
    it('uses primary provider when available', async () => {
      const primary = createMockProvider({ name: 'primary', response: 'primary-result' });
      const manager = new ProviderManager({ primary });

      const result = await manager.extract('test');
      expect(result).toBe('primary-result');
      expect(manager.getActiveProviderName()).toBe('primary');
      expect(manager.isUsingFallback()).toBe(false);
    });

    it('falls back after consecutive failures', async () => {
      const primary = createMockProvider({ name: 'primary', shouldFail: true });
      const fallback = createMockProvider({ name: 'fallback', response: 'fallback-result' });
      const manager = new ProviderManager({
        primary,
        fallback,
        failureThreshold: 3,
      });

      // First 2 failures throw
      await expect(manager.extract('test')).rejects.toThrow();
      await expect(manager.extract('test')).rejects.toThrow();
      expect(manager.getConsecutiveFailures()).toBe(2);

      // Third failure triggers fallback
      const result = await manager.extract('test');
      expect(result).toBe('fallback-result');
      expect(manager.isUsingFallback()).toBe(true);
    });

    it('resets failures on primary success', async () => {
      let callCount = 0;
      const primary: AIProvider = {
        name: 'primary',
        extract: async () => {
          callCount++;
          if (callCount <= 2) throw new Error('fail');
          return 'recovered';
        },
        isAvailable: async () => true,
        getLastUsage: () => null,
      };

      const manager = new ProviderManager({ primary, failureThreshold: 5 });

      await expect(manager.extract('test')).rejects.toThrow();
      await expect(manager.extract('test')).rejects.toThrow();
      expect(manager.getConsecutiveFailures()).toBe(2);

      const result = await manager.extract('test');
      expect(result).toBe('recovered');
      expect(manager.getConsecutiveFailures()).toBe(0);
    });

    it('tracks token usage when db and operation provided', async () => {
      const primary = createMockProvider({
        name: 'test-provider',
        response: 'result',
        usage: { inputTokens: 100, outputTokens: 50, model: 'test-model' },
      });

      const manager = new ProviderManager({ primary, db: ctx.db });
      await manager.extract('test', { sessionId: undefined, operation: 'extraction' });

      const recent = getRecentTokenUsage(ctx.db, 1);
      expect(recent.length).toBe(1);
      expect(recent[0].provider).toBe('test-provider');
      expect(recent[0].input_tokens).toBe(100);
      expect(recent[0].output_tokens).toBe(50);
    });

    it('isAvailable checks primary then fallback', async () => {
      const primary = createMockProvider({ name: 'primary', shouldFail: true });
      const fallback = createMockProvider({ name: 'fallback' });

      const manager = new ProviderManager({ primary, fallback });
      expect(await manager.isAvailable()).toBe(true);

      const managerNone = new ProviderManager({
        primary: createMockProvider({ shouldFail: true }),
      });
      expect(await managerNone.isAvailable()).toBe(false);
    });
  });

  describe('OpenRouter Provider', () => {
    it('implements AIProvider interface', () => {
      const provider = new OpenRouterProvider();
      expect(provider.name).toBe('openrouter');
      expect(typeof provider.extract).toBe('function');
      expect(typeof provider.isAvailable).toBe('function');
      expect(typeof provider.getLastUsage).toBe('function');
    });

    it('isAvailable returns false without API key', async () => {
      // Ensure no API key is set
      const originalKey = process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      const provider = new OpenRouterProvider();
      expect(await provider.isAvailable()).toBe(false);

      // Restore
      if (originalKey) process.env.OPENROUTER_API_KEY = originalKey;
    });

    it('getLastUsage returns null initially', () => {
      const provider = new OpenRouterProvider();
      expect(provider.getLastUsage()).toBeNull();
    });
  });

  describe('Settings', () => {
    it('includes masking config', async () => {
      const res = await fetch(`${ctx.baseUrl}/settings`);
      const settings = await res.json() as any;
      expect(settings.masking).toBeTruthy();
      expect(settings.masking.enabled).toBe(true);
      expect(settings.masking.briefThreshold).toBe(3);
      expect(settings.masking.minimalThreshold).toBe(6);
    });

    it('includes provider config', async () => {
      const res = await fetch(`${ctx.baseUrl}/settings`);
      const settings = await res.json() as any;
      expect(settings.provider).toBeTruthy();
      expect(settings.provider.primary).toBe('claude-sdk');
      expect(settings.provider.fallbackEnabled).toBe(true);
      expect(settings.provider.failureThreshold).toBe(3);
    });
  });
});
