import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { getConfig, resetConfig } from '../../src/shared/config';

describe('Provider Base URL Isolation', () => {
  // Save original env vars before each test
  let origSmritiBaseUrl: string | undefined;
  let origSmritiApiKey: string | undefined;

  beforeEach(() => {
    origSmritiBaseUrl = process.env.SMRITI_CLAUDE_BASE_URL;
    origSmritiApiKey = process.env.SMRITI_CLAUDE_API_KEY;
    // Clear env vars so defaults apply
    delete process.env.SMRITI_CLAUDE_BASE_URL;
    delete process.env.SMRITI_CLAUDE_API_KEY;
    resetConfig();
  });

  afterEach(() => {
    // Restore original env vars
    if (origSmritiBaseUrl !== undefined) {
      process.env.SMRITI_CLAUDE_BASE_URL = origSmritiBaseUrl;
    } else {
      delete process.env.SMRITI_CLAUDE_BASE_URL;
    }
    if (origSmritiApiKey !== undefined) {
      process.env.SMRITI_CLAUDE_API_KEY = origSmritiApiKey;
    } else {
      delete process.env.SMRITI_CLAUDE_API_KEY;
    }
    resetConfig();
  });

  it('default claudeBaseUrl is empty string (direct Anthropic)', () => {
    const config = getConfig();
    expect(config.get('provider', 'claudeBaseUrl')).toBe('');
  });

  it('default claudeApiKey is empty string', () => {
    const config = getConfig();
    expect(config.get('provider', 'claudeApiKey')).toBe('');
  });

  it('SMRITI_CLAUDE_BASE_URL env var overrides config', () => {
    process.env.SMRITI_CLAUDE_BASE_URL = 'https://custom-api.example.com';
    resetConfig();
    const config = getConfig();
    expect(config.get('provider', 'claudeBaseUrl')).toBe('https://custom-api.example.com');
  });

  it('SMRITI_CLAUDE_API_KEY env var overrides config', () => {
    process.env.SMRITI_CLAUDE_API_KEY = 'sk-test-key';
    resetConfig();
    const config = getConfig();
    expect(config.get('provider', 'claudeApiKey')).toBe('sk-test-key');
  });

  it('env var save/restore pattern works correctly', () => {
    // Simulate what claude-sdk.ts does
    const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
    const originalApiKey = process.env.ANTHROPIC_API_KEY;

    // User has a proxy set
    process.env.ANTHROPIC_BASE_URL = 'https://user-proxy.example.com';
    process.env.ANTHROPIC_API_KEY = 'user-key';

    const savedBaseUrl = process.env.ANTHROPIC_BASE_URL;
    const savedApiKey = process.env.ANTHROPIC_API_KEY;

    // Smriti clears to use direct Anthropic
    delete process.env.ANTHROPIC_BASE_URL;
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();

    // Restore
    if (savedBaseUrl !== undefined) {
      process.env.ANTHROPIC_BASE_URL = savedBaseUrl;
    }
    if (savedApiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedApiKey;
    }

    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://user-proxy.example.com');
    expect(process.env.ANTHROPIC_API_KEY).toBe('user-key');

    // Cleanup
    if (originalBaseUrl !== undefined) {
      process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.ANTHROPIC_BASE_URL;
    }
    if (originalApiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('branch config is removed', () => {
    const config = getConfig();
    const all = config.getAll() as any;
    expect(all.branch).toBeUndefined();
  });
});
