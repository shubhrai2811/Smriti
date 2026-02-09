import type { Database } from 'bun:sqlite';

export type RelationshipType = 'imports' | 'calls' | 'depends_on' | 'configures' | 'related_to';

export interface EntityRelationshipRow {
  id: number;
  source_entity_id: number;
  target_entity_id: number;
  relationship_type: RelationshipType;
  confidence: number;
  evidence_count: number;
  first_seen_epoch: number;
  last_seen_epoch: number;
}

export interface EntityRelationshipWithNames extends EntityRelationshipRow {
  source_name: string;
  target_name: string;
  source_type: string;
  target_type: string;
}

/**
 * Upsert a relationship between two entities.
 * If the relationship already exists, increment evidence_count and update last_seen_epoch.
 */
export function upsertRelationship(
  db: Database,
  params: {
    sourceEntityId: number;
    targetEntityId: number;
    relationshipType: RelationshipType;
    confidence?: number;
  },
): void {
  const now = Date.now();
  const confidence = params.confidence ?? 0.5;

  const existing = db
    .query(
      `SELECT id FROM entity_relationships
     WHERE source_entity_id = ? AND target_entity_id = ? AND relationship_type = ?`,
    )
    .get(params.sourceEntityId, params.targetEntityId, params.relationshipType) as { id: number } | null;

  if (existing) {
    db.run(
      `UPDATE entity_relationships
       SET evidence_count = evidence_count + 1, last_seen_epoch = ?, confidence = MAX(confidence, ?)
       WHERE id = ?`,
      [now, confidence, existing.id],
    );
  } else {
    db.run(
      `INSERT INTO entity_relationships (source_entity_id, target_entity_id, relationship_type, confidence, evidence_count, first_seen_epoch, last_seen_epoch)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [params.sourceEntityId, params.targetEntityId, params.relationshipType, confidence, now, now],
    );
  }
}

/**
 * Get all relationships for an entity (both as source and target).
 */
export function getRelationships(db: Database, entityId: number): EntityRelationshipWithNames[] {
  return db
    .query(
      `SELECT er.*,
            se.name as source_name, se.entity_type as source_type,
            te.name as target_name, te.entity_type as target_type
     FROM entity_relationships er
     JOIN entities se ON se.id = er.source_entity_id
     JOIN entities te ON te.id = er.target_entity_id
     WHERE er.source_entity_id = ? OR er.target_entity_id = ?
     ORDER BY er.evidence_count DESC`,
    )
    .all(entityId, entityId) as EntityRelationshipWithNames[];
}

/**
 * Get entities connected to a given entity via relationships.
 */
export function getRelatedEntities(
  db: Database,
  entityId: number,
): Array<{
  id: number;
  name: string;
  entity_type: string;
  relationship_type: string;
  direction: 'outgoing' | 'incoming';
  evidence_count: number;
}> {
  const outgoing = db
    .query(
      `SELECT e.id, e.name, e.entity_type, er.relationship_type, er.evidence_count
     FROM entity_relationships er
     JOIN entities e ON e.id = er.target_entity_id
     WHERE er.source_entity_id = ?
     ORDER BY er.evidence_count DESC`,
    )
    .all(entityId) as Array<{
    id: number;
    name: string;
    entity_type: string;
    relationship_type: string;
    evidence_count: number;
  }>;

  const incoming = db
    .query(
      `SELECT e.id, e.name, e.entity_type, er.relationship_type, er.evidence_count
     FROM entity_relationships er
     JOIN entities e ON e.id = er.source_entity_id
     WHERE er.target_entity_id = ?
     ORDER BY er.evidence_count DESC`,
    )
    .all(entityId) as Array<{
    id: number;
    name: string;
    entity_type: string;
    relationship_type: string;
    evidence_count: number;
  }>;

  return [
    ...outgoing.map((r) => ({ ...r, direction: 'outgoing' as const })),
    ...incoming.map((r) => ({ ...r, direction: 'incoming' as const })),
  ];
}

/**
 * Get the full entity graph for a project (nodes + edges).
 */
export function getEntityGraph(
  db: Database,
  project: string,
  opts?: { limit?: number },
): { nodes: any[]; edges: EntityRelationshipWithNames[] } {
  const limit = opts?.limit ?? 100;

  const nodes = db
    .query('SELECT * FROM entities WHERE project = ? ORDER BY mention_count DESC LIMIT ?')
    .all(project, limit) as any[];

  const nodeIds = new Set(nodes.map((n) => n.id));

  // Get edges where both source and target are in the node set
  const allEdges = db
    .query(
      `SELECT er.*,
            se.name as source_name, se.entity_type as source_type,
            te.name as target_name, te.entity_type as target_type
     FROM entity_relationships er
     JOIN entities se ON se.id = er.source_entity_id
     JOIN entities te ON te.id = er.target_entity_id
     WHERE se.project = ?
     ORDER BY er.evidence_count DESC`,
    )
    .all(project) as EntityRelationshipWithNames[];

  const edges = allEdges.filter((e) => nodeIds.has(e.source_entity_id) && nodeIds.has(e.target_entity_id));

  return { nodes, edges };
}
