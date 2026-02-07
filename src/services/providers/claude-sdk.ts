import type { AIProvider, TokenUsageInfo } from './provider.js';
import { logger } from '../../utils/logger.js';
import { OBSERVER_SESSIONS_DIR } from '../../shared/paths.js';
import { mkdirSync } from 'fs';

export class ClaudeSDKProvider implements AIProvider {
  readonly name = 'claude-sdk';
  private lastUsage: TokenUsageInfo | null = null;

  async extract(prompt: string): Promise<string> {
    // Dynamic import to avoid loading SDK unless needed
    // @ts-ignore - external module resolved at runtime
    const { query } = await import('@anthropic-ai/claude-code');

    mkdirSync(OBSERVER_SESSIONS_DIR, { recursive: true });

    let fullResponse = '';

    const messages = createPromptGenerator(prompt);

    const result = query({
      prompt: messages,
      options: {
        maxTurns: 1,
        systemPrompt: 'You are a structured data extraction assistant. Output only the requested XML format. No explanations.',
        cwd: OBSERVER_SESSIONS_DIR,
      },
    });

    // Reset usage before each call
    this.lastUsage = null;

    for await (const message of result) {
      if (message.type === 'assistant') {
        const content = message.message.content;
        if (typeof content === 'string') {
          fullResponse += content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              fullResponse += block.text;
            }
          }
        }
      }

      // Track usage from result messages that include it
      if (message.type === 'result' && (message as any).usage) {
        const usage = (message as any).usage;
        this.lastUsage = {
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          model: (message as any).model,
        };
      }
    }

    return fullResponse;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // @ts-ignore - external module resolved at runtime
      await import('@anthropic-ai/claude-code');
      return true;
    } catch {
      return false;
    }
  }

  getLastUsage(): TokenUsageInfo | null {
    return this.lastUsage;
  }
}

async function* createPromptGenerator(prompt: string) {
  yield {
    type: 'user' as const,
    message: {
      role: 'user' as const,
      content: prompt,
    },
    session_id: `smriti-extract-${Date.now()}`,
  };
}
