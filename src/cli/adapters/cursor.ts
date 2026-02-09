import type { HookResult, NormalizedHookInput, PlatformAdapter } from '../types.js';

export const cursorAdapter: PlatformAdapter = {
  normalizeInput(raw: unknown): NormalizedHookInput {
    const r = (raw ?? {}) as Record<string, unknown>;
    const isShellCommand = !!r.command && !r.tool_name;
    const isFileEdit = !!r.file_path && !!r.edits;
    const workspaceRoots = r.workspace_roots as string[] | undefined;

    return {
      sessionId: (r.conversation_id as string) || (r.generation_id as string) || '',
      cwd: workspaceRoots?.[0] ?? process.cwd(),
      platform: 'cursor',
      prompt: r.prompt as string | undefined,
      toolName: isShellCommand ? 'Bash' : isFileEdit ? 'Write' : (r.tool_name as string | undefined),
      toolInput: isShellCommand
        ? { command: r.command }
        : isFileEdit
          ? { file_path: r.file_path, edits: r.edits }
          : r.tool_input,
      toolResponse: isShellCommand ? { output: r.output } : isFileEdit ? { success: true } : r.result_json,
      transcriptPath: r.transcript_path as string | undefined,
      filePath: r.file_path as string | undefined,
      edits: r.edits as unknown[] | undefined,
    };
  },
  formatOutput(result: HookResult): unknown {
    return { continue: result.continue ?? true };
  },
};
