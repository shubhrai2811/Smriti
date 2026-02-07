/**
 * Smriti plugin for OpenCode.
 *
 * Registers event listeners and custom tools that communicate with
 * the Smriti worker over HTTP — reusing all existing infrastructure.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PID_FILE = join(homedir(), '.smriti', 'worker.pid');

function getWorkerPort(): number {
  try {
    const info = JSON.parse(readFileSync(PID_FILE, 'utf-8'));
    return info.port;
  } catch {
    return 0;
  }
}

async function workerFetch(path: string, opts?: RequestInit): Promise<Response | null> {
  const port = getWorkerPort();
  if (!port) return null;
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      ...opts,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }
}

export function registerSmritiPlugin(app: any) {
  // 1. Session create — initialize Smriti session
  app.on('session.create', async (event: any) => {
    const project = event.project || event.cwd || process.cwd();
    const prompt = event.prompt || '';

    await workerFetch('/sessions/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentSessionId: event.sessionId || `opencode-${Date.now()}`,
        project,
        prompt,
        sourceIde: 'opencode',
      }),
    });
  });

  // 2. Tool execution — capture observations
  app.on('tool.execute.after', async (event: any) => {
    const sessionId = event.sessionId || '';
    if (!sessionId) return;

    await workerFetch(`/sessions/${encodeURIComponent(sessionId)}/observe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentSessionId: sessionId,
        toolName: event.toolName || event.tool,
        toolInput: typeof event.input === 'string' ? event.input : JSON.stringify(event.input || ''),
        toolResponse: typeof event.output === 'string' ? event.output : JSON.stringify(event.output || ''),
        cwd: event.cwd || process.cwd(),
      }),
    });
  });

  // 3. Session complete — summarize + complete
  app.on('session.complete', async (event: any) => {
    const sessionId = event.sessionId || '';
    if (!sessionId) return;

    // Trigger summarize
    await workerFetch(`/sessions/${encodeURIComponent(sessionId)}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentSessionId: sessionId,
        lastAssistantMessage: event.lastMessage || '',
      }),
    });

    // Mark complete
    await workerFetch(`/sessions/${encodeURIComponent(sessionId)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentSessionId: sessionId }),
    });
  });

  // 4. System prompt transform — inject memory context
  if (typeof app.on === 'function') {
    app.on('experimental.chat.system.transform', async (event: any) => {
      const project = event.project || event.cwd || process.cwd();
      const prompt = event.prompt || '';

      const res = await workerFetch(
        `/context/inject?project=${encodeURIComponent(project)}&prompt=${encodeURIComponent(prompt)}&sourceIde=opencode`,
      );

      if (res && res.ok) {
        const context = await res.text();
        if (context) {
          return { systemPrompt: (event.systemPrompt || '') + '\n\n' + context };
        }
      }
      return undefined;
    });
  }

  // 5. Custom tool: smriti_search
  if (typeof app.tool === 'function') {
    app.tool('smriti_search', {
      description: 'Search Smriti memory for relevant observations',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query text' },
          project: { type: 'string', description: 'Project name' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    }, async (args: any) => {
      const project = args.project || process.cwd();
      const limit = args.limit || 10;

      const res = await workerFetch(
        `/context/inject?project=${encodeURIComponent(project)}&prompt=${encodeURIComponent(args.query)}&sourceIde=opencode`,
      );

      if (res && res.ok) {
        return await res.text();
      }
      return 'Smriti worker not available';
    });
  }
}
