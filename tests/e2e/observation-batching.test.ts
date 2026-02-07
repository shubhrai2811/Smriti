import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestContext } from '../fixtures/helpers';
import { MockProvider } from '../fixtures/mock-provider';
import { ObservationBatcher } from '../../src/services/extraction/batcher';
import { createSession } from '../../src/services/sqlite/sessions';
import { insertPrompt } from '../../src/services/sqlite/prompts';
import { enqueuePendingMessage, getPendingCount } from '../../src/services/sqlite/pending-messages';
import { getObservationsBySession } from '../../src/services/sqlite/observations';
import { getSummaryBySession } from '../../src/services/sqlite/summaries';

describe('Observation Batching E2E', () => {
  let ctx: ReturnType<typeof createTestContext>;
  let provider: MockProvider;
  let batcher: ObservationBatcher;

  beforeEach(() => {
    ctx = createTestContext();
    provider = new MockProvider();
    batcher = new ObservationBatcher(ctx.db, provider);
  });

  afterEach(() => {
    batcher.destroy();
    ctx.cleanup();
  });

  function seedSession() {
    const session = createSession(ctx.db, {
      contentSessionId: `batch-test-${Date.now()}`,
      project: '/test/project',
      branch: 'main',
    });
    insertPrompt(ctx.db, {
      sessionId: session.id,
      promptNumber: 1,
      promptText: 'Fix the auth bug',
    });
    return session;
  }

  function enqueueObs(sessionId: number, contentSessionId: string, index: number) {
    enqueuePendingMessage(ctx.db, {
      sessionId,
      contentSessionId,
      messageType: 'observation',
      toolName: 'Read',
      toolInput: JSON.stringify({ file_path: `/src/file${index}.ts` }),
      toolResponse: `Content of file${index}.ts`,
      cwd: '/test/project',
    });
  }

  it('flush processes all pending observations', async () => {
    const session = seedSession();

    // Enqueue 3 observations (under default batch size of 5)
    for (let i = 0; i < 3; i++) {
      enqueueObs(session.id, session.content_session_id, i);
    }

    expect(getPendingCount(ctx.db, session.id)).toBe(3);

    await batcher.flush(session.id);

    // All pending should be consumed
    expect(getPendingCount(ctx.db, session.id)).toBe(0);

    // Provider should have been called
    expect(provider.calls.length).toBeGreaterThan(0);

    // Observations should be stored in DB
    const observations = getObservationsBySession(ctx.db, session.id);
    expect(observations.length).toBeGreaterThan(0);
  });

  it('summarize generates summary after flushing', async () => {
    const session = seedSession();

    // Enqueue observations
    for (let i = 0; i < 2; i++) {
      enqueueObs(session.id, session.content_session_id, i);
    }

    await batcher.summarize(session.id, 'I fixed the authentication bug');

    // All pending should be consumed
    expect(getPendingCount(ctx.db, session.id)).toBe(0);

    // Summary should be stored
    const summary = getSummaryBySession(ctx.db, session.id);
    expect(summary).toBeTruthy();
    expect(summary!.request).toBeTruthy();
  });

  it('processes observations with correct data', async () => {
    const session = seedSession();

    enqueueObs(session.id, session.content_session_id, 0);

    // Set a custom response with specific observation data
    provider.customResponse = `<observation><type>bugfix</type><title>Fixed login crash</title><facts><fact>Null check was missing</fact></facts><concepts>auth, bugfix</concepts><files_affected>src/login.ts</files_affected><importance>8</importance></observation>`;

    await batcher.flush(session.id);

    const observations = getObservationsBySession(ctx.db, session.id);
    expect(observations.length).toBe(1);
    expect(observations[0].type).toBe('bugfix');
    expect(observations[0].title).toBe('Fixed login crash');
    expect(observations[0].importance).toBe(8);
    expect(observations[0].project).toBe('/test/project');
  });

  it('handles empty pending queue gracefully', async () => {
    const session = seedSession();

    // Flush with nothing pending -- should not error
    await batcher.flush(session.id);
    expect(provider.calls.length).toBe(0);
  });

  it('mock provider tracks calls', async () => {
    const session = seedSession();

    enqueueObs(session.id, session.content_session_id, 0);
    enqueueObs(session.id, session.content_session_id, 1);

    await batcher.flush(session.id);

    // Provider should have been called at least once
    expect(provider.calls.length).toBeGreaterThanOrEqual(1);
    // The prompt should contain tool use data
    expect(provider.calls[0]).toContain('tool_use');
  });
});
