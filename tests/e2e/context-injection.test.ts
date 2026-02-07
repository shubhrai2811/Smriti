import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestContext } from '../fixtures/helpers';
import { createSession } from '../../src/services/sqlite/sessions';
import { insertObservation } from '../../src/services/sqlite/observations';
import { insertSummary } from '../../src/services/sqlite/summaries';

describe('Context Injection E2E', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('returns empty state for project with no data', async () => {
    const res = await fetch(`${ctx.baseUrl}/context/inject?project=new-project`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('No previous sessions');
    expect(text).toContain('new-project');
  });

  it('returns empty string when no project specified', async () => {
    const res = await fetch(`${ctx.baseUrl}/context/inject`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('');
  });

  it('includes observations in context output', async () => {
    const project = '/test/project';
    const session = createSession(ctx.db, {
      contentSessionId: 'ctx-test-1',
      project,
      branch: 'main',
    });

    insertObservation(ctx.db, {
      sessionId: session.id,
      project,
      type: 'discovery',
      title: 'Found important pattern',
      facts: JSON.stringify(['The auth module uses JWT']),
      importance: 8,
    });

    insertObservation(ctx.db, {
      sessionId: session.id,
      project,
      type: 'bugfix',
      title: 'Fixed null pointer in parser',
      facts: JSON.stringify(['Parser crashed on empty input']),
      filesAffected: JSON.stringify(['src/parser.ts']),
      importance: 6,
    });

    const res = await fetch(`${ctx.baseUrl}/context/inject?project=${encodeURIComponent(project)}`);
    const text = await res.text();

    expect(text).toContain('Found important pattern');
    expect(text).toContain('Fixed null pointer');
    expect(text).toContain('[smriti:');
    expect(text).toContain('2 observations');
  });

  it('includes last session summary', async () => {
    const project = '/test/project';
    const session = createSession(ctx.db, {
      contentSessionId: 'ctx-test-2',
      project,
    });

    insertSummary(ctx.db, {
      sessionId: session.id,
      project,
      request: 'Implement user auth',
      learned: 'OAuth2 flow requires PKCE',
      completed: 'Set up token validation',
      nextSteps: 'Add refresh token logic',
    });

    const res = await fetch(`${ctx.baseUrl}/context/inject?project=${encodeURIComponent(project)}`);
    const text = await res.text();

    expect(text).toContain('Implement user auth');
    expect(text).toContain('OAuth2 flow requires PKCE');
    expect(text).toContain('Set up token validation');
    expect(text).toContain('Add refresh token logic');
  });

  it('respects token budget', async () => {
    const project = '/test/project';
    const session = createSession(ctx.db, {
      contentSessionId: 'ctx-test-3',
      project,
    });

    // Insert many observations to exceed default budget
    for (let i = 0; i < 100; i++) {
      insertObservation(ctx.db, {
        sessionId: session.id,
        project,
        type: 'discovery',
        title: `Observation number ${i} with some extra text to take up space in the context window`,
        facts: JSON.stringify([`Fact ${i}: Lorem ipsum dolor sit amet, consectetur adipiscing elit`]),
        concepts: JSON.stringify(['testing', 'performance']),
        importance: 5,
      });
    }

    const res = await fetch(`${ctx.baseUrl}/context/inject?project=${encodeURIComponent(project)}`);
    const text = await res.text();

    // Should not include all 100 observations (token budget limits it)
    const obsCount = (text.match(/Observation number/g) || []).length;
    expect(obsCount).toBeLessThan(100);
    expect(obsCount).toBeGreaterThan(0);
  });

  it('high importance observations appear in output', async () => {
    const project = '/test/project';
    const session = createSession(ctx.db, {
      contentSessionId: 'ctx-test-4',
      project,
    });

    insertObservation(ctx.db, {
      sessionId: session.id,
      project,
      type: 'decision',
      title: 'Critical: Use PostgreSQL not SQLite for prod',
      importance: 10,
    });

    insertObservation(ctx.db, {
      sessionId: session.id,
      project,
      type: 'discovery',
      title: 'Minor: Found unused import',
      importance: 2,
    });

    const res = await fetch(`${ctx.baseUrl}/context/inject?project=${encodeURIComponent(project)}`);
    const text = await res.text();

    expect(text).toContain('Critical: Use PostgreSQL');
    // High importance gets ** marker
    expect(text).toContain('**');
  });
});
