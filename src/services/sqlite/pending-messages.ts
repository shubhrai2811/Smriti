import type { Database } from 'bun:sqlite';
import type { PendingMessageRow, PendingMessageType } from '../../shared/types.js';

export function enqueuePendingMessage(
  db: Database,
  opts: {
    sessionId: number;
    contentSessionId: string;
    messageType: PendingMessageType;
    toolName?: string;
    toolInput?: string;
    toolResponse?: string;
    cwd?: string;
    lastAssistantMessage?: string;
    promptNumber?: number;
  }
): number {
  const now = Date.now();

  const stmt = db.query(
    `INSERT INTO pending_messages
       (session_id, content_session_id, message_type, tool_name, tool_input, tool_response, cwd, last_assistant_message, prompt_number, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`
  );

  const row = stmt.get(
    opts.sessionId,
    opts.contentSessionId,
    opts.messageType,
    opts.toolName ?? null,
    opts.toolInput ?? null,
    opts.toolResponse ?? null,
    opts.cwd ?? null,
    opts.lastAssistantMessage ?? null,
    opts.promptNumber ?? null,
    now
  ) as { id: number };

  return row.id;
}

export function claimBatch(
  db: Database,
  sessionId: number,
  batchSize: number
): PendingMessageRow[] {
  // Atomically claim a batch: select pending messages and update them to processing
  const claimed = db.transaction(() => {
    const rows = db.query(
      `SELECT * FROM pending_messages
       WHERE session_id = ? AND status = 'pending'
       ORDER BY created_at_epoch ASC
       LIMIT ?`
    ).all(sessionId, batchSize) as PendingMessageRow[];

    if (rows.length === 0) return rows;

    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    db.run(
      `UPDATE pending_messages SET status = 'processing' WHERE id IN (${placeholders})`,
      ids
    );

    // Return the rows with updated status
    return rows.map(r => ({ ...r, status: 'processing' as const }));
  })();

  return claimed;
}

export function confirmProcessed(db: Database, messageId: number): void {
  db.run('DELETE FROM pending_messages WHERE id = ?', [messageId]);
}

export function markFailed(db: Database, messageId: number): void {
  db.run(
    `UPDATE pending_messages SET status = 'failed', retry_count = retry_count + 1 WHERE id = ?`,
    [messageId]
  );
}

export function getPendingCount(db: Database, sessionId: number): number {
  const stmt = db.query(
    `SELECT COUNT(*) as count FROM pending_messages WHERE session_id = ? AND status = 'pending'`
  );
  const row = stmt.get(sessionId) as { count: number };
  return row.count;
}

export function resetStaleProcessing(db: Database): number {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

  const result = db.run(
    `UPDATE pending_messages
     SET status = 'pending'
     WHERE status = 'processing' AND created_at_epoch < ?`,
    [fiveMinutesAgo]
  );

  return result.changes;
}

export function getFailedMessages(
  db: Database,
  sessionId: number,
  maxRetries: number
): PendingMessageRow[] {
  const stmt = db.query(
    `SELECT * FROM pending_messages
     WHERE session_id = ? AND status = 'failed' AND retry_count < ?
     ORDER BY created_at_epoch ASC`
  );
  return stmt.all(sessionId, maxRetries) as PendingMessageRow[];
}
