import { getWorkerPort, checkHealth } from '../../infrastructure/process-manager.js';

export async function statsCommand(): Promise<void> {
  const port = getWorkerPort();
  if (!port || !(await checkHealth(port, 3000))) {
    console.error('Smriti worker is not running. Start it with: smriti start');
    process.exit(1);
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/data/stats`);
    if (!res.ok) {
      console.error(`Stats failed: ${res.status}`);
      process.exit(1);
    }
    const data = await res.json() as Record<string, unknown>;

    console.log('\n  Smriti Stats');
    console.log('  ' + '-'.repeat(40));

    for (const [key, value] of Object.entries(data)) {
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
      const display = typeof value === 'object' ? JSON.stringify(value) : String(value);
      console.log(`  ${label.padEnd(25)} ${display}`);
    }
    console.log();
  } catch (error) {
    console.error(`Failed to connect to worker: ${(error as Error).message}`);
    process.exit(1);
  }
}
