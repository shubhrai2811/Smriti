// Observation types
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
export type PendingMessageStatus = 'pending' | 'processing' | 'failed';
export type PendingMessageType = 'observation' | 'summarize';

// DB row types
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
  prompt_number: number | null;
  created_at: string;
  created_at_epoch: number;
}

export interface SummaryRow {
  id: number;
  session_id: number;
  project: string;
  request: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  created_at: string;
  created_at_epoch: number;
}

export interface PromptRow {
  id: number;
  session_id: number;
  prompt_number: number;
  prompt_text: string;
  created_at_epoch: number;
}

export interface PendingMessageRow {
  id: number;
  session_id: number;
  content_session_id: string;
  message_type: PendingMessageType;
  tool_name: string | null;
  tool_input: string | null;
  tool_response: string | null;
  cwd: string | null;
  last_assistant_message: string | null;
  prompt_number: number | null;
  status: PendingMessageStatus;
  retry_count: number;
  created_at_epoch: number;
}

// Extracted observation from AI
export interface ExtractedObservation {
  type: ObservationType;
  title: string;
  facts: string[];
  concepts: string[];
  filesAffected: string[];
  importance: number;
}

// Summary from AI
export interface ExtractedSummary {
  request: string;
  learned: string;
  completed: string;
  nextSteps: string;
}

// PID file info
export interface PidInfo {
  pid: number;
  port: number;
  startedAt: string;
  version: string;
}
