import { basename } from 'path';

/**
 * Gets the current git branch for the given working directory.
 * Returns null if not a git repo or if the command fails.
 */
export function getCurrentBranch(cwd: string): string | null {
  try {
    const result = Bun.spawnSync(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      timeout: 2_000,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode !== 0) {
      return null;
    }

    const branch = result.stdout.toString().trim();
    return branch || null;
  } catch {
    return null;
  }
}

/**
 * Gets the project name for the given working directory.
 * For Phase 1, this simply returns the basename of the directory.
 */
export function getProjectName(cwd: string): string {
  try {
    return basename(cwd);
  } catch {
    return 'unknown';
  }
}
