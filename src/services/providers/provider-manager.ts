import type { Database } from 'bun:sqlite';
import type { AIProvider, TokenUsageInfo } from './provider.js';
import { insertTokenUsage } from '../sqlite/token-usage.js';
import { logger } from '../../utils/logger.js';

export class ProviderManager implements AIProvider {
  name = 'provider-manager';
  private primary: AIProvider;
  private fallback: AIProvider | null;
  private consecutiveFailures: number = 0;
  private failureThreshold: number;
  private cooldownMs: number;
  private lastPrimaryFailure: number = 0;
  private usingFallback: boolean = false;
  private lastUsage: TokenUsageInfo | null = null;
  private db: Database | null;

  constructor(opts: {
    primary: AIProvider;
    fallback?: AIProvider;
    failureThreshold?: number;
    cooldownMinutes?: number;
    db?: Database;
  }) {
    this.primary = opts.primary;
    this.fallback = opts.fallback ?? null;
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.cooldownMs = (opts.cooldownMinutes ?? 5) * 60 * 1000;
    this.db = opts.db ?? null;
  }

  async extract(prompt: string, opts?: { sessionId?: number; operation?: string }): Promise<string> {
    // Check if we should try primary again after cooldown
    if (this.usingFallback && Date.now() - this.lastPrimaryFailure > this.cooldownMs) {
      logger.info('PROVIDER', 'Cooldown expired, retrying primary provider');
      this.usingFallback = false;
      this.consecutiveFailures = 0;
    }

    const activeProvider = this.usingFallback && this.fallback ? this.fallback : this.primary;

    try {
      const result = await activeProvider.extract(prompt);

      // Track usage
      const usage = activeProvider.getLastUsage();
      this.lastUsage = usage;
      if (usage && this.db && opts?.operation) {
        try {
          insertTokenUsage(this.db, {
            sessionId: opts.sessionId,
            provider: activeProvider.name,
            operation: opts.operation as any,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            model: usage.model,
          });
        } catch (e) {
          logger.debug('PROVIDER', 'Failed to track token usage', { error: (e as Error).message });
        }
      }

      // Reset failure count on success with primary
      if (activeProvider === this.primary) {
        this.consecutiveFailures = 0;
      }

      return result;
    } catch (error) {
      if (activeProvider === this.primary) {
        this.consecutiveFailures++;
        this.lastPrimaryFailure = Date.now();
        logger.warn('PROVIDER', `Primary provider failed (${this.consecutiveFailures}/${this.failureThreshold})`, {
          error: (error as Error).message,
        });

        // Switch to fallback if threshold exceeded
        if (this.consecutiveFailures >= this.failureThreshold && this.fallback) {
          this.usingFallback = true;
          logger.warn('PROVIDER', 'Switching to fallback provider');
          return this.fallback.extract(prompt);
        }
      }

      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    if (await this.primary.isAvailable()) return true;
    if (this.fallback) return this.fallback.isAvailable();
    return false;
  }

  getLastUsage(): TokenUsageInfo | null {
    return this.lastUsage;
  }

  getActiveProviderName(): string {
    return this.usingFallback && this.fallback ? this.fallback.name : this.primary.name;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  isUsingFallback(): boolean {
    return this.usingFallback;
  }
}
