import { getConfig } from '../shared/config.js';
import { logger } from '../utils/logger.js';
import { SMRITI_DIR } from '../shared/paths.js';
import {
  writePidFile,
  removePidFile,
  ensureWorkerStarted,
  getWorkerPort,
  checkHealth,
} from '../infrastructure/process-manager.js';
import { setupSignalHandlers, gracefulShutdown } from '../infrastructure/graceful-shutdown.js';
import { getDatabase } from './sqlite/database.js';
import { createApp, type WorkerState } from './server.js';
import { resetStaleProcessing } from './sqlite/pending-messages.js';
import { mkdirSync } from 'fs';

declare const __SMRITI_VERSION__: string;
const VERSION = typeof __SMRITI_VERSION__ !== 'undefined' ? __SMRITI_VERSION__ : '0.1.0-dev';

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

  // Ensure worker is running before delegating to hook handler
  const port = getWorkerPort();
  let activePort = port;

  if (!port || !(await checkHealth(port, 2000))) {
    // No running worker detected -- start one in-process
    activePort = await startInProcess();
  }

  // Set port in env so hook handlers know where to send requests
  process.env.SMRITI_WORKER_PORT = String(activePort);

  // Dynamic import to avoid loading hook system in daemon mode
  const { hookCommand: runHook } = await import('../cli/hook-command.js');
  const exitCode = await runHook(platform, event);
  process.exit(exitCode);
}

/**
 * Start an in-process Hono server (used when hook mode needs a worker
 * but none is currently running). Returns the actual port.
 */
async function startInProcess(): Promise<number> {
  const config = getConfig();
  const workerConfig = config.get('worker');
  let port = workerConfig.port;
  if (port === 0) port = 37777;

  mkdirSync(SMRITI_DIR, { recursive: true });

  const db = getDatabase();

  const state: WorkerState = {
    db,
    isReady: false,
    startTime: Date.now(),
    lastActivityAt: Date.now(),
  };

  const app = createApp(state);

  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    fetch: app.fetch,
  });

  // Background init
  resetStaleProcessing(db);
  state.isReady = true;

  return server.port!;
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
  };

  const app = createApp(state);

  // Start HTTP server
  const server = Bun.serve({
    port,
    hostname: host,
    fetch: app.fetch,
  });

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
  state.isReady = true;

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
