import type { Database } from 'bun:sqlite';

/**
 * Export/Import for Smriti memory data.
 * Allows backing up and restoring all project-scoped data.
 */

// --- Export types ---

export interface SmritiExport {
  version: 1;
  exportedAt: string;
  project: string;
  sessions: ExportSession[];
  observations: ExportObservation[];
  summaries: ExportSummary[];
  reflections: ExportReflection[];
  profileEntries: ExportProfileEntry[];
  entities: ExportEntity[];
}

interface ExportSession {
  contentSessionId: string;
  project: string;
  branch: string | null;
  sourceIde: string;
  status: string;
  createdAtEpoch: number;
}

interface ExportObservation {
  type: string;
  title: string;
  facts: string | null;
  concepts: string | null;
  filesAffected: string | null;
  importance: number;
  branch: string | null;
  sourceIde: string;
  createdAtEpoch: number;
  sessionContentId: string;
}

interface ExportSummary {
  request: string | null;
  learned: string | null;
  completed: string | null;
  nextSteps: string | null;
  createdAtEpoch: number;
  sessionContentId: string;
}

interface ExportReflection {
  type: string;
  insight: string;
  category: string | null;
  confidence: number;
  createdAtEpoch: number;
}

interface ExportProfileEntry {
  category: string;
  description: string;
  confidence: number;
  evidenceCount: number;
}

interface ExportEntity {
  entityType: string;
  name: string;
  metadata: string | null;
  mentionCount: number;
}

// --- Import result ---

export interface ImportResult {
  imported: {
    sessions: number;
    observations: number;
    summaries: number;
    reflections: number;
    profileEntries: number;
    entities: number;
  };
}

// --- Export ---

export function exportProject(db: Database, project: string): SmritiExport {
  // Sessions
  const sessions = db.query(
    'SELECT content_session_id, project, branch, source_ide, status, created_at_epoch FROM sessions WHERE project = ? ORDER BY created_at_epoch ASC'
  ).all(project) as Array<{
    content_session_id: string;
    project: string;
    branch: string | null;
    source_ide: string;
    status: string;
    created_at_epoch: number;
  }>;

  // Observations — join with sessions to get content_session_id
  const observations = db.query(
    `SELECT o.type, o.title, o.facts, o.concepts, o.files_affected, o.importance, o.branch, o.source_ide, o.created_at_epoch, s.content_session_id
     FROM observations o
     INNER JOIN sessions s ON s.id = o.session_id
     WHERE o.project = ?
     ORDER BY o.created_at_epoch ASC`
  ).all(project) as Array<{
    type: string;
    title: string;
    facts: string | null;
    concepts: string | null;
    files_affected: string | null;
    importance: number;
    branch: string | null;
    source_ide: string;
    created_at_epoch: number;
    content_session_id: string;
  }>;

  // Summaries — join with sessions to get content_session_id
  const summaries = db.query(
    `SELECT sm.request, sm.learned, sm.completed, sm.next_steps, sm.created_at_epoch, s.content_session_id
     FROM summaries sm
     INNER JOIN sessions s ON s.id = sm.session_id
     WHERE sm.project = ?
     ORDER BY sm.created_at_epoch ASC`
  ).all(project) as Array<{
    request: string | null;
    learned: string | null;
    completed: string | null;
    next_steps: string | null;
    created_at_epoch: number;
    content_session_id: string;
  }>;

  // Reflections
  const reflections = db.query(
    'SELECT type, insight, category, confidence, created_at_epoch FROM reflections WHERE project = ? ORDER BY created_at_epoch ASC'
  ).all(project) as Array<{
    type: string;
    insight: string;
    category: string | null;
    confidence: number;
    created_at_epoch: number;
  }>;

  // Profile entries — include project-specific and global (project IS NULL)
  const profileEntries = db.query(
    'SELECT category, description, confidence, evidence_count FROM developer_profile WHERE project = ? OR project IS NULL ORDER BY confidence DESC'
  ).all(project) as Array<{
    category: string;
    description: string;
    confidence: number;
    evidence_count: number;
  }>;

  // Entities
  const entities = db.query(
    'SELECT entity_type, name, metadata, mention_count FROM entities WHERE project = ? ORDER BY mention_count DESC'
  ).all(project) as Array<{
    entity_type: string;
    name: string;
    metadata: string | null;
    mention_count: number;
  }>;

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
    sessions: sessions.map((s) => ({
      contentSessionId: s.content_session_id,
      project: s.project,
      branch: s.branch,
      sourceIde: s.source_ide,
      status: s.status,
      createdAtEpoch: s.created_at_epoch,
    })),
    observations: observations.map((o) => ({
      type: o.type,
      title: o.title,
      facts: o.facts,
      concepts: o.concepts,
      filesAffected: o.files_affected,
      importance: o.importance,
      branch: o.branch,
      sourceIde: o.source_ide,
      createdAtEpoch: o.created_at_epoch,
      sessionContentId: o.content_session_id,
    })),
    summaries: summaries.map((sm) => ({
      request: sm.request,
      learned: sm.learned,
      completed: sm.completed,
      nextSteps: sm.next_steps,
      createdAtEpoch: sm.created_at_epoch,
      sessionContentId: sm.content_session_id,
    })),
    reflections: reflections.map((r) => ({
      type: r.type,
      insight: r.insight,
      category: r.category,
      confidence: r.confidence,
      createdAtEpoch: r.created_at_epoch,
    })),
    profileEntries: profileEntries.map((p) => ({
      category: p.category,
      description: p.description,
      confidence: p.confidence,
      evidenceCount: p.evidence_count,
    })),
    entities: entities.map((e) => ({
      entityType: e.entity_type,
      name: e.name,
      metadata: e.metadata,
      mentionCount: e.mention_count,
    })),
  };
}

// --- Import ---

export function importProject(db: Database, data: SmritiExport): ImportResult {
  const counts = {
    sessions: 0,
    observations: 0,
    summaries: 0,
    reflections: 0,
    profileEntries: 0,
    entities: 0,
  };

  const project = data.project;

  db.transaction(() => {
    // 1. Import sessions — map contentSessionId to new DB id
    const sessionIdMap = new Map<string, number>();

    for (const s of data.sessions) {
      // INSERT OR IGNORE to skip duplicate content_session_ids
      db.run(
        `INSERT OR IGNORE INTO sessions (content_session_id, project, branch, source_ide, status, created_at_epoch)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [s.contentSessionId, s.project, s.branch, s.sourceIde, s.status, s.createdAtEpoch]
      );

      // Get the id (either newly inserted or existing)
      const row = db.query(
        'SELECT id FROM sessions WHERE content_session_id = ?'
      ).get(s.contentSessionId) as { id: number } | null;

      if (row) {
        sessionIdMap.set(s.contentSessionId, row.id);
        counts.sessions++;
      }
    }

    // 2. Import observations — using session id mapping
    for (const o of data.observations) {
      const sessionId = sessionIdMap.get(o.sessionContentId);
      if (!sessionId) continue; // skip if session not found

      db.run(
        `INSERT INTO observations (session_id, project, branch, source_ide, type, title, facts, concepts, files_affected, importance, created_at_epoch)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, project, o.branch, o.sourceIde, o.type, o.title, o.facts, o.concepts, o.filesAffected, o.importance, o.createdAtEpoch]
      );
      counts.observations++;
    }

    // 3. Import summaries — using session id mapping
    for (const sm of data.summaries) {
      const sessionId = sessionIdMap.get(sm.sessionContentId);
      if (!sessionId) continue;

      db.run(
        `INSERT INTO summaries (session_id, project, request, learned, completed, next_steps, created_at_epoch)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, project, sm.request, sm.learned, sm.completed, sm.nextSteps, sm.createdAtEpoch]
      );
      counts.summaries++;
    }

    // 4. Import reflections
    for (const r of data.reflections) {
      db.run(
        `INSERT INTO reflections (project, type, insight, category, confidence, created_at_epoch)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [project, r.type, r.insight, r.category, r.confidence, r.createdAtEpoch]
      );
      counts.reflections++;
    }

    // 5. Import profile entries
    const now = Date.now();
    for (const p of data.profileEntries) {
      db.run(
        `INSERT INTO developer_profile (project, category, description, confidence, evidence_count, created_at_epoch, updated_at_epoch)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [project, p.category, p.description, p.confidence, p.evidenceCount, now, now]
      );
      counts.profileEntries++;
    }

    // 6. Import entities — use INSERT OR IGNORE for unique(project, entity_type, name)
    for (const e of data.entities) {
      const existing = db.query(
        'SELECT id FROM entities WHERE project = ? AND entity_type = ? AND name = ?'
      ).get(project, e.entityType, e.name) as { id: number } | null;

      if (existing) {
        // Update mention count and metadata if entity already exists
        db.run(
          'UPDATE entities SET mention_count = mention_count + ?, metadata = COALESCE(?, metadata), last_seen_epoch = ? WHERE id = ?',
          [e.mentionCount, e.metadata, now, existing.id]
        );
      } else {
        db.run(
          `INSERT INTO entities (project, entity_type, name, metadata, first_seen_epoch, last_seen_epoch, mention_count)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [project, e.entityType, e.name, e.metadata, now, now, e.mentionCount]
        );
      }
      counts.entities++;
    }
  })();

  return { imported: counts };
}
