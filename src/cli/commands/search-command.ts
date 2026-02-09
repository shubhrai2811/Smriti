import { checkHealth, getWorkerPort } from '../../infrastructure/process-manager.js';

export async function searchCommand(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: smriti search "query text" [--project name] [--limit N]');
    process.exit(1);
  }

  // Parse optional flags, collect remaining words as query
  let project = '';
  let limit = 10;
  const queryParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) {
      project = args[++i];
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else {
      queryParts.push(args[i]);
    }
  }

  const query = queryParts.join(' ');
  if (!query) {
    console.error('Usage: smriti search "query text" [--project name] [--limit N]');
    process.exit(1);
  }

  const port = getWorkerPort();
  if (!port || !(await checkHealth(port, 3000))) {
    console.error('Smriti worker is not running. Start it with: smriti start');
    process.exit(1);
  }

  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (project) params.set('project', project);

  try {
    const res = await fetch(`http://127.0.0.1:${port}/data/search?${params}`);
    if (!res.ok) {
      console.error(`Search failed: ${res.status}`);
      process.exit(1);
    }
    const results = (await res.json()) as Array<{
      id: number;
      type: string;
      title: string;
      importance: number;
      facts: string;
      project: string;
    }>;
    if (results.length === 0) {
      console.log('No results found.');
    } else {
      console.log(`Found ${results.length} result(s):\n`);
      for (const obs of results) {
        const facts = JSON.parse(obs.facts || '[]') as string[];
        console.log(`  [${obs.type}] ${obs.title} (importance: ${obs.importance})`);
        if (facts.length > 0) {
          console.log(`    ${facts.slice(0, 3).join('; ')}`);
        }
        console.log();
      }
    }
  } catch (error) {
    console.error(`Failed to connect to worker: ${(error as Error).message}`);
    process.exit(1);
  }
}
