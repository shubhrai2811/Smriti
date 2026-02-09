// Types matching the Smriti API responses

export type ObservationType =
  | 'bugfix'
  | 'feature'
  | 'refactor'
  | 'discovery'
  | 'decision'
  | 'pattern'
  | 'config'
  | 'dependency';

export type SessionStatus = 'active' | 'completed' | 'failed';

export interface SessionRow {
  id: number;
  content_session_id: string;
  project: string;
  branch: string | null;
  source_ide: string;
  status: SessionStatus;
  prompt_count: number;
  created_at: string;
  completed_at: string | null;
  created_at_epoch: number;
}

export interface ObservationRow {
  id: number;
  session_id: number;
  project: string;
  branch: string | null;
  source_ide: string;
  type: ObservationType;
  title: string;
  facts: string | null; // JSON array
  concepts: string | null; // JSON array
  files_affected: string | null; // JSON array
  importance: number;
  scope?: string;
  prompt_number: number | null;
  created_at: string;
  created_at_epoch: number;
}

export interface ReflectionRow {
  id: number;
  session_id: number | null;
  project: string;
  type: string;
  insight: string;
  category: string | null;
  source_observation_ids: string | null;
  confidence: number;
  created_at: string;
  created_at_epoch: number;
}

export interface ProfileEntryRow {
  id: number;
  project: string | null;
  category: string;
  description: string;
  confidence: number;
  evidence_count: number;
  source_reflection_ids: string | null;
  created_at: string;
  created_at_epoch: number;
  updated_at_epoch: number;
}

export interface ObservationLinkRow {
  id: number;
  source_id: number;
  target_id: number;
  link_type: string;
  confidence: number;
  created_at_epoch: number;
}

export interface TokenUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byProvider: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }>;
  byOperation: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }>;
}

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
  embeddings: {
    model: string;
    dimensions: number;
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
    briefThreshold: number;
    minimalThreshold: number;
  };
  branch: {
    filterMode: 'all' | 'branch-only' | 'branch-plus-main';
    defaultBranch: string;
  };
  privacy: {
    redactSecrets: boolean;
    stripPrivateTags: boolean;
  };
  log: {
    level: string;
  };
}

// API response wrappers
export interface SessionsResponse {
  sessions: SessionRow[];
}

export interface ObservationsResponse {
  observations: ObservationRow[];
}

export interface ReflectionsResponse {
  reflections: ReflectionRow[];
}

export interface ProfileResponse {
  entries: ProfileEntryRow[];
}

export interface LinksResponse {
  links: ObservationLinkRow[];
}

export interface HealthResponse {
  status: string;
  uptime: number;
}

export interface VersionResponse {
  version: string;
}

export interface EntityRow {
  id: number;
  project: string;
  entity_type: string;
  name: string;
  metadata: string | null;
  first_seen_epoch: number;
  last_seen_epoch: number;
  mention_count: number;
}

export interface EntitiesResponse {
  entities: EntityRow[];
}

export interface HotspotsResponse {
  hotspots: EntityRow[];
}

export interface TagsResponse {
  tags: Array<{ tag: string; count: number }>;
}

export interface ObservationTagsResponse {
  tags: string[];
}

export interface EntityRelationshipRow {
  id: number;
  source_entity_id: number;
  target_entity_id: number;
  relationship_type: string;
  confidence: number;
  evidence_count: number;
  first_seen_epoch: number;
  last_seen_epoch: number;
  source_name?: string;
  target_name?: string;
  source_type?: string;
  target_type?: string;
}

export interface EntityRelationshipsResponse {
  relationships: EntityRelationshipRow[];
}

export interface EntityGraphResponse {
  nodes: EntityRow[];
  edges: EntityRelationshipRow[];
}
