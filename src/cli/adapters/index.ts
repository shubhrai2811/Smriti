import type { PlatformAdapter } from '../types.js';
import { claudeCodeAdapter } from './claude-code.js';
import { cursorAdapter } from './cursor.js';

const adapters: Record<string, PlatformAdapter> = {
  'claude-code': claudeCodeAdapter,
  'cursor': cursorAdapter,
};

/**
 * Examines the shape of raw hook input to guess the originating platform.
 * - `conversation_id` or `workspace_roots` are Cursor-specific fields
 * - `session_id` is a Claude Code field
 * Falls back to 'claude-code' when the shape is ambiguous.
 */
export function detectPlatform(raw: unknown): string {
  if (raw == null || typeof raw !== 'object') {
    return 'claude-code';
  }

  const r = raw as Record<string, unknown>;

  if ('conversation_id' in r || 'workspace_roots' in r) {
    return 'cursor';
  }

  if ('session_id' in r) {
    return 'claude-code';
  }

  return 'claude-code';
}

export function getAdapter(platform: string, rawInput?: unknown): PlatformAdapter {
  const resolved = platform === 'auto' ? detectPlatform(rawInput) : platform;

  const adapter = adapters[resolved];
  if (!adapter) {
    throw new Error(`Unknown platform: ${resolved}. Supported: ${Object.keys(adapters).join(', ')}`);
  }
  return adapter;
}
