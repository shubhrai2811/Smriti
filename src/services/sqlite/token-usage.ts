import type { Database } from 'bun:sqlite';

export interface InsertTokenUsageParams {
  sessionId?: number | null;
  provider: string;
  operation: 'extraction' | 'summary' | 'quick_reflection' | 'deep_reflection';
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
  model?: string;
}

export interface TokenUsageRow {
  id: number;
  session_id: number | null;
  provider: string;
  operation: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  model: string | null;
  created_at_epoch: number;
}

export interface TokenUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byProvider: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }>;
  byOperation: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }>;
}

export function insertTokenUsage(db: Database, params: InsertTokenUsageParams): number {
  db.query(
    `INSERT INTO token_usage (session_id, provider, operation, input_tokens, output_tokens, estimated_cost_usd, model, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    params.sessionId ?? null,
    params.provider,
    params.operation,
    params.inputTokens,
    params.outputTokens,
    params.estimatedCostUsd ?? 0,
    params.model ?? null,
    Date.now(),
  );
  return (db.query('SELECT last_insert_rowid() as id').get() as any).id;
}

export function getTokenUsageBySession(db: Database, sessionId: number): TokenUsageRow[] {
  return db
    .query('SELECT * FROM token_usage WHERE session_id = ? ORDER BY created_at_epoch DESC')
    .all(sessionId) as TokenUsageRow[];
}

export function getRecentTokenUsage(db: Database, limit: number = 50): TokenUsageRow[] {
  return db.query('SELECT * FROM token_usage ORDER BY created_at_epoch DESC LIMIT ?').all(limit) as TokenUsageRow[];
}

export function getTokenUsageSummary(
  db: Database,
  opts?: { sessionId?: number; sinceDaysAgo?: number },
): TokenUsageSummary {
  let whereClause = '1=1';
  const params: any[] = [];

  if (opts?.sessionId) {
    whereClause += ' AND session_id = ?';
    params.push(opts.sessionId);
  }
  if (opts?.sinceDaysAgo) {
    whereClause += ' AND created_at_epoch > ?';
    params.push(Date.now() - opts.sinceDaysAgo * 24 * 60 * 60 * 1000);
  }

  // Totals
  const totals = db
    .query(
      `SELECT COALESCE(SUM(input_tokens), 0) as total_input, COALESCE(SUM(output_tokens), 0) as total_output, COALESCE(SUM(estimated_cost_usd), 0) as total_cost FROM token_usage WHERE ${whereClause}`,
    )
    .get(...params) as any;

  // By provider
  const providerRows = db
    .query(
      `SELECT provider, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, SUM(estimated_cost_usd) as cost_usd FROM token_usage WHERE ${whereClause} GROUP BY provider`,
    )
    .all(...params) as any[];

  const byProvider: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }> = {};
  for (const row of providerRows) {
    byProvider[row.provider] = {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
    };
  }

  // By operation
  const operationRows = db
    .query(
      `SELECT operation, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, SUM(estimated_cost_usd) as cost_usd FROM token_usage WHERE ${whereClause} GROUP BY operation`,
    )
    .all(...params) as any[];

  const byOperation: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }> = {};
  for (const row of operationRows) {
    byOperation[row.operation] = {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
    };
  }

  return {
    totalInputTokens: totals.total_input,
    totalOutputTokens: totals.total_output,
    totalCostUsd: totals.total_cost,
    byProvider,
    byOperation,
  };
}
