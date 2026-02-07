import { mkdirSync } from 'fs';
import { SMRITI_DIR } from '../../shared/paths.js';
import { getDatabase } from '../sqlite/database.js';
import { logger } from '../../utils/logger.js';
import { startMcpServer } from './mcp-server.js';

/**
 * MCP entry point.
 *
 * Initialises the SQLite database (with migrations) and starts the
 * lightweight MCP stdio server. Used when the worker is invoked with
 * the `mcp` subcommand.
 */
export async function runMcpMode(): Promise<void> {
  logger.info('MCP', 'Initialising Smriti MCP mode');

  // Ensure data directory exists
  mkdirSync(SMRITI_DIR, { recursive: true });

  // Open (and migrate) the database — same singleton used elsewhere
  const db = getDatabase();

  // Run the stdio server — this blocks until stdin is closed
  await startMcpServer(db);

  logger.info('MCP', 'MCP server exiting');
}
