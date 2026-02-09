import type { Database } from 'bun:sqlite';

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

/**
 * Upsert entity — insert or update mention_count and last_seen_epoch.
 * Returns the entity id.
 */
export function upsertEntity(
  db: Database,
  params: { project: string; entityType: string; name: string; metadata?: string | null },
): number {
  const now = Date.now();

  // Try to update existing entity first
  const existing = db
    .query('SELECT id FROM entities WHERE project = ? AND entity_type = ? AND name = ?')
    .get(params.project, params.entityType, params.name) as { id: number } | null;

  if (existing) {
    db.run('UPDATE entities SET mention_count = mention_count + 1, last_seen_epoch = ? WHERE id = ?', [
      now,
      existing.id,
    ]);
    return existing.id;
  }

  const row = db
    .query(
      `INSERT INTO entities (project, entity_type, name, metadata, first_seen_epoch, last_seen_epoch, mention_count)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     RETURNING id`,
    )
    .get(params.project, params.entityType, params.name, params.metadata ?? null, now, now) as { id: number };

  return row.id;
}

/**
 * Record that an entity was mentioned in an observation.
 */
export function addEntityMention(
  db: Database,
  params: { entityId: number; observationId: number; context?: string | null },
): void {
  const now = Date.now();

  db.run(
    `INSERT OR IGNORE INTO entity_mentions (entity_id, observation_id, context, created_at_epoch)
     VALUES (?, ?, ?, ?)`,
    [params.entityId, params.observationId, params.context ?? null, now],
  );
}

/**
 * Get entities for a project, optionally filtered by type.
 */
export function getEntitiesByProject(
  db: Database,
  project: string,
  opts?: { entityType?: string; limit?: number },
): EntityRow[] {
  const limit = opts?.limit ?? 100;

  if (opts?.entityType) {
    return db
      .query('SELECT * FROM entities WHERE project = ? AND entity_type = ? ORDER BY last_seen_epoch DESC LIMIT ?')
      .all(project, opts.entityType, limit) as EntityRow[];
  }

  return db
    .query('SELECT * FROM entities WHERE project = ? ORDER BY last_seen_epoch DESC LIMIT ?')
    .all(project, limit) as EntityRow[];
}

/**
 * Get all observations that mention a specific entity.
 */
export function getObservationsByEntity(
  db: Database,
  entityId: number,
): { observationId: number; context: string | null }[] {
  return db
    .query(
      'SELECT observation_id as observationId, context FROM entity_mentions WHERE entity_id = ? ORDER BY created_at_epoch DESC',
    )
    .all(entityId) as { observationId: number; context: string | null }[];
}

/**
 * Get entities mentioned in an observation.
 */
export function getEntitiesByObservation(db: Database, observationId: number): EntityRow[] {
  return db
    .query(
      `SELECT e.* FROM entities e
     INNER JOIN entity_mentions em ON em.entity_id = e.id
     WHERE em.observation_id = ?
     ORDER BY e.mention_count DESC`,
    )
    .all(observationId) as EntityRow[];
}

/**
 * Get most referenced entities (hotspots) for a project.
 */
export function getHotspotEntities(
  db: Database,
  project: string,
  opts?: { entityType?: string; limit?: number },
): EntityRow[] {
  const limit = opts?.limit ?? 20;

  if (opts?.entityType) {
    return db
      .query('SELECT * FROM entities WHERE project = ? AND entity_type = ? ORDER BY mention_count DESC LIMIT ?')
      .all(project, opts.entityType, limit) as EntityRow[];
  }

  return db
    .query('SELECT * FROM entities WHERE project = ? ORDER BY mention_count DESC LIMIT ?')
    .all(project, limit) as EntityRow[];
}
