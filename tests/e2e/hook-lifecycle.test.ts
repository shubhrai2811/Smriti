import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestContext } from '../fixtures/helpers';

describe('Hook Lifecycle E2E', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('health endpoint responds', async () => {
    const res = await fetch(`${ctx.baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('ok');
  });

  it('readiness endpoint returns ready after init', async () => {
    const res = await fetch(`${ctx.baseUrl}/readiness`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('ready');
  });

  it('context inject returns empty state for new project', async () => {
    const res = await fetch(`${ctx.baseUrl}/context/inject?project=test-project`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('No previous sessions');
  });

  it('full session lifecycle: init -> observe -> summarize -> complete', async () => {
    const sessionId = 'test-session-123';
    const project = '/tmp/test-project';

    // 1. Initialize session
    const initRes = await fetch(`${ctx.baseUrl}/sessions/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentSessionId: sessionId,
        project,
        branch: 'main',
        prompt: 'Fix the auth bug',
      }),
    });
    expect(initRes.status).toBe(200);
    const initBody = await initRes.json() as any;
    expect(initBody.sessionId).toBeGreaterThan(0);
    expect(initBody.promptNumber).toBe(1);

    // 2. Queue observations
    for (let i = 0; i < 3; i++) {
      const obsRes = await fetch(`${ctx.baseUrl}/sessions/${initBody.sessionId}/observe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: sessionId,
          toolName: 'Read',
          toolInput: JSON.stringify({ file_path: `/src/auth/login${i}.ts` }),
          toolResponse: `File content for login${i}.ts`,
          cwd: project,
        }),
      });
      expect(obsRes.status).toBe(202);
      const obsBody = await obsRes.json() as any;
      expect(obsBody.queued).toBe(true);
    }

    // 3. Verify pending count
    const lastObs = await fetch(`${ctx.baseUrl}/sessions/${initBody.sessionId}/observe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentSessionId: sessionId,
        toolName: 'Edit',
        toolInput: JSON.stringify({ file_path: '/src/auth/login.ts' }),
        toolResponse: 'File edited successfully',
        cwd: project,
      }),
    });
    const lastObsBody = await lastObs.json() as any;
    expect(lastObsBody.pendingCount).toBe(4);

    // 4. Summarize (queues summary message)
    const sumRes = await fetch(`${ctx.baseUrl}/sessions/${initBody.sessionId}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentSessionId: sessionId,
        lastAssistantMessage: 'I fixed the authentication bug in login.ts',
      }),
    });
    expect(sumRes.status).toBe(200);
    const sumBody = await sumRes.json() as any;
    expect(sumBody.queued).toBe(true);

    // 5. Complete session
    const completeRes = await fetch(`${ctx.baseUrl}/sessions/${initBody.sessionId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentSessionId: sessionId }),
    });
    expect(completeRes.status).toBe(200);
    const completeBody = await completeRes.json() as any;
    expect(completeBody.completed).toBe(true);

    // 6. Verify session completed in DB
    const session = ctx.db.query('SELECT * FROM sessions WHERE content_session_id = ?').get(sessionId) as any;
    expect(session).toBeTruthy();
    expect(session.status).toBe('completed');
    expect(session.project).toBe(project);
    expect(session.branch).toBe('main');

    // 7. Verify pending messages were stored
    const pending = ctx.db.query('SELECT * FROM pending_messages WHERE session_id = ?').all(session.id);
    expect(pending.length).toBeGreaterThan(0);

    // 8. Verify prompts were stored
    const prompts = ctx.db.query('SELECT * FROM prompts WHERE session_id = ?').all(session.id) as any[];
    expect(prompts.length).toBe(1);
    expect(prompts[0].prompt_text).toBe('Fix the auth bug');
  });

  it('session init is idempotent', async () => {
    const sessionId = 'idempotent-test';
    const project = '/tmp/test';

    const res1 = await fetch(`${ctx.baseUrl}/sessions/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentSessionId: sessionId, project, prompt: 'First' }),
    });
    const body1 = await res1.json() as any;

    const res2 = await fetch(`${ctx.baseUrl}/sessions/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentSessionId: sessionId, project, prompt: 'Second' }),
    });
    const body2 = await res2.json() as any;

    expect(body1.sessionId).toBe(body2.sessionId);
    expect(body2.promptNumber).toBe(2);
  });

  it('session init requires contentSessionId and project', async () => {
    const res = await fetch(`${ctx.baseUrl}/sessions/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentSessionId: 'abc' }),
    });
    expect(res.status).toBe(400);
  });

  it('observe returns 404 for unknown session', async () => {
    const res = await fetch(`${ctx.baseUrl}/sessions/999/observe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentSessionId: 'nonexistent',
        toolName: 'Read',
        toolInput: '{}',
        toolResponse: 'test',
        cwd: '/tmp',
      }),
    });
    expect(res.status).toBe(404);
  });
});
