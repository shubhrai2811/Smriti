import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { findGotchas, formatGotchaWarning } from '../../src/services/context/gotcha';
import { insertObservation } from '../../src/services/sqlite/observations';
import { createSession } from '../../src/services/sqlite/sessions';
import type { ObservationType } from '../../src/shared/types';
import { createTestContext, type TestContext } from '../fixtures/helpers';

describe('Gotcha / Pitfall Detection', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  function seedObservation(opts: {
    project: string;
    type: string;
    title: string;
    importance: number;
    filesAffected?: string[];
    facts?: string[];
  }): number {
    const session = createSession(ctx.db, {
      contentSessionId: `gotcha-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      project: opts.project,
    });
    return insertObservation(ctx.db, {
      sessionId: session.id,
      project: opts.project,
      type: opts.type as ObservationType,
      title: opts.title,
      importance: opts.importance,
      filesAffected: opts.filesAffected ? JSON.stringify(opts.filesAffected) : undefined,
      facts: opts.facts ? JSON.stringify(opts.facts) : undefined,
    });
  }

  it('finds gotchas for files with high-importance bugfixes', () => {
    const project = '/tmp/test-proj';
    seedObservation({
      project,
      type: 'bugfix',
      title: 'Fixed null crash in parser',
      importance: 9,
      filesAffected: ['src/parser.ts'],
      facts: ['Parser crashed on empty input'],
    });

    const gotchas = findGotchas(ctx.db, ['src/parser.ts'], project);
    expect(gotchas.length).toBe(1);
    expect(gotchas[0].title).toBe('Fixed null crash in parser');
  });

  it('finds gotchas matching partial file paths', () => {
    const project = '/tmp/test-proj';
    seedObservation({
      project,
      type: 'decision',
      title: 'Use async validation',
      importance: 8,
      filesAffected: ['/full/path/to/validator.ts'],
    });

    const gotchas = findGotchas(ctx.db, ['validator.ts'], project);
    expect(gotchas.length).toBe(1);
  });

  it('ignores low-importance observations', () => {
    const project = '/tmp/test-proj';
    seedObservation({
      project,
      type: 'bugfix',
      title: 'Minor style fix',
      importance: 3,
      filesAffected: ['src/styles.ts'],
    });

    const gotchas = findGotchas(ctx.db, ['src/styles.ts'], project);
    expect(gotchas.length).toBe(0);
  });

  it('ignores non-qualifying types (feature, refactor)', () => {
    const project = '/tmp/test-proj';
    seedObservation({
      project,
      type: 'feature',
      title: 'Added auth module',
      importance: 9,
      filesAffected: ['src/auth.ts'],
    });

    const gotchas = findGotchas(ctx.db, ['src/auth.ts'], project);
    expect(gotchas.length).toBe(0);
  });

  it('returns empty array when no files touched', () => {
    const gotchas = findGotchas(ctx.db, [], '/tmp/test-proj');
    expect(gotchas.length).toBe(0);
  });

  it('returns empty array when no matching files', () => {
    const project = '/tmp/test-proj';
    seedObservation({
      project,
      type: 'bugfix',
      title: 'Fixed auth bug',
      importance: 9,
      filesAffected: ['src/auth.ts'],
    });

    const gotchas = findGotchas(ctx.db, ['src/unrelated.ts'], project);
    expect(gotchas.length).toBe(0);
  });

  it('respects custom minImportance', () => {
    const project = '/tmp/test-proj';
    seedObservation({
      project,
      type: 'pattern',
      title: 'Always validate input',
      importance: 5,
      filesAffected: ['src/api.ts'],
    });

    // Default minImportance (7) should skip it
    expect(findGotchas(ctx.db, ['src/api.ts'], project).length).toBe(0);

    // Lower threshold should find it
    expect(findGotchas(ctx.db, ['src/api.ts'], project, 5).length).toBe(1);
  });

  describe('formatGotchaWarning', () => {
    it('formats gotchas as markdown', () => {
      const project = '/tmp/test-proj';
      seedObservation({
        project,
        type: 'bugfix',
        title: 'Fixed race condition',
        importance: 9,
        filesAffected: ['src/worker.ts'],
        facts: ['Concurrent writes caused data loss'],
      });

      const gotchas = findGotchas(ctx.db, ['src/worker.ts'], project);
      const warning = formatGotchaWarning(gotchas);
      expect(warning).toContain('Gotchas for files');
      expect(warning).toContain('[bugfix]');
      expect(warning).toContain('Fixed race condition');
      expect(warning).toContain('Concurrent writes caused data loss');
    });

    it('returns empty string for no gotchas', () => {
      expect(formatGotchaWarning([])).toBe('');
    });
  });

  describe('Gotcha API endpoint', () => {
    it('POST /context/gotchas returns warnings for matching files', async () => {
      const project = '/tmp/test-proj';
      seedObservation({
        project,
        type: 'bugfix',
        title: 'Fixed memory leak',
        importance: 8,
        filesAffected: ['src/cache.ts'],
        facts: ['Cache was never cleared'],
      });

      const res = await fetch(`${ctx.baseUrl}/context/gotchas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: ['src/cache.ts'],
          project,
          minImportance: 7,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.warning).toBeTruthy();
      expect(body.count).toBe(1);
    });

    it('POST /context/gotchas returns null warning when no matches', async () => {
      const res = await fetch(`${ctx.baseUrl}/context/gotchas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: ['src/unrelated.ts'],
          project: '/tmp/no-match',
          minImportance: 7,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.warning).toBeNull();
    });

    it('POST /context/gotchas validates input', async () => {
      const res = await fetch(`${ctx.baseUrl}/context/gotchas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: '/tmp/proj' }),
      });
      expect(res.status).toBe(400);
    });
  });
});
