import { closeDatabase } from '../services/sqlite/database.js';
import { logger } from '../utils/logger.js';
import { removePidFile } from './process-manager.js';

let isShuttingDown = false;

export async function gracefulShutdown(server?: { stop: () => void }): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info('SHUTDOWN', 'Graceful shutdown initiated');

  // Stop accepting new connections
  if (server) {
    try {
      server.stop();
    } catch {
      /* ok */
    }
  }

  // Close database connection
  try {
    closeDatabase();
  } catch {
    /* ok */
  }

  // Remove PID file so new workers can start
  removePidFile();

  logger.info('SHUTDOWN', 'Shutdown complete');
  process.exit(0);
}

export function setupSignalHandlers(server?: { stop: () => void }): void {
  const handler = () => gracefulShutdown(server);
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

export function isWorkerShuttingDown(): boolean {
  return isShuttingDown;
}
