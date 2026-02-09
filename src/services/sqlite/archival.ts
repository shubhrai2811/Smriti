import type { Database } from 'bun:sqlite';

/**
 * Archive observations older than retentionDays.
 * Moves rows from observations to archived_observations and deletes originals.
 */
export function archiveOldObservations(db: Database, project: string, retentionDays: number): { archived: number } {
  const cutoffEpoch = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const result = db.transaction(() => {
    // Insert into archived_observations (keep project-scoped only; don't archive other project's globals)
    const insertResult = db.run(
      `INSERT INTO archived_observations
         (id, session_id, project, branch, source_ide, type, title, facts, concepts, files_affected, importance, scope, prompt_number, created_at, created_at_epoch, archived_at_epoch)
       SELECT
         id, session_id, project, branch, source_ide, type, title, facts, concepts, files_affected, importance, scope, prompt_number, created_at, created_at_epoch, ?
       FROM observations
       WHERE project = ? AND created_at_epoch < ?`,
      [now, project, cutoffEpoch],
    );

    const archivedCount = insertResult.changes;

    // Delete the archived observations from the main table
    if (archivedCount > 0) {
      db.run('DELETE FROM observations WHERE project = ? AND created_at_epoch < ?', [project, cutoffEpoch]);
    }

    return archivedCount;
  })();

  return { archived: result };
}

/**
 * Run VACUUM to reclaim space after archival/deletion.
 */
export function vacuumDatabase(db: Database): void {
  db.run('VACUUM');
}

/**
 * Get archival stats for a project.
 */
export function getArchivalStats(
  db: Database,
  project: string,
): {
  totalObservations: number;
  archivedObservations: number;
  oldestObservationEpoch: number | null;
} {
  const totalRow = db.query('SELECT COUNT(*) as count FROM observations WHERE project = ?').get(project) as {
    count: number;
  };

  const archivedRow = db
    .query('SELECT COUNT(*) as count FROM archived_observations WHERE project = ?')
    .get(project) as { count: number };

  const oldestRow = db
    .query('SELECT MIN(created_at_epoch) as oldest FROM observations WHERE project = ?')
    .get(project) as { oldest: number | null };

  return {
    totalObservations: totalRow.count,
    archivedObservations: archivedRow.count,
    oldestObservationEpoch: oldestRow.oldest,
  };
}
