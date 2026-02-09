import { getConfig } from '../../shared/config.js';
import type { AIProvider, TokenUsageInfo } from './provider.js';

export class OpenRouterProvider implements AIProvider {
  name = 'openrouter';
  private lastUsage: TokenUsageInfo | null = null;

  async extract(prompt: string): Promise<string> {
    const config = getConfig();
    const apiKey = config.get('provider', 'openrouterApiKey') || process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OpenRouter API key not configured');

    const model = config.get('provider', 'openrouterModel');

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/smriti-memory/smriti',
        'X-Title': 'Smriti Memory Plugin',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${error}`);
    }

    const data = (await response.json()) as any;

    // Track token usage
    if (data.usage) {
      this.lastUsage = {
        inputTokens: data.usage.prompt_tokens || 0,
        outputTokens: data.usage.completion_tokens || 0,
        model: data.model || model,
      };
    }

    return data.choices?.[0]?.message?.content || '';
  }

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    const apiKey = config.get('provider', 'openrouterApiKey') || process.env.OPENROUTER_API_KEY;
    return !!apiKey;
  }

  getLastUsage(): TokenUsageInfo | null {
    return this.lastUsage;
  }
}
