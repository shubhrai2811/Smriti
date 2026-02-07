import type { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';
import { hybridSearch, type ScoredObservation } from '../context/search.js';
import { insertObservation, getRecentObservations } from '../sqlite/observations.js';
import { createSession } from '../sqlite/sessions.js';
import { basename } from 'path';

// ---------------------------------------------------------------------------
// JSON-RPC Types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ---------------------------------------------------------------------------
// MCP Tool Definitions
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    name: 'smriti_search',
    description: 'Search Smriti memory for relevant observations',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query text' },
        project: { type: 'string', description: 'Project name (defaults to CWD basename)' },
        limit: { type: 'number', description: 'Max results to return (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'smriti_save',
    description: 'Manually save a memory/observation to Smriti',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Observation title' },
        facts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of fact strings',
        },
        type: {
          type: 'string',
          description: 'Observation type (bugfix, feature, refactor, discovery, decision, pattern, config, dependency)',
        },
        project: { type: 'string', description: 'Project name (defaults to CWD basename)' },
        importance: { type: 'number', description: 'Importance score 1-10 (default 5)' },
        concepts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Concept tags for categorization',
        },
        files_affected: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths affected by this observation',
        },
      },
      required: ['title', 'facts'],
    },
  },
  {
    name: 'smriti_timeline',
    description: 'Get recent observation timeline for a project',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (defaults to CWD basename)' },
        limit: { type: 'number', description: 'Max results to return (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'smriti_forget',
    description: 'Delete a specific observation by ID',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Observation ID to delete' },
      },
      required: ['id'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool Handlers
// ---------------------------------------------------------------------------

function defaultProject(): string {
  return basename(process.cwd());
}

function handleSearch(
  db: Database,
  args: Record<string, unknown>,
): unknown {
  const query = args.query as string;
  const project = (args.project as string) || defaultProject();
  const limit = (args.limit as number) || 10;

  const results: ScoredObservation[] = hybridSearch(db, {
    project,
    queryText: query,
    limit,
  });

  return results.map((r) => ({
    id: r.observation.id,
    title: r.observation.title,
    type: r.observation.type,
    facts: r.observation.facts ? JSON.parse(r.observation.facts) : [],
    importance: r.observation.importance,
    score: Math.round(r.score * 1000) / 1000,
    createdAt: r.observation.created_at,
  }));
}

function handleSave(
  db: Database,
  args: Record<string, unknown>,
): unknown {
  const title = args.title as string;
  const facts = args.facts as string[];
  const type = (args.type as string) || 'discovery';
  const project = (args.project as string) || defaultProject();
  const importance = (args.importance as number) || 5;
  const concepts = args.concepts as string[] | undefined;
  const filesAffected = args.files_affected as string[] | undefined;

  // Create or reuse an MCP session
  const contentSessionId = `mcp-${Date.now()}`;
  const session = createSession(db, {
    contentSessionId,
    project,
    sourceIde: 'mcp',
  });

  const id = insertObservation(db, {
    sessionId: session.id,
    project,
    sourceIde: 'mcp',
    type: type as import('../../shared/types.js').ObservationType,
    title,
    facts: JSON.stringify(facts),
    importance,
    concepts: concepts ? JSON.stringify(concepts) : undefined,
    filesAffected: filesAffected ? JSON.stringify(filesAffected) : undefined,
  });

  return { id, saved: true };
}

function handleTimeline(
  db: Database,
  args: Record<string, unknown>,
): unknown {
  const project = (args.project as string) || defaultProject();
  const limit = (args.limit as number) || 20;

  const rows = getRecentObservations(db, project, { limit });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    facts: r.facts ? JSON.parse(r.facts) : [],
    importance: r.importance,
    createdAt: r.created_at,
  }));
}

function handleForget(
  db: Database,
  args: Record<string, unknown>,
): unknown {
  const id = args.id as number;

  db.run('DELETE FROM observations WHERE id = ?', [id]);

  return { deleted: true };
}

// ---------------------------------------------------------------------------
// JSON-RPC Dispatch
// ---------------------------------------------------------------------------

function makeResponse(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function makeError(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

function handleRequest(db: Database, req: JsonRpcRequest): JsonRpcResponse | null {
  const { method, id, params } = req;

  logger.debug('MCP', `Received method: ${method}`, { id: id ?? undefined });

  switch (method) {
    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------
    case 'initialize':
      return makeResponse(id ?? null, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'smriti', version: '0.1.0' },
      });

    case 'notifications/initialized':
      // Notification — no response
      return null;

    // -----------------------------------------------------------------------
    // Tools
    // -----------------------------------------------------------------------
    case 'tools/list':
      return makeResponse(id ?? null, { tools: TOOL_DEFINITIONS });

    case 'tools/call': {
      const toolName = (params?.name as string) ?? '';
      const toolArgs = (params?.arguments as Record<string, unknown>) ?? {};

      try {
        let result: unknown;

        switch (toolName) {
          case 'smriti_search':
            result = handleSearch(db, toolArgs);
            break;
          case 'smriti_save':
            result = handleSave(db, toolArgs);
            break;
          case 'smriti_timeline':
            result = handleTimeline(db, toolArgs);
            break;
          case 'smriti_forget':
            result = handleForget(db, toolArgs);
            break;
          default:
            return makeError(id ?? null, -32602, `Unknown tool: ${toolName}`);
        }

        return makeResponse(id ?? null, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('MCP', `Tool error in ${toolName}`, { error: message });
        return makeResponse(id ?? null, {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        });
      }
    }

    // -----------------------------------------------------------------------
    // Unknown
    // -----------------------------------------------------------------------
    default:
      // For notifications (no id), silently ignore
      if (id === undefined || id === null) return null;
      return makeError(id, -32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Stdio Transport
// ---------------------------------------------------------------------------

/**
 * Start the MCP stdio server.
 * Reads newline-delimited JSON-RPC from stdin, writes responses to stdout.
 * Logs go to stderr (via the logger) so they don't interfere with the protocol.
 */
export async function startMcpServer(db: Database): Promise<void> {
  logger.info('MCP', 'Starting Smriti MCP stdio server');

  const decoder = new TextDecoder();
  let buffer = '';

  const reader = Bun.stdin.stream().getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        logger.info('MCP', 'stdin closed, shutting down');
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process all complete lines in the buffer
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line) continue;

        let request: JsonRpcRequest;
        try {
          request = JSON.parse(line) as JsonRpcRequest;
        } catch {
          // Invalid JSON — send parse error
          const errResp = makeError(null, -32700, 'Parse error');
          writeResponse(errResp);
          continue;
        }

        const response = handleRequest(db, request);
        if (response !== null) {
          writeResponse(response);
        }
      }
    }
  } catch (err) {
    logger.error('MCP', 'Fatal read error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function writeResponse(response: JsonRpcResponse): void {
  const json = JSON.stringify(response);
  process.stdout.write(json + '\n');
}
