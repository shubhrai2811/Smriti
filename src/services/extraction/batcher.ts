import type { Database } from 'bun:sqlite';
import type { AIProvider } from '../providers/provider.js';
import type { PendingMessageRow } from '../../shared/types.js';
import { claimBatch, confirmProcessed, markFailed, getPendingCount } from '../sqlite/pending-messages.js';
import { insertObservation } from '../sqlite/observations.js';
import { insertSummary } from '../sqlite/summaries.js';
import { getObservationsBySession } from '../sqlite/observations.js';
import { getLastPrompt } from '../sqlite/prompts.js';
import { getSessionByContentId } from '../sqlite/sessions.js';
import { buildExtractionPrompt, buildSummaryPrompt } from './prompts.js';
import { parseExtractionResponse, parseSummaryResponse } from './response-parser.js';
import { getConfig } from '../../shared/config.js';
import { logger } from '../../utils/logger.js';
import { insertEmbedding } from '../sqlite/vectors.js';
import { buildEmbeddableText, embed, isEmbeddingReady } from '../embeddings/embedding-service.js';
import { quickReflect } from '../reflection/quick-reflection.js';
import { shouldRunDeepReflection, deepReflect } from '../reflection/deep-reflection.js';
import { autoLink } from '../reflection/auto-linker.js';
import { extractEntities } from './entity-extractor.js';
import { deduplicateObservation } from './dedup.js';

export class ObservationBatcher {
  private timers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private processing: Set<number> = new Set();

  constructor(
    private db: Database,
    private provider: AIProvider,
  ) {}

  /**
   * Called when a new observation is queued for a session.
   * Checks batch threshold and triggers processing if needed.
   */
  async onObservationReceived(sessionId: number): Promise<void> {
    if (this.processing.has(sessionId)) return;

    const config = getConfig();
    const batchSize = config.get('extraction', 'batchSize');
    const maxWaitMs = config.get('extraction', 'maxWaitSeconds') * 1000;
    const pendingCount = getPendingCount(this.db, sessionId);

    if (pendingCount >= batchSize) {
      this.clearTimer(sessionId);
      await this.processBatch(sessionId, batchSize);
    } else if (!this.timers.has(sessionId)) {
      // Start max-wait timer
      this.timers.set(sessionId, setTimeout(() => {
        this.timers.delete(sessionId);
        this.processBatch(sessionId, batchSize).catch(err => {
          logger.error('BATCHER', 'Timer-triggered batch failed', { sessionId, error: (err as Error).message });
        });
      }, maxWaitMs));
    }
  }

  /**
   * Force-flush all pending observations for a session.
   * Called during summarization.
   */
  async flush(sessionId: number): Promise<void> {
    this.clearTimer(sessionId);

    const config = getConfig();
    const batchSize = config.get('extraction', 'batchSize');

    // Process all pending in batches
    let pendingCount = getPendingCount(this.db, sessionId);
    while (pendingCount > 0) {
      await this.processBatch(sessionId, batchSize);
      pendingCount = getPendingCount(this.db, sessionId);
    }
  }

  /**
   * Generate session summary after flushing observations.
   */
  async summarize(sessionId: number, lastAssistantMessage: string): Promise<void> {
    // First flush all pending observations
    await this.flush(sessionId);

    // Get session data for summary
    const observations = getObservationsBySession(this.db, sessionId);
    const lastPrompt = getLastPrompt(this.db, sessionId);
    const firstPrompt = lastPrompt?.prompt_text || '';

    // Build and execute summary prompt
    const prompt = buildSummaryPrompt(firstPrompt, observations, lastAssistantMessage);

    try {
      const response = await this.provider.extract(prompt);
      const summary = parseSummaryResponse(response);

      if (summary) {
        // Get project from first observation or session
        const project = observations[0]?.project || '';
        insertSummary(this.db, {
          sessionId,
          project,
          request: summary.request,
          learned: summary.learned,
          completed: summary.completed,
          nextSteps: summary.nextSteps,
        });
        logger.info('BATCHER', 'Summary generated', { sessionId });

        // Trigger reflections (non-blocking, best-effort)
        const config = getConfig();
        if (config.get('reflection', 'enabled')) {
          quickReflect(this.db, this.provider, sessionId, project).catch(err => {
            logger.debug('BATCHER', 'Quick reflection failed (non-critical)', { error: (err as Error).message });
          });

          // Check if deep reflection should trigger
          const interval = config.get('reflection', 'deepReflectionInterval');
          if (shouldRunDeepReflection(this.db, project, interval)) {
            deepReflect(this.db, this.provider, project).catch(err => {
              logger.debug('BATCHER', 'Deep reflection failed (non-critical)', { error: (err as Error).message });
            });
          }
        }
      }
    } catch (error) {
      logger.error('BATCHER', 'Summary generation failed', { sessionId, error: (error as Error).message });
    }
  }

  /**
   * Process a batch of pending messages through AI extraction.
   */
  private async processBatch(sessionId: number, batchSize: number): Promise<void> {
    if (this.processing.has(sessionId)) return;
    this.processing.add(sessionId);

    try {
      const messages = claimBatch(this.db, sessionId, batchSize);
      if (messages.length === 0) return;

      // Only process observation-type messages in batch extraction
      const obsMessages = messages.filter(m => m.message_type === 'observation');

      if (obsMessages.length === 0) {
        // Confirm non-observation messages
        for (const msg of messages) {
          confirmProcessed(this.db, msg.id);
        }
        return;
      }

      const prompt = buildExtractionPrompt(obsMessages);
      const response = await this.provider.extract(prompt);
      const observations = parseExtractionResponse(response);

      // Get session info for project/branch
      const firstMsg = obsMessages[0];
      const session = getSessionByContentId(this.db, firstMsg.content_session_id);
      const project = session?.project || '';
      const branch = session?.branch || null;
      const sourceIde = session?.source_ide || 'claude-code';

      // Atomic: insert observations + confirm messages
      const insertedIds: number[] = [];
      this.db.transaction(() => {
        for (const obs of observations) {
          const id = insertObservation(this.db, {
            sessionId,
            project,
            branch: branch ?? undefined,
            sourceIde,
            type: obs.type,
            title: obs.title,
            facts: JSON.stringify(obs.facts),
            concepts: JSON.stringify(obs.concepts),
            filesAffected: JSON.stringify(obs.filesAffected),
            importance: obs.importance,
          });
          insertedIds.push(id);
        }
        for (const msg of messages) {
          confirmProcessed(this.db, msg.id);
        }
      })();

      logger.info('BATCHER', `Batch processed: ${obsMessages.length} inputs -> ${observations.length} observations`, { sessionId });

      // Entity extraction (synchronous, best-effort)
      for (let i = 0; i < insertedIds.length; i++) {
        try {
          extractEntities(this.db, insertedIds[i], {
            project,
            type: observations[i].type,
            title: observations[i].title,
            facts: observations[i].facts,
            concepts: observations[i].concepts,
            filesAffected: observations[i].filesAffected,
          });
        } catch {
          // Non-critical, continue
        }
      }

      // Compute embeddings asynchronously (non-blocking, best-effort)
      this.embedObservations(insertedIds, observations, project).catch(err => {
        logger.debug('BATCHER', 'Embedding generation failed (non-critical)', { error: (err as Error).message });
      });
    } catch (error) {
      logger.error('BATCHER', 'Batch processing failed', { sessionId, error: (error as Error).message });
      // Messages remain as 'processing' -- resetStaleProcessing will recover them
    } finally {
      this.processing.delete(sessionId);
    }
  }

  /**
   * Compute and store embeddings for newly created observations.
   * Non-blocking, best-effort — failures don't affect core functionality.
   */
  private async embedObservations(
    ids: number[],
    observations: Array<{ type: string; title: string; facts: string[]; concepts: string[]; filesAffected: string[] }>,
    project: string,
  ): Promise<void> {
    if (!isEmbeddingReady()) return;

    for (let i = 0; i < ids.length; i++) {
      try {
        const text = buildEmbeddableText({
          type: observations[i].type,
          title: observations[i].title,
          facts: JSON.stringify(observations[i].facts),
          concepts: JSON.stringify(observations[i].concepts),
        });
        const embedding = await embed(text);
        insertEmbedding(this.db, ids[i], embedding);

        // Deduplicate against existing observations
        const config = getConfig();
        if (config.get('dedup', 'enabled')) {
          try {
            const dedupThreshold = config.get('dedup', 'similarityThreshold');
            deduplicateObservation(this.db, ids[i], project, dedupThreshold);
          } catch (dedupErr) {
            logger.debug('BATCHER', `Dedup failed for observation ${ids[i]} (non-critical)`, {
              error: (dedupErr as Error).message,
            });
          }
        }

        // Auto-link to similar observations
        if (config.get('reflection', 'autoLinkingEnabled')) {
          const threshold = config.get('reflection', 'autoLinkThreshold');
          autoLink(this.db, ids[i], project, threshold);
        }
      } catch (error) {
        logger.debug('BATCHER', `Embedding failed for observation ${ids[i]}`, {
          error: (error as Error).message,
        });
      }
    }
  }

  private clearTimer(sessionId: number): void {
    const timer = this.timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
  }

  /**
   * Clean up all timers (for shutdown).
   */
  destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
