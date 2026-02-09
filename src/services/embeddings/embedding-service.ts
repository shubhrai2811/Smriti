import { getConfig } from '../../shared/config.js';
import { MODELS_DIR } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';

let EMBEDDING_DIM = 384;
let MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

// We use dynamic import to avoid loading the heavy transformers library at startup
let _pipeline: any = null;
let _initPromise: Promise<void> | null = null;
let _ready = false;

/**
 * Initialize the embedding pipeline. Safe to call multiple times.
 * Uses lazy singleton pattern - first call downloads/loads model.
 */
export async function initEmbeddings(): Promise<void> {
  if (_ready) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      // Read model config (inside async init so config is available)
      try {
        const config = getConfig();
        MODEL_ID = config.get('embeddings', 'model');
        EMBEDDING_DIM = config.get('embeddings', 'dimensions');
      } catch {
        // Config not initialized yet, use defaults
      }

      logger.info('EMBEDDINGS', 'Initializing embedding model...', { model: MODEL_ID });

      // Dynamic import to avoid loading at startup
      const { pipeline, env } = await import('@huggingface/transformers');

      // Set cache directory to ~/.smriti/models/
      env.cacheDir = MODELS_DIR;

      _pipeline = await pipeline('feature-extraction', MODEL_ID);
      _ready = true;

      logger.info('EMBEDDINGS', 'Embedding model ready', { model: MODEL_ID, dim: EMBEDDING_DIM });
    } catch (error) {
      _initPromise = null; // Allow retry on failure
      logger.error('EMBEDDINGS', 'Failed to initialize embedding model', {
        error: (error as Error).message,
      });
      throw error;
    }
  })();

  return _initPromise;
}

/**
 * Generate an embedding for a single text string.
 * Returns a Float32Array of 384 dimensions.
 *
 * Automatically initializes the model on first call.
 */
export async function embed(text: string): Promise<Float32Array> {
  if (!_ready) await initEmbeddings();

  // biome-ignore lint/style/noNonNullAssertion: guaranteed initialized by initEmbeddings() check above
  const output = await _pipeline!(text, {
    pooling: 'mean',
    normalize: true,
  });

  // output.data is Float32Array
  return new Float32Array(output.data);
}

/**
 * Generate embeddings for multiple texts in a batch.
 * More efficient than calling embed() individually.
 *
 * Returns an array of Float32Arrays, one per input text.
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  if (!_ready) await initEmbeddings();

  // biome-ignore lint/style/noNonNullAssertion: guaranteed initialized by initEmbeddings() check above
  const output = await _pipeline!(texts, {
    pooling: 'mean',
    normalize: true,
  });

  // output.dims = [texts.length, 384]
  // output.data is a flat Float32Array of all embeddings concatenated
  const results: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    const start = i * EMBEDDING_DIM;
    const slice = output.data.slice(start, start + EMBEDDING_DIM);
    results.push(new Float32Array(slice));
  }
  return results;
}

/**
 * Build a text string suitable for embedding from an observation's fields.
 * Combines title, facts, and concepts into a single string.
 */
export function buildEmbeddableText(observation: {
  title: string;
  type: string;
  facts?: string | null;
  concepts?: string | null;
  files_affected?: string | null;
}): string {
  const parts: string[] = [];

  parts.push(`[${observation.type}] ${observation.title}`);

  if (observation.facts) {
    try {
      const facts = JSON.parse(observation.facts);
      if (Array.isArray(facts) && facts.length > 0) {
        parts.push(facts.join('. '));
      }
    } catch {
      /* ignore parse errors */
    }
  }

  if (observation.concepts) {
    try {
      const concepts = JSON.parse(observation.concepts);
      if (Array.isArray(concepts) && concepts.length > 0) {
        parts.push(concepts.join(', '));
      }
    } catch {
      /* ignore parse errors */
    }
  }

  return parts.join(' | ');
}

/**
 * Check if the embedding service is ready.
 */
export function isEmbeddingReady(): boolean {
  return _ready;
}

/**
 * Get the embedding dimension.
 */
export function getEmbeddingDim(): number {
  return EMBEDDING_DIM;
}

/**
 * Reset the embedding service (for testing).
 */
export function resetEmbeddings(): void {
  _pipeline = null;
  _initPromise = null;
  _ready = false;
}
