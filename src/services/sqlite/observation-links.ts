import type { Database } from 'bun:sqlite';

export interface InsertLinkParams {
  sourceId: number;
  targetId: number;
  linkType: 'related' | 'caused_by' | 'fixed_by' | 'evolved_into';
  confidence?: number;
}

export interface ObservationLinkRow {
  id: number;
  source_id: number;
  target_id: number;
  link_type: string;
  confidence: number;
  created_at_epoch: number;
}

export function insertLink(db: Database, params: InsertLinkParams): number | null {
  try {
    db.query(
      `INSERT OR IGNORE INTO observation_links (source_id, target_id, link_type, confidence, created_at_epoch)
       VALUES (?, ?, ?, ?, ?)`
    ).run(params.sourceId, params.targetId, params.linkType, params.confidence ?? 0.5, Date.now());
    const result = db.query('SELECT last_insert_rowid() as id').get() as any;
    return result.id > 0 ? result.id : null;
  } catch {
    return null; // Link already exists or FK violation
  }
}

export function getLinksByObservation(db: Database, observationId: number): ObservationLinkRow[] {
  return db.query(
    `SELECT * FROM observation_links WHERE source_id = ? OR target_id = ? ORDER BY confidence DESC`
  ).all(observationId, observationId) as ObservationLinkRow[];
}

export function getLinksBySource(db: Database, sourceId: number): ObservationLinkRow[] {
  return db.query('SELECT * FROM observation_links WHERE source_id = ? ORDER BY confidence DESC')
    .all(sourceId) as ObservationLinkRow[];
}

export function getLinksByType(db: Database, linkType: string, opts?: { limit?: number }): ObservationLinkRow[] {
  const limit = opts?.limit ?? 50;
  return db.query('SELECT * FROM observation_links WHERE link_type = ? ORDER BY confidence DESC LIMIT ?')
    .all(linkType, limit) as ObservationLinkRow[];
}

export function countLinks(db: Database, observationId?: number): number {
  if (observationId) {
    return (db.query('SELECT COUNT(*) as count FROM observation_links WHERE source_id = ? OR target_id = ?')
      .get(observationId, observationId) as any).count;
  }
  return (db.query('SELECT COUNT(*) as count FROM observation_links').get() as any).count;
}
