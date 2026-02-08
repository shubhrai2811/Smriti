import { getWorkerPort, checkHealth } from '../../infrastructure/process-manager.js';

export async function searchCommand(args: string[]): Promise<void> {
  const query = args[0];
  if (!query) {
    console.error('Usage: smriti search "query text" [--project name] [--limit N]');
    process.exit(1);
  }

  // Parse optional flags
  let project = '';
  let limit = 10;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) {
      project = args[++i];
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    }
  }

  const port = getWorkerPort();
  if (!port || !(await checkHealth(port, 3000))) {
    console.error('Smriti worker is not running. Start it with: smriti start');
    process.exit(1);
  }

  const params = new URLSearchParams({ prompt: query, limit: String(limit) });
  if (project) params.set('project', project);

  try {
    const res = await fetch(`http://127.0.0.1:${port}/context/inject?${params}`);
    if (!res.ok) {
      console.error(`Search failed: ${res.status}`);
      process.exit(1);
    }
    const text = await res.text();
    if (!text || text.trim() === '') {
      console.log('No results found.');
    } else {
      console.log(text);
    }
  } catch (error) {
    console.error(`Failed to connect to worker: ${(error as Error).message}`);
    process.exit(1);
  }
}
