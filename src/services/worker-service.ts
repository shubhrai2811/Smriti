import type { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { gracefulShutdown, setupSignalHandlers } from '../infrastructure/graceful-shutdown.js';
import {
  ensureWorkerStarted,
  getWorkerPort,
  removePidFile,
  writePidFile,
} from '../infrastructure/process-manager.js';
import { getConfig } from '../shared/config.js';
import { SMRITI_DIR } from '../shared/paths.js';
import { logger } from '../utils/logger.js';
import { ObservationBatcher } from './extraction/batcher.js';
import { ClaudeSDKProvider } from './providers/claude-sdk.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { ProviderManager } from './providers/provider-manager.js';
import { createApp, type WorkerState } from './server.js';
import { getDatabase } from './sqlite/database.js';
import { resetStaleProcessing } from './sqlite/pending-messages.js';

declare const __SMRITI_VERSION__: string;
const VERSION = typeof __SMRITI_VERSION__ !== 'undefined' ? __SMRITI_VERSION__ : '0.1.0-dev';

/**
 * Create an ObservationBatcher with the configured AI provider.
 */
function createBatcher(db: Database): ObservationBatcher {
  const config = getConfig();
  const providerConfig = config.get('provider');

  const claude = new ClaudeSDKProvider();
  const openrouter = new OpenRouterProvider();

  const primary = providerConfig.primary === 'openrouter' ? openrouter : claude;
  const fallback = providerConfig.fallbackEnabled
    ? (providerConfig.primary === 'openrouter' ? claude : openrouter)
    : undefined;

  const manager = new ProviderManager({
    primary,
    fallback,
    failureThreshold: providerConfig.failureThreshold,
    cooldownMinutes: providerConfig.cooldownMinutes,
    db,
  });

  return new ObservationBatcher(db, manager);
}

/**
 * Drain any orphaned pending messages left from crashed hook processes.
 * Finds all sessions with pending messages and flushes them through the batcher.
 */
function drainOrphanedPending(db: Database, batcher: ObservationBatcher): void {
  const rows = db.query(
    `SELECT DISTINCT session_id FROM pending_messages WHERE status = 'pending'`,
  ).all() as Array<{ session_id: number }>;

  if (rows.length === 0) return;

  logger.info('WORKER', `Draining orphaned pending messages for ${rows.length} session(s)`);

  // Flush all pending messages for each session (non-blocking)
  for (const row of rows) {
    batcher.flush(row.session_id).catch((err) => {
      logger.debug('WORKER', `Failed to drain pending for session ${row.session_id}`, {
        error: (err as Error).message,
      });
    });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'start':
      await startCommand();
      break;
    case 'stop':
      await stopCommand();
      break;
    case 'hook':
      await hookCommand(args[1], args[2]);
      break;
    case 'mcp':
      await mcpCommand();
      break;
    case 'config': {
      const { configCommand } = await import('../cli/commands/config-command.js');
      await configCommand(args.slice(1));
      break;
    }
    case 'search': {
      const { searchCommand } = await import('../cli/commands/search-command.js');
      await searchCommand(args.slice(1));
      break;
    }
    case 'stats': {
      const { statsCommand } = await import('../cli/commands/stats-command.js');
      await statsCommand();
      break;
    }
    case '--daemon':
      await daemonCommand();
      break;
    default:
      // Default to daemon mode if no argument provided
      if (command) {
        console.error(`Unknown command: ${command}`);
        process.exit(1);
      }
      await daemonCommand();
  }
}

async function startCommand() {
  const config = getConfig();
  const workerConfig = config.get('worker');
  let port = workerConfig.port;

  if (port === 0) {
    // Use default fallback when port is auto-assign
    port = 37777;
  }

  const started = await ensureWorkerStarted(port);
  if (started) {
    console.log(JSON.stringify({ status: 'ready', port }));
  } else {
    console.error('Failed to start worker');
    process.exit(1);
  }
}

async function stopCommand() {
  const port = getWorkerPort();
  if (!port) {
    console.log('Worker not running');
    return;
  }

  try {
    await fetch(`http://127.0.0.1:${port}/admin/shutdown`, { method: 'POST' });
    console.log('Shutdown signal sent');
  } catch {
    console.log('Worker not responding, cleaning up PID file');
    removePidFile();
  }
}

async function hookCommand(platform: string, event: string) {
  if (!platform || !event) {
    console.error('Usage: worker-service hook <platform> <event>');
    process.exit(1);
  }

  const config = getConfig();
  const workerConfig = config.get('worker');
  let port = workerConfig.port;
  if (port === 0) port = 37777;

  // Ensure the persistent daemon is running (spawns if needed).
  // Hooks are pure HTTP clients — they never start their own server.
  // If the daemon can't be reached, handlers degrade gracefully.
  await ensureWorkerStarted(port);

  // Set port in env so hook handlers know where to send requests
  process.env.SMRITI_WORKER_PORT = String(port);

  // Dynamic import to avoid loading hook system in daemon mode
  const { hookCommand: runHook } = await import('../cli/hook-command.js');
  const exitCode = await runHook(platform, event);
  process.exit(exitCode);
}

/**
 * MCP mode -- starts a lightweight Model Context Protocol server
 * on stdio (JSON-RPC over stdin/stdout). Used by MCP-compatible
 * clients such as Claude Code.
 */
async function mcpCommand() {
  const { runMcpMode } = await import('./mcp/mcp-entry.js');
  await runMcpMode();
}

/**
 * Daemon mode -- the long-running worker process.
 * Creates the Hono app, starts Bun.serve, writes a PID file,
 * registers signal handlers, and sets up an idle timeout.
 */
async function daemonCommand() {
  // Catch uncaught exceptions/rejections and log them before dying
  process.on('uncaughtException', (err) => {
    logger.error('WORKER', `Uncaught exception: ${err.message}`, { stack: err.stack });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    logger.error('WORKER', `Unhandled rejection: ${msg}`, { stack });
  });

  const config = getConfig();
  const workerConfig = config.get('worker');
  let port = workerConfig.port;
  if (port === 0) port = 37777;
  const host = workerConfig.host;
  const idleMinutes = workerConfig.idleTimeoutMinutes;

  mkdirSync(SMRITI_DIR, { recursive: true });

  // Initialize database (runs migrations on first use)
  const db = getDatabase();

  const state: WorkerState = {
    db,
    isReady: false,
    startTime: Date.now(),
    lastActivityAt: Date.now(),
    sseClients: new Set(),
  };

  const app = createApp(state);

  // Start HTTP server
  const server = Bun.serve({
    port,
    hostname: host,
    fetch: app.fetch,
  });

  // biome-ignore lint/style/noNonNullAssertion: port is always set after server starts
  const actualPort = server.port!;

  // Write PID file so other processes can discover us
  writePidFile({
    pid: process.pid,
    port: actualPort,
    startedAt: new Date().toISOString(),
    version: VERSION,
  });

  // Persist actual port if it was auto-assigned
  if (workerConfig.port === 0) {
    config.set('worker', 'port', actualPort);
  }

  // Setup graceful shutdown on SIGTERM / SIGINT
  setupSignalHandlers(server);

  // Reset any stale "processing" messages from a previous crash
  resetStaleProcessing(db);

  // Create and wire the observation batcher
  const batcher = createBatcher(db);
  batcher.setWorkerState(state);
  state.batcher = batcher;

  state.isReady = true;

  // Background: warm up embedding model (non-blocking)
  import('./embeddings/embedding-service.js').then(({ initEmbeddings }) => {
    initEmbeddings().catch((err) => {
      logger.warn('WORKER', 'Embedding warm-up failed (will retry on first use)', { error: (err as Error).message });
    });
  });

  // Drain any orphaned pending messages from previous hook processes
  drainOrphanedPending(db, batcher);

  logger.info('WORKER', `Smriti worker v${VERSION} listening on ${host}:${actualPort}`);

  // Idle timeout -- shut down if no requests received within the configured window
  if (idleMinutes > 0) {
    const idleMs = idleMinutes * 60 * 1000;
    setInterval(() => {
      const idleTime = Date.now() - state.lastActivityAt;
      if (idleTime > idleMs) {
        logger.info('WORKER', 'Idle timeout reached, shutting down');
        gracefulShutdown(server);
      }
    }, 60_000); // Check every minute
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
