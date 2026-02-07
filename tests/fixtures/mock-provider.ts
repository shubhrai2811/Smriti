/**
 * Mock AI provider for deterministic testing.
 * Implements the AIProvider interface with configurable responses.
 */

import type { AIProvider, TokenUsageInfo } from '../../src/services/providers/provider.js';

export class MockProvider implements AIProvider {
  readonly name = 'mock';
  calls: string[] = [];
  customResponse: string | null = null;
  private lastUsage: TokenUsageInfo | null = null;

  async extract(prompt: string): Promise<string> {
    this.calls.push(prompt);

    if (this.customResponse) {
      return this.customResponse;
    }

    // Summary request detection
    if (prompt.includes('<summary_request>') || prompt.includes('summary')) {
      return `<summary><request>Fix the auth bug</request><learned>JWT tokens need refresh logic</learned><completed>Fixed token validation</completed><next_steps>Add unit tests for token refresh</next_steps></summary>`;
    }

    // Default: return extraction with 1-2 observations
    // This simulates a typical extraction from tool use data
    return `<observation><type>discovery</type><title>Test observation</title><facts><fact>Found something interesting</fact></facts><concepts>testing, mock</concepts><files_affected>test.ts</files_affected><importance>5</importance></observation>`;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getLastUsage(): TokenUsageInfo | null {
    return this.lastUsage;
  }

  /**
   * Reset the provider state between tests.
   */
  reset(): void {
    this.calls = [];
    this.customResponse = null;
    this.lastUsage = null;
  }
}
