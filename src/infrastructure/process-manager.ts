import { execSync, spawn as nodeSpawn } from 'child_process';
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PID_FILE_PATH, SMRITI_DIR } from '../shared/paths.js';
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
  try {
    unlinkSync(PID_FILE_PATH);
  } catch {
    /* ok */
  }
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
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Kill any zombie process holding a port (not responding to health checks
 * but still bound to the port). Uses lsof to find the PID.
 */
function killZombieOnPort(port: number): void {
  try {
    const output = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (output) {
      const pids = output.split('\n').map((p) => p.trim()).filter(Boolean);
      for (const pid of pids) {
        try {
          process.kill(parseInt(pid, 10), 'SIGKILL');
        } catch { /* already dead */ }
      }
    }
  } catch { /* lsof not available or no process found */ }
}

export async function ensureWorkerStarted(port: number): Promise<boolean> {
  // Quick health check — worker may already be running and healthy
  if (await isPortInUse(port)) return true;

  // Port didn't respond to health check. Check if something is bound to it
  // (zombie process). If so, kill it before trying to spawn.
  killZombieOnPort(port);

  // Check PID file — another process may already be spawning the daemon.
  // If PID file exists, just wait for health instead of spawning a duplicate.
  const existingPid = readPidFile();
  if (existingPid) {
    return checkHealth(port, 15_000);
  }

  // No PID file and port is free — spawn the daemon.
  // Use a lock file to prevent concurrent spawns from parallel hooks.
  const lockPath = join(SMRITI_DIR, 'spawning.lock');
  try {
    if (existsSync(lockPath)) {
      const lockAge = Date.now() - (new Date(readFileSync(lockPath, 'utf-8').trim())).getTime();
      if (lockAge < 30_000) {
        return checkHealth(port, 30_000);
      }
    }
    writeFileSync(lockPath, new Date().toISOString());
  } catch { /* non-critical */ }

  const scriptPath = process.argv[1];
  const logDir = join(SMRITI_DIR, 'logs');
  mkdirSync(logDir, { recursive: true });

  const outFd = openSync(join(logDir, 'daemon-stdout.log'), 'a');
  const errFd = openSync(join(logDir, 'daemon-stderr.log'), 'a');

  const child = nodeSpawn(process.execPath, [scriptPath, '--daemon'], {
    detached: true,
    stdio: ['ignore', outFd, errFd],
    env: { ...process.env, SMRITI_WORKER_PORT: String(port) },
  });
  child.unref();

  const healthy = await checkHealth(port, 30_000);

  try { unlinkSync(lockPath); } catch { /* ok */ }

  if (!healthy) {
    try {
      const errLog = readFileSync(join(logDir, 'daemon-stderr.log'), 'utf-8');
      if (errLog.trim()) {
        console.error(`Daemon stderr: ${errLog.slice(-500)}`);
      }
    } catch { /* ignore */ }
  }
  return healthy;
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
