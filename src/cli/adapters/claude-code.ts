import type { HookResult, NormalizedHookInput, PlatformAdapter } from '../types.js';

export const claudeCodeAdapter: PlatformAdapter = {
  normalizeInput(raw: unknown): NormalizedHookInput {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      sessionId: (r.session_id as string) || '',
      cwd: (r.cwd as string) || process.cwd(),
      platform: 'claude-code',
      prompt: r.prompt as string | undefined,
      toolName: r.tool_name as string | undefined,
      toolInput: r.tool_input,
      toolResponse: r.tool_response,
      transcriptPath: r.transcript_path as string | undefined,
    };
  },
  formatOutput(result: HookResult): unknown {
    if (result.hookSpecificOutput) {
      return { hookSpecificOutput: result.hookSpecificOutput };
    }
    return { continue: true, suppressOutput: true };
  },
};
