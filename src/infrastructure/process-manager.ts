import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { PID_FILE_PATH, SMRITI_DIR } from '../shared/paths.js';
import { logger } from '../utils/logger.js';
import type { PidInfo } from '../shared/types.js';

export function writePidFile(info: PidInfo): void {
  mkdirSync(SMRITI_DIR, { recursive: true });
  writeFileSync(PID_FILE_PATH, JSON.stringify(info, null, 2));
}

export function readPidFile(): PidInfo | null {
  if (!existsSync(PID_FILE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(PID_FILE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export function removePidFile(): void {
  try { unlinkSync(PID_FILE_PATH); } catch { /* ok */ }
}

export async function isPortInUse(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function checkHealth(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return true;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

export async function ensureWorkerStarted(port: number): Promise<boolean> {
  // Quick health check — worker may already be running
  if (await isPortInUse(port)) return true;

  // Spawn daemon as a detached child process
  const scriptPath = process.argv[1];
  const child = Bun.spawn({
    cmd: [process.execPath, scriptPath, '--daemon'],
    env: { ...process.env, SMRITI_WORKER_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  child.unref();

  // Wait for the daemon to become healthy
  return checkHealth(port, 30_000);
}

export function getWorkerPort(): number {
  const pidInfo = readPidFile();
  if (pidInfo) return pidInfo.port;

  // Check environment variable
  const envPort = process.env.SMRITI_WORKER_PORT;
  if (envPort) return parseInt(envPort, 10);

  // Try loading from config
  try {
    const { getConfig } = require('../shared/config.js');
    const config = getConfig();
    return config.get('worker', 'port');
  } catch {
    return 0;
  }
}
