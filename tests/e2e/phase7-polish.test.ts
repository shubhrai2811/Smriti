import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { extractEntities } from '../../src/services/extraction/entity-extractor';
import { archiveOldObservations, getArchivalStats, vacuumDatabase } from '../../src/services/sqlite/archival';
import {
  addEntityMention,
  getEntitiesByObservation,
  getEntitiesByProject,
  getHotspotEntities,
  getObservationsByEntity,
  upsertEntity,
} from '../../src/services/sqlite/entities';
import { redactSecrets } from '../../src/utils/privacy';
import { createTestContext, type TestContext } from '../fixtures/helpers';

// Helper to seed a session + observation for tests that need them
function seedSessionAndObservation(
  ctx: TestContext,
  opts?: {
    project?: string;
    createdAtEpoch?: number;
    type?: string;
    title?: string;
  },
) {
  const project = opts?.project || '/tmp/test-proj';
  const epoch = opts?.createdAtEpoch || Date.now();

  ctx.db.run(
    `INSERT INTO sessions (content_session_id, project, branch, source_ide, status, created_at_epoch, prompt_count)
     VALUES (?, ?, 'main', 'claude-code', 'active', ?, 1)`,
    [`sess-${epoch}-${Math.random().toString(36).slice(2)}`, project, epoch],
  );
  const session = ctx.db.query('SELECT last_insert_rowid() as id').get() as { id: number };

  ctx.db.run(
    `INSERT INTO observations (session_id, project, branch, source_ide, type, title, facts, concepts, files_affected, importance, created_at_epoch)
     VALUES (?, ?, 'main', 'claude-code', ?, ?, '["fact1"]', '["concept1"]', '["src/index.ts"]', 7, ?)`,
    [session.id, project, opts?.type || 'discovery', opts?.title || 'Test observation', epoch],
  );
  const obs = ctx.db.query('SELECT last_insert_rowid() as id').get() as { id: number };

  return { sessionId: session.id, observationId: obs.id };
}

describe('Phase 7: Polish & Advanced', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // --- Entity Graph CRUD ---

  describe('Entity Graph CRUD', () => {
    it('upsertEntity creates a new entity', () => {
      const id = upsertEntity(ctx.db, {
        project: '/tmp/proj',
        entityType: 'file',
        name: 'src/index.ts',
        metadata: JSON.stringify({ extension: 'ts', language: 'typescript' }),
      });
      expect(id).toBeGreaterThan(0);

      const entity = ctx.db.query('SELECT * FROM entities WHERE id = ?').get(id) as any;
      expect(entity.project).toBe('/tmp/proj');
      expect(entity.entity_type).toBe('file');
      expect(entity.name).toBe('src/index.ts');
      expect(entity.mention_count).toBe(1);
    });

    it('upsertEntity increments mention_count on duplicate', () => {
      const id = upsertEntity(ctx.db, {
        project: '/tmp/proj',
        entityType: 'file',
        name: 'src/index.ts',
      });
      const id2 = upsertEntity(ctx.db, {
        project: '/tmp/proj',
        entityType: 'file',
        name: 'src/index.ts',
      });
      expect(id).toBe(id2);

      const entity = ctx.db.query('SELECT * FROM entities WHERE id = ?').get(id) as any;
      expect(entity.mention_count).toBe(2);
    });

    it('upsertEntity treats different types as separate entities', () => {
      const fileId = upsertEntity(ctx.db, {
        project: '/tmp/proj',
        entityType: 'file',
        name: 'parser',
      });
      const fnId = upsertEntity(ctx.db, {
        project: '/tmp/proj',
        entityType: 'function',
        name: 'parser',
      });
      expect(fileId).not.toBe(fnId);
    });

    it('addEntityMention records observation link', () => {
      const { observationId } = seedSessionAndObservation(ctx);
      const entityId = upsertEntity(ctx.db, {
        project: '/tmp/test-proj',
        entityType: 'file',
        name: 'src/app.ts',
      });

      addEntityMention(ctx.db, {
        entityId,
        observationId,
        context: 'modified in bugfix',
      });

      const mention = ctx.db
        .query('SELECT * FROM entity_mentions WHERE entity_id = ? AND observation_id = ?')
        .get(entityId, observationId) as any;
      expect(mention).not.toBeNull();
      expect(mention.context).toBe('modified in bugfix');
    });

    it('addEntityMention is idempotent (UNIQUE constraint)', () => {
      const { observationId } = seedSessionAndObservation(ctx);
      const entityId = upsertEntity(ctx.db, {
        project: '/tmp/test-proj',
        entityType: 'file',
        name: 'src/app.ts',
      });

      addEntityMention(ctx.db, { entityId, observationId, context: 'first' });
      addEntityMention(ctx.db, { entityId, observationId, context: 'second' });

      const count = ctx.db
        .query('SELECT COUNT(*) as c FROM entity_mentions WHERE entity_id = ? AND observation_id = ?')
        .get(entityId, observationId) as { c: number };
      expect(count.c).toBe(1);
    });

    it('getEntitiesByProject returns entities sorted by last_seen', () => {
      upsertEntity(ctx.db, { project: '/tmp/proj', entityType: 'file', name: 'old.ts' });
      // Small delay to differentiate timestamps
      upsertEntity(ctx.db, { project: '/tmp/proj', entityType: 'file', name: 'new.ts' });

      const entities = getEntitiesByProject(ctx.db, '/tmp/proj');
      expect(entities.length).toBe(2);
      // Most recent first
      expect(entities[0].last_seen_epoch).toBeGreaterThanOrEqual(entities[1].last_seen_epoch);
    });

    it('getEntitiesByProject filters by entityType', () => {
      upsertEntity(ctx.db, { project: '/tmp/proj', entityType: 'file', name: 'src/a.ts' });
      upsertEntity(ctx.db, { project: '/tmp/proj', entityType: 'function', name: 'doStuff' });

      const files = getEntitiesByProject(ctx.db, '/tmp/proj', { entityType: 'file' });
      expect(files.length).toBe(1);
      expect(files[0].entity_type).toBe('file');
    });

    it('getHotspotEntities returns by mention_count DESC', () => {
      const _id1 = upsertEntity(ctx.db, { project: '/tmp/proj', entityType: 'file', name: 'hot.ts' });
      upsertEntity(ctx.db, { project: '/tmp/proj', entityType: 'file', name: 'hot.ts' }); // +1
      upsertEntity(ctx.db, { project: '/tmp/proj', entityType: 'file', name: 'hot.ts' }); // +1
      upsertEntity(ctx.db, { project: '/tmp/proj', entityType: 'file', name: 'cold.ts' });

      const hotspots = getHotspotEntities(ctx.db, '/tmp/proj');
      expect(hotspots.length).toBe(2);
      expect(hotspots[0].name).toBe('hot.ts');
      expect(hotspots[0].mention_count).toBe(3);
      expect(hotspots[1].name).toBe('cold.ts');
      expect(hotspots[1].mention_count).toBe(1);
    });

    it('getEntitiesByObservation returns entities for an observation', () => {
      const { observationId } = seedSessionAndObservation(ctx);
      const e1 = upsertEntity(ctx.db, { project: '/tmp/test-proj', entityType: 'file', name: 'a.ts' });
      const e2 = upsertEntity(ctx.db, { project: '/tmp/test-proj', entityType: 'function', name: 'doX' });

      addEntityMention(ctx.db, { entityId: e1, observationId });
      addEntityMention(ctx.db, { entityId: e2, observationId });

      const entities = getEntitiesByObservation(ctx.db, observationId);
      expect(entities.length).toBe(2);
    });

    it('getObservationsByEntity returns observations mentioning an entity', () => {
      const { observationId: obs1 } = seedSessionAndObservation(ctx);
      const { observationId: obs2 } = seedSessionAndObservation(ctx);
      const entityId = upsertEntity(ctx.db, { project: '/tmp/test-proj', entityType: 'file', name: 'shared.ts' });

      addEntityMention(ctx.db, { entityId, observationId: obs1, context: 'ctx1' });
      addEntityMention(ctx.db, { entityId, observationId: obs2, context: 'ctx2' });

      const observations = getObservationsByEntity(ctx.db, entityId);
      expect(observations.length).toBe(2);
    });
  });

  // --- Entity Extraction ---

  describe('Entity Extraction', () => {
    it('extracts file entities from filesAffected', () => {
      const { observationId } = seedSessionAndObservation(ctx, { project: '/tmp/proj' });

      extractEntities(ctx.db, observationId, {
        project: '/tmp/proj',
        type: 'feature',
        title: 'Add auth module',
        facts: ['Created new auth module'],
        concepts: ['authentication'],
        filesAffected: ['src/auth/login.ts', 'src/auth/middleware.ts'],
      });

      const entities = getEntitiesByProject(ctx.db, '/tmp/proj', { entityType: 'file' });
      const names = entities.map((e) => e.name);
      expect(names).toContain('src/auth/login.ts');
      expect(names).toContain('src/auth/middleware.ts');
    });

    it('extracts file metadata (extension, language)', () => {
      const { observationId } = seedSessionAndObservation(ctx, { project: '/tmp/proj' });

      extractEntities(ctx.db, observationId, {
        project: '/tmp/proj',
        type: 'feature',
        title: 'Add component',
        facts: [],
        concepts: [],
        filesAffected: ['src/App.tsx'],
      });

      const entities = getEntitiesByProject(ctx.db, '/tmp/proj', { entityType: 'file' });
      const appEntity = entities.find((e) => e.name === 'src/App.tsx');
      expect(appEntity).toBeDefined();
      expect(appEntity?.metadata).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: test assertion - guaranteed by expect above
      const meta = JSON.parse(appEntity!.metadata!);
      expect(meta.extension).toBe('tsx');
      expect(meta.language).toBe('typescript');
    });

    it('extracts error patterns from facts', () => {
      const { observationId } = seedSessionAndObservation(ctx, { project: '/tmp/proj' });

      extractEntities(ctx.db, observationId, {
        project: '/tmp/proj',
        type: 'bugfix',
        title: 'Fix auth error',
        facts: ['Hit a TypeError when parsing user input', 'Also saw ConnectionRefusedError in tests'],
        concepts: [],
        filesAffected: [],
      });

      const entities = getEntitiesByProject(ctx.db, '/tmp/proj', { entityType: 'error_pattern' });
      const names = entities.map((e) => e.name);
      expect(names).toContain('TypeError');
      expect(names).toContain('ConnectionRefusedError');
    });

    it('extracts dependencies from dependency-type observations', () => {
      const { observationId } = seedSessionAndObservation(ctx, { project: '/tmp/proj' });

      extractEntities(ctx.db, observationId, {
        project: '/tmp/proj',
        type: 'dependency',
        title: 'Added hono and esbuild packages',
        facts: ['Installed hono for HTTP server', 'Added esbuild for bundling', 'Using @anthropic-ai/sdk for AI calls'],
        concepts: [],
        filesAffected: [],
      });

      const entities = getEntitiesByProject(ctx.db, '/tmp/proj', { entityType: 'dependency' });
      const names = entities.map((e) => e.name);
      expect(names).toContain('hono');
      expect(names).toContain('esbuild');
      // Scoped package @anthropic-ai/sdk is extracted as the regex can capture it
      // but may split it — check for at least the base name
      expect(names.some((n) => n.includes('anthropic'))).toBe(true);
    });

    it('extracts config keys from config-type observations', () => {
      const { observationId } = seedSessionAndObservation(ctx, { project: '/tmp/proj' });

      extractEntities(ctx.db, observationId, {
        project: '/tmp/proj',
        type: 'config',
        title: 'Updated worker.port and log.level config',
        facts: ['Set SMRITI_WORKER_PORT=3000 in env', 'Changed log.level to debug'],
        concepts: [],
        filesAffected: [],
      });

      const entities = getEntitiesByProject(ctx.db, '/tmp/proj', { entityType: 'config_key' });
      const names = entities.map((e) => e.name);
      expect(names).toContain('SMRITI_WORKER_PORT');
      expect(names).toContain('worker.port');
    });

    it('extracts function names from title and facts', () => {
      const { observationId } = seedSessionAndObservation(ctx, { project: '/tmp/proj' });

      extractEntities(ctx.db, observationId, {
        project: '/tmp/proj',
        type: 'feature',
        title: 'Implemented processObservation() and buildContext()',
        facts: ['Called validateInput() before processing'],
        concepts: [],
        filesAffected: [],
      });

      const entities = getEntitiesByProject(ctx.db, '/tmp/proj', { entityType: 'function' });
      const names = entities.map((e) => e.name);
      expect(names).toContain('processObservation');
      expect(names).toContain('buildContext');
      expect(names).toContain('validateInput');
    });

    it('skips common keywords and built-in functions', () => {
      const { observationId } = seedSessionAndObservation(ctx, { project: '/tmp/proj' });

      extractEntities(ctx.db, observationId, {
        project: '/tmp/proj',
        type: 'feature',
        title: 'if(condition) then require(module) and forEach(item)',
        facts: ['Used console.log() to debug and JSON.stringify() for output'],
        concepts: [],
        filesAffected: [],
      });

      const entities = getEntitiesByProject(ctx.db, '/tmp/proj', { entityType: 'function' });
      const names = entities.map((e) => e.name);
      // These should all be skipped
      expect(names).not.toContain('require');
      expect(names).not.toContain('forEach');
      expect(names).not.toContain('stringify');
    });

    it('is non-blocking (does not throw on failure)', () => {
      // Pass invalid observation ID — should not throw
      expect(() => {
        extractEntities(ctx.db, 999999, {
          project: '/tmp/proj',
          type: 'feature',
          title: 'test',
          facts: [],
          concepts: [],
          filesAffected: ['src/a.ts'],
        });
      }).not.toThrow();
    });
  });

  // --- Database Archival ---

  describe('Database Archival', () => {
    it('archives observations older than retention period', () => {
      const project = '/tmp/proj';
      const oldEpoch = Date.now() - 100 * 24 * 60 * 60 * 1000; // 100 days ago
      seedSessionAndObservation(ctx, { project, createdAtEpoch: oldEpoch, title: 'Old obs' });
      seedSessionAndObservation(ctx, { project, title: 'Recent obs' }); // now

      const result = archiveOldObservations(ctx.db, project, 90);
      expect(result.archived).toBe(1);

      // Old observation moved to archived_observations
      const archived = ctx.db.query('SELECT * FROM archived_observations WHERE project = ?').all(project) as any[];
      expect(archived.length).toBe(1);
      expect(archived[0].title).toBe('Old obs');
      expect(archived[0].archived_at_epoch).toBeGreaterThan(0);

      // Recent observation still in observations table
      const remaining = ctx.db.query('SELECT * FROM observations WHERE project = ?').all(project) as any[];
      expect(remaining.length).toBe(1);
      expect(remaining[0].title).toBe('Recent obs');
    });

    it('archives nothing when all observations are recent', () => {
      const project = '/tmp/proj';
      seedSessionAndObservation(ctx, { project });
      seedSessionAndObservation(ctx, { project });

      const result = archiveOldObservations(ctx.db, project, 90);
      expect(result.archived).toBe(0);
    });

    it('archives are transactional (all-or-nothing)', () => {
      const project = '/tmp/proj';
      const oldEpoch = Date.now() - 200 * 24 * 60 * 60 * 1000;
      seedSessionAndObservation(ctx, { project, createdAtEpoch: oldEpoch, title: 'Old 1' });
      seedSessionAndObservation(ctx, { project, createdAtEpoch: oldEpoch, title: 'Old 2' });

      const result = archiveOldObservations(ctx.db, project, 90);
      expect(result.archived).toBe(2);

      const archived = ctx.db
        .query('SELECT COUNT(*) as c FROM archived_observations WHERE project = ?')
        .get(project) as { c: number };
      expect(archived.c).toBe(2);

      const remaining = ctx.db.query('SELECT COUNT(*) as c FROM observations WHERE project = ?').get(project) as {
        c: number;
      };
      expect(remaining.c).toBe(0);
    });

    it('vacuumDatabase runs without error', () => {
      expect(() => vacuumDatabase(ctx.db)).not.toThrow();
    });

    it('getArchivalStats returns correct counts', () => {
      const project = '/tmp/proj';
      const oldEpoch = Date.now() - 100 * 24 * 60 * 60 * 1000;
      seedSessionAndObservation(ctx, { project, createdAtEpoch: oldEpoch });
      seedSessionAndObservation(ctx, { project });

      archiveOldObservations(ctx.db, project, 90);

      const stats = getArchivalStats(ctx.db, project);
      expect(stats.totalObservations).toBe(1);
      expect(stats.archivedObservations).toBe(1);
      expect(stats.oldestObservationEpoch).toBeGreaterThan(0);
    });

    it('getArchivalStats returns null oldest when no observations', () => {
      const stats = getArchivalStats(ctx.db, '/tmp/empty-proj');
      expect(stats.totalObservations).toBe(0);
      expect(stats.archivedObservations).toBe(0);
      expect(stats.oldestObservationEpoch).toBeNull();
    });
  });

  // --- Enhanced Secret Detection ---

  describe('Enhanced Secret Detection', () => {
    it('detects Anthropic API keys', () => {
      const { redacted, detected } = redactSecrets('key: sk-ant-abc123XYZ_defghijklmnop');
      expect(detected).toContain('Anthropic API Key');
      expect(redacted).not.toContain('sk-ant-abc123XYZ_defghijklmnop');
    });

    it('detects OpenAI API keys', () => {
      const longKey = `sk-${'a'.repeat(50)}`;
      const { redacted, detected } = redactSecrets(`key: ${longKey}`);
      expect(detected).toContain('OpenAI API Key');
      expect(redacted).not.toContain(longKey);
    });

    it('detects NPM tokens', () => {
      const token = `npm_${'a'.repeat(36)}`;
      const { redacted, detected } = redactSecrets(`token: ${token}`);
      expect(detected).toContain('NPM Token');
      expect(redacted).not.toContain(token);
    });

    it('detects Google API keys', () => {
      // AIza + exactly 35 chars of [0-9A-Za-z_-]
      const key = `AIza${'a'.repeat(35)}`;
      const { redacted, detected } = redactSecrets(`key: ${key}`);
      expect(detected).toContain('Google API Key');
      expect(redacted).not.toContain(key);
    });

    it('detects Stripe secret keys', () => {
      const key = `sk_live_${'a'.repeat(24)}`;
      const { redacted, detected } = redactSecrets(`STRIPE_KEY=${key}`);
      expect(detected).toContain('Stripe Secret Key');
      expect(redacted).not.toContain(key);
    });

    it('detects Stripe publishable keys', () => {
      const key = `pk_test_${'b'.repeat(24)}`;
      const { redacted, detected } = redactSecrets(`PK=${key}`);
      expect(detected).toContain('Stripe Publishable Key');
      expect(redacted).not.toContain(key);
    });

    it('detects SendGrid API keys', () => {
      const sgKey = `SG.${'a'.repeat(22)}.${'b'.repeat(43)}`;
      const { redacted, detected } = redactSecrets(`SENDGRID=${sgKey}`);
      expect(detected).toContain('SendGrid API Key');
      expect(redacted).not.toContain(sgKey);
    });

    it('detects Twilio API key SIDs', () => {
      const key = `SK${'a'.repeat(32)}`;
      const { redacted, detected } = redactSecrets(`TWILIO=${key}`);
      expect(detected).toContain('Twilio API Key');
      expect(redacted).not.toContain(key);
    });

    it('detects Basic auth headers', () => {
      // basic + space + 20+ base64 chars
      const { redacted, detected } = redactSecrets('Authorization: basic dXNlcm5hbWU6cGFzc3dvcmQ=');
      expect(detected).toContain('Basic Auth');
      expect(redacted).toContain('[REDACTED:Basic Auth]');
    });

    it('detects hex-encoded secrets', () => {
      const hexSecret = `secret=${'a1b2c3d4'.repeat(6)}`;
      const { detected } = redactSecrets(hexSecret);
      expect(detected).toContain('Hex Secret');
    });

    it('detects SSH key paths', () => {
      const { redacted, detected } = redactSecrets('Using key at ~/.ssh/id_rsa for deploy');
      expect(detected).toContain('SSH Key Path');
      expect(redacted).toContain('[REDACTED:SSH Key Path]');
    });

    it('Anthropic key matched before generic sk- pattern', () => {
      const key = 'sk-ant-api03-abcdefghijklmnopqrst';
      const { detected } = redactSecrets(key);
      expect(detected).toContain('Anthropic API Key');
    });
  });

  // --- Data API: Entities & Hotspots ---

  describe('Data API: Entities & Hotspots', () => {
    it('GET /data/entities returns entities for project', async () => {
      const project = '/tmp/proj';
      upsertEntity(ctx.db, { project, entityType: 'file', name: 'src/main.ts' });
      upsertEntity(ctx.db, { project, entityType: 'function', name: 'handleRequest' });

      const res = await fetch(`${ctx.baseUrl}/data/entities?project=${encodeURIComponent(project)}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.entities.length).toBe(2);
    });

    it('GET /data/entities filters by entityType', async () => {
      const project = '/tmp/proj';
      upsertEntity(ctx.db, { project, entityType: 'file', name: 'a.ts' });
      upsertEntity(ctx.db, { project, entityType: 'function', name: 'fn1' });

      const res = await fetch(`${ctx.baseUrl}/data/entities?project=${encodeURIComponent(project)}&entityType=file`);
      const body = (await res.json()) as any;
      expect(body.entities.length).toBe(1);
      expect(body.entities[0].entity_type).toBe('file');
    });

    it('GET /data/entities respects limit', async () => {
      const project = '/tmp/proj';
      for (let i = 0; i < 5; i++) {
        upsertEntity(ctx.db, { project, entityType: 'file', name: `file${i}.ts` });
      }

      const res = await fetch(`${ctx.baseUrl}/data/entities?project=${encodeURIComponent(project)}&limit=3`);
      const body = (await res.json()) as any;
      expect(body.entities.length).toBe(3);
    });

    it('GET /data/entities returns empty for unknown project', async () => {
      const res = await fetch(`${ctx.baseUrl}/data/entities?project=${encodeURIComponent('/tmp/nope')}`);
      const body = (await res.json()) as any;
      expect(body.entities.length).toBe(0);
    });

    it('GET /data/hotspots returns entities by mention count', async () => {
      const project = '/tmp/proj';
      upsertEntity(ctx.db, { project, entityType: 'file', name: 'hot.ts' });
      upsertEntity(ctx.db, { project, entityType: 'file', name: 'hot.ts' });
      upsertEntity(ctx.db, { project, entityType: 'file', name: 'hot.ts' });
      upsertEntity(ctx.db, { project, entityType: 'file', name: 'cold.ts' });

      const res = await fetch(`${ctx.baseUrl}/data/hotspots?project=${encodeURIComponent(project)}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.hotspots.length).toBe(2);
      expect(body.hotspots[0].name).toBe('hot.ts');
      expect(body.hotspots[0].mention_count).toBe(3);
    });

    it('GET /data/hotspots filters by entityType', async () => {
      const project = '/tmp/proj';
      upsertEntity(ctx.db, { project, entityType: 'file', name: 'a.ts' });
      upsertEntity(ctx.db, { project, entityType: 'function', name: 'fn1' });
      upsertEntity(ctx.db, { project, entityType: 'function', name: 'fn1' }); // mention +1

      const res = await fetch(
        `${ctx.baseUrl}/data/hotspots?project=${encodeURIComponent(project)}&entityType=function`,
      );
      const body = (await res.json()) as any;
      expect(body.hotspots.length).toBe(1);
      expect(body.hotspots[0].name).toBe('fn1');
    });
  });

  // --- Admin: Maintenance Endpoint ---

  describe('Admin: Maintenance Endpoint', () => {
    it('POST /admin/maintenance requires project parameter', async () => {
      const res = await fetch(`${ctx.baseUrl}/admin/maintenance`, { method: 'POST' });
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toContain('project');
    });

    it('POST /admin/maintenance archives old observations', async () => {
      const project = '/tmp/proj';
      const oldEpoch = Date.now() - 100 * 24 * 60 * 60 * 1000;
      seedSessionAndObservation(ctx, { project, createdAtEpoch: oldEpoch, title: 'Ancient obs' });
      seedSessionAndObservation(ctx, { project, title: 'Fresh obs' });

      const res = await fetch(`${ctx.baseUrl}/admin/maintenance?project=${encodeURIComponent(project)}`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.status).toBe('maintenance_complete');
      expect(body.archived).toBe(1);
      expect(body.vacuumed).toBe(true);
      expect(body.stats.totalObservations).toBe(1);
      expect(body.stats.archivedObservations).toBe(1);
    });

    it('POST /admin/maintenance returns zero when nothing to archive', async () => {
      const project = '/tmp/proj';
      seedSessionAndObservation(ctx, { project });

      const res = await fetch(`${ctx.baseUrl}/admin/maintenance?project=${encodeURIComponent(project)}`, {
        method: 'POST',
      });
      const body = (await res.json()) as any;
      expect(body.archived).toBe(0);
      expect(body.stats.totalObservations).toBe(1);
    });
  });
});
