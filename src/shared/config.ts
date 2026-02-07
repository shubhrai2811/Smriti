import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { SETTINGS_PATH, SMRITI_DIR } from './paths.js';

export interface SmritiSettings {
  worker: {
    port: number;
    host: string;
    idleTimeoutMinutes: number;
  };
  extraction: {
    batchSize: number;
    maxWaitSeconds: number;
    model: string;
    maxRetries: number;
  };
  context: {
    tokenBudget: number;
    showInlineSummary: boolean;
  };
  scoring: {
    vectorWeight: number;
    recencyWeight: number;
    importanceWeight: number;
    dedupeThreshold: number;
  };
  reflection: {
    enabled: boolean;
    deepReflectionInterval: number;
    autoLinkingEnabled: boolean;
    autoLinkThreshold: number;
  };
  provider: {
    primary: string;
    openrouterApiKey: string;
    openrouterModel: string;
    fallbackEnabled: boolean;
    failureThreshold: number;
    cooldownMinutes: number;
  };
  masking: {
    enabled: boolean;
    briefThreshold: number;  // sessions ago to switch to brief
    minimalThreshold: number; // sessions ago to switch to minimal
  };
  branch: {
    filterMode: 'all' | 'branch-only' | 'branch-plus-main';
    defaultBranch: string;
  };
  privacy: {
    redactSecrets: boolean;
    stripPrivateTags: boolean;
  };
  dedup: {
    enabled: boolean;
    similarityThreshold: number;  // cosine similarity threshold (0.0-1.0)
  };
  proactive: {
    enabled: boolean;
    minSimilarity: number;     // minimum similarity threshold (0-1) for mid-session injection
    maxObservations: number;   // max observations to inject mid-session
    tokenBudget: number;       // max tokens for mid-session context
  };
  archival: {
    retentionDays: number;
    vacuumOnMaintenance: boolean;
  };
  log: {
    level: string;
  };
}

const DEFAULT_SETTINGS: SmritiSettings = {
  worker: {
    port: 0,
    host: '127.0.0.1',
    idleTimeoutMinutes: 30,
  },
  extraction: {
    batchSize: 5,
    maxWaitSeconds: 30,
    model: 'claude-sonnet-4-5-20250929',
    maxRetries: 3,
  },
  context: {
    tokenBudget: 4000,
    showInlineSummary: true,
  },
  scoring: {
    vectorWeight: 0.5,
    recencyWeight: 0.3,
    importanceWeight: 0.2,
    dedupeThreshold: 0.92,
  },
  reflection: {
    enabled: true,
    deepReflectionInterval: 5,
    autoLinkingEnabled: true,
    autoLinkThreshold: 0.85,
  },
  provider: {
    primary: 'claude-sdk',
    openrouterApiKey: '',
    openrouterModel: 'anthropic/claude-sonnet-4-5',
    fallbackEnabled: true,
    failureThreshold: 3,
    cooldownMinutes: 5,
  },
  masking: {
    enabled: true,
    briefThreshold: 3,
    minimalThreshold: 6,
  },
  branch: {
    filterMode: 'all',
    defaultBranch: 'main',
  },
  privacy: {
    redactSecrets: true,
    stripPrivateTags: true,
  },
  dedup: {
    enabled: true,
    similarityThreshold: 0.95,
  },
  proactive: {
    enabled: true,
    minSimilarity: 0.75,
    maxObservations: 5,
    tokenBudget: 1500,
  },
  archival: {
    retentionDays: 90,
    vacuumOnMaintenance: true,
  },
  log: {
    level: 'info',
  },
};

// Environment variable overrides mapping
const ENV_OVERRIDES: Record<string, (settings: SmritiSettings, value: string) => void> = {
  SMRITI_WORKER_PORT: (s, v) => { s.worker.port = parseInt(v, 10); },
  SMRITI_WORKER_HOST: (s, v) => { s.worker.host = v; },
  SMRITI_IDLE_TIMEOUT: (s, v) => { s.worker.idleTimeoutMinutes = parseInt(v, 10); },
  SMRITI_BATCH_SIZE: (s, v) => { s.extraction.batchSize = parseInt(v, 10); },
  SMRITI_MAX_WAIT_SECONDS: (s, v) => { s.extraction.maxWaitSeconds = parseInt(v, 10); },
  SMRITI_EXTRACTION_MODEL: (s, v) => { s.extraction.model = v; },
  SMRITI_MAX_RETRIES: (s, v) => { s.extraction.maxRetries = parseInt(v, 10); },
  SMRITI_TOKEN_BUDGET: (s, v) => { s.context.tokenBudget = parseInt(v, 10); },
  SMRITI_INLINE_SUMMARY: (s, v) => { s.context.showInlineSummary = v === 'true'; },
  SMRITI_REDACT_SECRETS: (s, v) => { s.privacy.redactSecrets = v === 'true'; },
  SMRITI_STRIP_PRIVATE: (s, v) => { s.privacy.stripPrivateTags = v === 'true'; },
  SMRITI_VECTOR_WEIGHT: (s, v) => { s.scoring.vectorWeight = parseFloat(v); },
  SMRITI_RECENCY_WEIGHT: (s, v) => { s.scoring.recencyWeight = parseFloat(v); },
  SMRITI_IMPORTANCE_WEIGHT: (s, v) => { s.scoring.importanceWeight = parseFloat(v); },
  SMRITI_DEDUPE_THRESHOLD: (s, v) => { s.scoring.dedupeThreshold = parseFloat(v); },
  SMRITI_REFLECTION_ENABLED: (s, v) => { s.reflection.enabled = v === 'true'; },
  SMRITI_DEEP_REFLECTION_INTERVAL: (s, v) => { s.reflection.deepReflectionInterval = parseInt(v, 10); },
  SMRITI_AUTO_LINKING_ENABLED: (s, v) => { s.reflection.autoLinkingEnabled = v === 'true'; },
  SMRITI_AUTO_LINK_THRESHOLD: (s, v) => { s.reflection.autoLinkThreshold = parseFloat(v); },
  SMRITI_PROVIDER_PRIMARY: (s, v) => { s.provider.primary = v; },
  OPENROUTER_API_KEY: (s, v) => { s.provider.openrouterApiKey = v; },
  SMRITI_OPENROUTER_MODEL: (s, v) => { s.provider.openrouterModel = v; },
  SMRITI_FALLBACK_ENABLED: (s, v) => { s.provider.fallbackEnabled = v === 'true'; },
  SMRITI_FAILURE_THRESHOLD: (s, v) => { s.provider.failureThreshold = parseInt(v, 10); },
  SMRITI_COOLDOWN_MINUTES: (s, v) => { s.provider.cooldownMinutes = parseInt(v, 10); },
  SMRITI_MASKING_ENABLED: (s, v) => { s.masking.enabled = v === 'true'; },
  SMRITI_MASKING_BRIEF_THRESHOLD: (s, v) => { s.masking.briefThreshold = parseInt(v, 10); },
  SMRITI_MASKING_MINIMAL_THRESHOLD: (s, v) => { s.masking.minimalThreshold = parseInt(v, 10); },
  SMRITI_BRANCH_FILTER_MODE: (s, v) => { s.branch.filterMode = v as any; },
  SMRITI_DEFAULT_BRANCH: (s, v) => { s.branch.defaultBranch = v; },
  SMRITI_DEDUP_ENABLED: (s, v) => { s.dedup.enabled = v === 'true'; },
  SMRITI_DEDUP_THRESHOLD: (s, v) => { s.dedup.similarityThreshold = parseFloat(v); },
  SMRITI_PROACTIVE_ENABLED: (s, v) => { s.proactive.enabled = v === 'true'; },
  SMRITI_PROACTIVE_MIN_SIMILARITY: (s, v) => { s.proactive.minSimilarity = parseFloat(v); },
  SMRITI_PROACTIVE_MAX_OBSERVATIONS: (s, v) => { s.proactive.maxObservations = parseInt(v, 10); },
  SMRITI_PROACTIVE_TOKEN_BUDGET: (s, v) => { s.proactive.tokenBudget = parseInt(v, 10); },
  SMRITI_RETENTION_DAYS: (s, v) => { s.archival.retentionDays = parseInt(v, 10); },
  SMRITI_VACUUM_ON_MAINTENANCE: (s, v) => { s.archival.vacuumOnMaintenance = v === 'true'; },
  SMRITI_LOG_LEVEL: (s, v) => { s.log.level = v; },
};

export class Config {
  private settings: SmritiSettings;

  constructor() {
    this.settings = this.load();
  }

  private load(): SmritiSettings {
    // Start with defaults (deep clone)
    const settings: SmritiSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

    // Layer file-based settings
    try {
      const raw = readFileSync(SETTINGS_PATH, 'utf-8');
      const fileSettings = JSON.parse(raw);
      this.merge(settings as unknown as Record<string, unknown>, fileSettings);
    } catch {
      // File doesn't exist or is invalid JSON - use defaults
    }

    // Layer environment variable overrides
    for (const [envVar, applyFn] of Object.entries(ENV_OVERRIDES)) {
      const value = process.env[envVar];
      if (value !== undefined) {
        applyFn(settings, value);
      }
    }

    return settings;
  }

  private merge(target: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const key of Object.keys(source)) {
      if (
        source[key] !== null &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] !== null &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        this.merge(
          target[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>,
        );
      } else {
        target[key] = source[key];
      }
    }
  }

  get<K1 extends keyof SmritiSettings>(section: K1): SmritiSettings[K1];
  get<K1 extends keyof SmritiSettings, K2 extends keyof SmritiSettings[K1]>(
    section: K1,
    key: K2,
  ): SmritiSettings[K1][K2];
  get(section: string, key?: string): unknown {
    const sectionObj = this.settings[section as keyof SmritiSettings];
    if (key === undefined) {
      return sectionObj;
    }
    return (sectionObj as Record<string, unknown>)[key];
  }

  set<K1 extends keyof SmritiSettings, K2 extends keyof SmritiSettings[K1]>(
    section: K1,
    key: K2,
    value: SmritiSettings[K1][K2],
  ): void {
    (this.settings[section] as Record<string, unknown>)[key as string] = value;
  }

  save(): void {
    try {
      mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
      writeFileSync(SETTINGS_PATH, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      // Log but don't throw - settings save is best-effort
      console.error(`[smriti] Failed to save settings: ${err}`);
    }
  }

  getAll(): Readonly<SmritiSettings> {
    return this.settings;
  }

  reload(): void {
    this.settings = this.load();
  }
}

// Singleton
let _instance: Config | null = null;

export function getConfig(): Config {
  if (!_instance) {
    _instance = new Config();
  }
  return _instance;
}

export function resetConfig(): void {
  _instance = null;
}
