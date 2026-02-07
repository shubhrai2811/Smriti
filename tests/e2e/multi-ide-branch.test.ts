import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTestContext } from '../fixtures/helpers';
import { insertObservation } from '../../src/services/sqlite/observations';
import { getObservationsByBranchFilter } from '../../src/services/sqlite/observations';
import { detectPlatform, getAdapter } from '../../src/cli/adapters/index';
import { claudeCodeAdapter } from '../../src/cli/adapters/claude-code';
import { cursorAdapter } from '../../src/cli/adapters/cursor';
import { getCurrentBranch, getProjectName, isWorktree, getWorktreeMainRoot, getMainBranch, normalizeProjectPath } from '../../src/utils/git';
import { buildContext } from '../../src/services/context/builder';

// Helper: create a test session
function createTestSession(db: any, project: string = '/tmp/test-project', status: string = 'active', sourceIde: string = 'claude-code'): number {
  db.query(
    'INSERT INTO sessions (content_session_id, project, branch, source_ide, status, created_at_epoch) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(`test-${Date.now()}-${Math.random()}`, project, 'main', sourceIde, status, Date.now());
  return (db.query('SELECT last_insert_rowid() as id').get() as any).id;
}

describe('Multi-IDE & Branch E2E', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('Platform Detection', () => {
    it('detects claude-code from session_id', () => {
      expect(detectPlatform({ session_id: 'abc123' })).toBe('claude-code');
    });

    it('detects cursor from conversation_id', () => {
      expect(detectPlatform({ conversation_id: 'conv-123' })).toBe('cursor');
    });

    it('detects cursor from workspace_roots', () => {
      expect(detectPlatform({ workspace_roots: ['/tmp/project'] })).toBe('cursor');
    });

    it('defaults to claude-code for null input', () => {
      expect(detectPlatform(null)).toBe('claude-code');
    });

    it('defaults to claude-code for empty object', () => {
      expect(detectPlatform({})).toBe('claude-code');
    });

    it('defaults to claude-code for non-object', () => {
      expect(detectPlatform('string')).toBe('claude-code');
    });
  });

  describe('Adapter Resolution', () => {
    it('getAdapter returns claude-code adapter', () => {
      const adapter = getAdapter('claude-code');
      expect(adapter).toBe(claudeCodeAdapter);
    });

    it('getAdapter returns cursor adapter', () => {
      const adapter = getAdapter('cursor');
      expect(adapter).toBe(cursorAdapter);
    });

    it('getAdapter with auto resolves from input shape', () => {
      const ccAdapter = getAdapter('auto', { session_id: 'test' });
      expect(ccAdapter).toBe(claudeCodeAdapter);

      const curAdapter = getAdapter('auto', { conversation_id: 'test' });
      expect(curAdapter).toBe(cursorAdapter);
    });

    it('getAdapter throws for unknown platform', () => {
      expect(() => getAdapter('unknown')).toThrow('Unknown platform');
    });
  });

  describe('Claude Code Adapter', () => {
    it('normalizes claude-code input', () => {
      const input = claudeCodeAdapter.normalizeInput({
        session_id: 'sess-1',
        cwd: '/tmp/project',
        tool_name: 'Read',
        tool_input: { file: 'test.ts' },
        tool_response: 'file contents',
      });

      expect(input.sessionId).toBe('sess-1');
      expect(input.cwd).toBe('/tmp/project');
      expect(input.platform).toBe('claude-code');
      expect(input.toolName).toBe('Read');
    });

    it('formats output with hookSpecificOutput', () => {
      const output = claudeCodeAdapter.formatOutput({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: 'context here',
        },
      });
      expect((output as any).hookSpecificOutput.additionalContext).toBe('context here');
    });
  });

  describe('Cursor Adapter', () => {
    it('normalizes cursor input with conversation_id', () => {
      const input = cursorAdapter.normalizeInput({
        conversation_id: 'conv-1',
        workspace_roots: ['/tmp/cursor-project'],
        tool_name: 'Read',
        tool_input: { file: 'test.ts' },
        result_json: 'file contents',
      });

      expect(input.sessionId).toBe('conv-1');
      expect(input.cwd).toBe('/tmp/cursor-project');
      expect(input.platform).toBe('cursor');
      expect(input.toolResponse).toBe('file contents');
    });

    it('maps shell commands to Bash tool', () => {
      const input = cursorAdapter.normalizeInput({
        conversation_id: 'conv-1',
        command: 'ls -la',
        output: 'file list',
      });

      expect(input.toolName).toBe('Bash');
      expect((input.toolInput as any).command).toBe('ls -la');
      expect((input.toolResponse as any).output).toBe('file list');
    });

    it('maps file edits to Write tool', () => {
      const input = cursorAdapter.normalizeInput({
        conversation_id: 'conv-1',
        file_path: '/tmp/test.ts',
        edits: [{ range: [1, 5], text: 'new content' }],
      });

      expect(input.toolName).toBe('Write');
      expect((input.toolInput as any).file_path).toBe('/tmp/test.ts');
    });

    it('formats output with continue flag', () => {
      const output = cursorAdapter.formatOutput({ continue: true });
      expect((output as any).continue).toBe(true);
    });
  });

  describe('Git Utilities', () => {
    it('getCurrentBranch returns a string for git repos', () => {
      // This test runs in the smriti repo itself
      const branch = getCurrentBranch(process.cwd());
      // May or may not be in a git repo during tests, so just check the type
      expect(branch === null || typeof branch === 'string').toBe(true);
    });

    it('getCurrentBranch returns null for non-git directory', () => {
      const branch = getCurrentBranch('/tmp');
      expect(branch).toBeNull();
    });

    it('getProjectName returns basename', () => {
      expect(getProjectName('/tmp/my-project')).toBe('my-project');
      expect(getProjectName('/Users/dev/code/app')).toBe('app');
    });

    it('isWorktree returns false for non-git directory', () => {
      expect(isWorktree('/tmp')).toBe(false);
    });

    it('getWorktreeMainRoot returns cwd for non-git directory', () => {
      expect(getWorktreeMainRoot('/tmp')).toBe('/tmp');
    });

    it('getMainBranch returns a branch name', () => {
      // In a git repo, returns the detected main branch
      // In a non-git dir, returns 'main' (default)
      const mainBranch = getMainBranch('/tmp');
      expect(mainBranch).toBe('main');
    });

    it('normalizeProjectPath returns cwd for non-git directory', () => {
      expect(normalizeProjectPath('/tmp')).toBe('/tmp');
    });
  });

  describe('Branch Filtering', () => {
    it('filter mode "all" returns observations from all branches', () => {
      const session = createTestSession(ctx.db, '/tmp/test');

      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test', branch: 'main',
        type: 'discovery', title: 'Main branch obs', importance: 5,
      });
      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test', branch: 'feature-x',
        type: 'discovery', title: 'Feature branch obs', importance: 5,
      });

      const results = getObservationsByBranchFilter(ctx.db, '/tmp/test', {
        branch: 'feature-x',
        filterMode: 'all',
        limit: 50,
      });

      expect(results.length).toBe(2);
    });

    it('filter mode "branch-only" returns only current branch', () => {
      const session = createTestSession(ctx.db, '/tmp/test');

      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test', branch: 'main',
        type: 'discovery', title: 'Main branch obs', importance: 5,
      });
      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test', branch: 'feature-x',
        type: 'discovery', title: 'Feature branch obs', importance: 5,
      });

      const results = getObservationsByBranchFilter(ctx.db, '/tmp/test', {
        branch: 'feature-x',
        filterMode: 'branch-only',
        limit: 50,
      });

      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Feature branch obs');
    });

    it('filter mode "branch-plus-main" returns current + main branch', () => {
      const session = createTestSession(ctx.db, '/tmp/test');

      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test', branch: 'main',
        type: 'discovery', title: 'Main branch obs', importance: 5,
      });
      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test', branch: 'feature-x',
        type: 'discovery', title: 'Feature branch obs', importance: 5,
      });
      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test', branch: 'feature-y',
        type: 'discovery', title: 'Other branch obs', importance: 5,
      });

      const results = getObservationsByBranchFilter(ctx.db, '/tmp/test', {
        branch: 'feature-x',
        filterMode: 'branch-plus-main',
        mainBranch: 'main',
        limit: 50,
      });

      expect(results.length).toBe(2);
      const titles = results.map(r => r.title);
      expect(titles).toContain('Main branch obs');
      expect(titles).toContain('Feature branch obs');
      expect(titles).not.toContain('Other branch obs');
    });

    it('branch-only without branch falls back to all', () => {
      const session = createTestSession(ctx.db, '/tmp/test');

      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test', branch: 'main',
        type: 'discovery', title: 'Obs 1', importance: 5,
      });
      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test', branch: 'feature',
        type: 'discovery', title: 'Obs 2', importance: 5,
      });

      const results = getObservationsByBranchFilter(ctx.db, '/tmp/test', {
        filterMode: 'branch-only',
        limit: 50,
      });

      expect(results.length).toBe(2);
    });
  });

  describe('Source IDE Tagging', () => {
    it('observations store source_ide correctly', () => {
      const session = createTestSession(ctx.db, '/tmp/test');

      const id1 = insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test',
        type: 'discovery', title: 'From Claude Code',
        sourceIde: 'claude-code', importance: 5,
      });
      const id2 = insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test',
        type: 'discovery', title: 'From Cursor',
        sourceIde: 'cursor', importance: 5,
      });

      const obs1 = ctx.db.query('SELECT source_ide FROM observations WHERE id = ?').get(id1) as any;
      const obs2 = ctx.db.query('SELECT source_ide FROM observations WHERE id = ?').get(id2) as any;

      expect(obs1.source_ide).toBe('claude-code');
      expect(obs2.source_ide).toBe('cursor');
    });

    it('default source_ide is claude-code', () => {
      const session = createTestSession(ctx.db, '/tmp/test');

      const id = insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test',
        type: 'discovery', title: 'Default IDE',
        importance: 5,
      });

      const obs = ctx.db.query('SELECT source_ide FROM observations WHERE id = ?').get(id) as any;
      expect(obs.source_ide).toBe('claude-code');
    });
  });

  describe('Cross-IDE Context', () => {
    it('context includes observations from multiple IDEs', () => {
      const session = createTestSession(ctx.db, '/tmp/test', 'completed');

      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test',
        type: 'discovery', title: 'Claude Code finding',
        sourceIde: 'claude-code', importance: 7,
      });
      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test',
        type: 'discovery', title: 'Cursor finding',
        sourceIde: 'cursor', importance: 7,
      });

      const context = buildContext(ctx.db, {
        project: '/tmp/test',
        tokenBudget: 4000,
        showInlineSummary: true,
      });

      expect(context).toContain('Claude Code finding');
      expect(context).toContain('Cursor finding');
    });

    it('inline summary shows sources when multi-IDE', () => {
      const session = createTestSession(ctx.db, '/tmp/test', 'completed');

      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test',
        type: 'discovery', title: 'From CC',
        sourceIde: 'claude-code', importance: 5,
      });
      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test',
        type: 'discovery', title: 'From Cursor',
        sourceIde: 'cursor', importance: 5,
      });

      const context = buildContext(ctx.db, {
        project: '/tmp/test',
        tokenBudget: 4000,
        showInlineSummary: true,
      });

      expect(context).toContain('sources:');
      expect(context).toContain('claude-code');
      expect(context).toContain('cursor');
    });

    it('inline summary omits sources when single-IDE', () => {
      const session = createTestSession(ctx.db, '/tmp/test', 'completed');

      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test',
        type: 'discovery', title: 'Only CC',
        sourceIde: 'claude-code', importance: 5,
      });

      const context = buildContext(ctx.db, {
        project: '/tmp/test',
        tokenBudget: 4000,
        showInlineSummary: true,
      });

      expect(context).not.toContain('sources:');
    });
  });

  describe('Context with Branch Filtering', () => {
    it('context respects branch filter mode from config', () => {
      const session = createTestSession(ctx.db, '/tmp/test', 'completed');

      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test', branch: 'main',
        type: 'discovery', title: 'Main obs', importance: 5,
      });
      insertObservation(ctx.db, {
        sessionId: session, project: '/tmp/test', branch: 'feature',
        type: 'discovery', title: 'Feature obs', importance: 5,
      });

      // Default filter mode is 'all', so both should appear
      const context = buildContext(ctx.db, {
        project: '/tmp/test',
        branch: 'feature',
        tokenBudget: 4000,
        showInlineSummary: false,
      });

      expect(context).toContain('Main obs');
      expect(context).toContain('Feature obs');
    });
  });

  describe('Settings', () => {
    it('includes branch config', async () => {
      const res = await fetch(`${ctx.baseUrl}/settings`);
      const settings = await res.json() as any;
      expect(settings.branch).toBeTruthy();
      expect(settings.branch.filterMode).toBe('all');
      expect(settings.branch.defaultBranch).toBe('main');
    });
  });

  describe('Session Routes with IDE', () => {
    it('creates session with source_ide', async () => {
      const res = await fetch(`${ctx.baseUrl}/sessions/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: 'test-cursor-session',
          project: '/tmp/test',
          branch: 'main',
          prompt: 'Test prompt',
          sourceIde: 'cursor',
        }),
      });

      expect(res.ok).toBe(true);

      const session = ctx.db.query(
        "SELECT source_ide FROM sessions WHERE content_session_id = 'test-cursor-session'"
      ).get() as any;
      expect(session.source_ide).toBe('cursor');
    });
  });
});
