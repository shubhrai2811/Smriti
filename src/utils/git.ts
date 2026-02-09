import { existsSync, readFileSync, statSync } from 'fs';
import { basename, dirname, join } from 'path';

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
 * Result of project name detection, including the source of the detection.
 */
export interface ProjectIdentifier {
  /** Canonical project name (e.g., "smriti") */
  name: string;
  /** How it was detected: "package.json", "Cargo.toml", "go.mod", "pyproject.toml", "git-remote", or "basename" */
  source: string;
  /** The original cwd used for detection */
  fullPath: string;
}

/**
 * Attempt to detect project name from package.json.
 */
function detectFromPackageJson(cwd: string): string | null {
  try {
    const pkgPath = join(cwd, 'package.json');
    if (!existsSync(pkgPath)) return null;
    const content = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    if (typeof pkg.name === 'string' && pkg.name.trim().length > 0) {
      return pkg.name.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Attempt to detect project name from Cargo.toml.
 */
function detectFromCargoToml(cwd: string): string | null {
  try {
    const cargoPath = join(cwd, 'Cargo.toml');
    if (!existsSync(cargoPath)) return null;
    const content = readFileSync(cargoPath, 'utf-8');
    const match = content.match(/\[package\][\s\S]*?name\s*=\s*"([^"]+)"/);
    if (match?.[1]) {
      return match[1].trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Attempt to detect project name from go.mod (last path segment of module path).
 */
function detectFromGoMod(cwd: string): string | null {
  try {
    const goModPath = join(cwd, 'go.mod');
    if (!existsSync(goModPath)) return null;
    const content = readFileSync(goModPath, 'utf-8');
    const match = content.match(/^module\s+(.+)$/m);
    if (match?.[1]) {
      const modulePath = match[1].trim();
      const segments = modulePath.split('/');
      // Use org/repo for hosted modules (e.g., "github.com/org/repo" -> "org/repo")
      // Use full path for short modules (e.g., "myapp" -> "myapp")
      if (segments.length >= 3) {
        return segments.slice(-2).join('/');
      }
      const lastSegment = segments[segments.length - 1];
      if (lastSegment && lastSegment.length > 0) {
        return lastSegment;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Attempt to detect project name from pyproject.toml.
 * Checks [project] section first, then [tool.poetry] section.
 */
function detectFromPyprojectToml(cwd: string): string | null {
  try {
    const pyprojectPath = join(cwd, 'pyproject.toml');
    if (!existsSync(pyprojectPath)) return null;
    const content = readFileSync(pyprojectPath, 'utf-8');

    // Try [project] section first
    const projectMatch = content.match(/\[project\][\s\S]*?name\s*=\s*"([^"]+)"/);
    if (projectMatch?.[1]) {
      return projectMatch[1].trim();
    }

    // Try [tool.poetry] section
    const poetryMatch = content.match(/\[tool\.poetry\][\s\S]*?name\s*=\s*"([^"]+)"/);
    if (poetryMatch?.[1]) {
      return poetryMatch[1].trim();
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Attempt to detect project name from git remote origin URL.
 * Parses org/repo from HTTPS and SSH-style remote URLs.
 */
function detectFromGitRemote(cwd: string): string | null {
  try {
    const result = Bun.spawnSync(['git', 'config', '--get', 'remote.origin.url'], {
      cwd,
      timeout: 2_000,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode !== 0) return null;

    const url = result.stdout.toString().trim();
    if (!url) return null;

    // Try SSH format: git@github.com:org/repo.git
    const sshMatch = url.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
    if (sshMatch?.[1]) {
      return sshMatch[1];
    }

    // Try HTTPS format: https://github.com/org/repo.git or https://github.com/org/repo
    const httpsMatch = url.match(/^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
    if (httpsMatch?.[1]) {
      return httpsMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

/** Common folder names that are too generic to use as project identifiers alone */
const GENERIC_NAMES = new Set([
  'api',
  'app',
  'web',
  'backend',
  'frontend',
  'server',
  'client',
  'service',
  'services',
  'lib',
  'core',
  'src',
  'pkg',
  'cmd',
  'modules',
  'packages',
  'workspace',
  'monorepo',
  'project',
]);

type DetectionSource = 'package.json' | 'Cargo.toml' | 'go.mod' | 'pyproject.toml' | 'git-remote' | 'basename';

/**
 * Build a unique-enough project name from the directory path.
 * For generic folder names (api, backend, etc.), includes the parent directory
 * to disambiguate: "/work/client-a/api" → "client-a/api" instead of just "api".
 */
function buildBasenameFallback(cwd: string): string {
  const name = basename(cwd);
  if (!name) return 'unknown';

  // If the name is generic, prefix with parent dir for uniqueness
  if (GENERIC_NAMES.has(name.toLowerCase())) {
    const parent = basename(dirname(cwd));
    if (parent && parent !== '.' && parent !== '/') {
      return `${parent}/${name}`;
    }
  }

  return name;
}

/**
 * Internal detection pipeline. Returns the name and which source detected it.
 */
function detectProject(cwd: string): { name: string; source: DetectionSource } {
  const detectors: Array<{ fn: (cwd: string) => string | null; source: DetectionSource }> = [
    { fn: detectFromPackageJson, source: 'package.json' },
    { fn: detectFromCargoToml, source: 'Cargo.toml' },
    { fn: detectFromGoMod, source: 'go.mod' },
    { fn: detectFromPyprojectToml, source: 'pyproject.toml' },
    { fn: detectFromGitRemote, source: 'git-remote' },
  ];

  for (const { fn, source } of detectors) {
    const name = fn(cwd);
    if (name) {
      return { name, source };
    }
  }

  return { name: buildBasenameFallback(cwd), source: 'basename' };
}

/**
 * Gets the project name for the given working directory.
 * Tries project manifests (package.json, Cargo.toml, go.mod, pyproject.toml),
 * then git remote URL, and falls back to the directory basename.
 */
export function getProjectName(cwd: string): string {
  try {
    return detectProject(cwd).name;
  } catch {
    return 'unknown';
  }
}

/**
 * Gets a rich project identifier including the name, detection source, and full path.
 * Useful for the web UI to show how the project was identified.
 */
export function getProjectIdentifier(cwd: string): ProjectIdentifier {
  try {
    const { name, source } = detectProject(cwd);
    return { name, source, fullPath: cwd };
  } catch {
    return { name: 'unknown', source: 'basename', fullPath: cwd };
  }
}

/**
 * Detect if the given directory is a git worktree (not the main repo).
 * Worktrees have a `.git` file (not directory) pointing to the main repo's
 * `.git/worktrees/` directory.
 */
export function isWorktree(cwd: string): boolean {
  try {
    // Find the git toplevel first
    const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
      cwd,
      timeout: 2_000,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode !== 0) {
      return false;
    }

    const toplevel = result.stdout.toString().trim();
    if (!toplevel) return false;

    const gitPath = join(toplevel, '.git');
    const stat = statSync(gitPath);

    // If .git is a file (not a directory), it's a worktree
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Get the main repository root for a worktree.
 * If not a worktree, returns the git toplevel or cwd itself.
 * Reads the .git file to find the main repo's .git directory.
 */
export function getWorktreeMainRoot(cwd: string): string {
  try {
    // Get the toplevel of the current working tree
    const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
      cwd,
      timeout: 2_000,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode !== 0) {
      return cwd;
    }

    const toplevel = result.stdout.toString().trim();
    if (!toplevel) return cwd;

    const gitPath = join(toplevel, '.git');
    let stat: ReturnType<typeof statSync> | undefined;
    try {
      stat = statSync(gitPath);
    } catch {
      return toplevel;
    }

    // If .git is a directory, this is the main repo
    if (stat.isDirectory()) {
      return toplevel;
    }

    // If .git is a file, it's a worktree — read to find the main repo
    // File content is like: "gitdir: /path/to/main/.git/worktrees/branch-name"
    const content = readFileSync(gitPath, 'utf-8').trim();
    const match = content.match(/^gitdir:\s*(.+)$/);
    if (!match) return toplevel;

    const gitdir = match[1];
    // The gitdir points to something like /path/to/main/.git/worktrees/branch-name
    // We need to go up past "worktrees/branch-name" to get the .git dir,
    // then up one more to get the repo root
    const worktreesDir = dirname(gitdir); // .git/worktrees
    const dotGitDir = dirname(worktreesDir); // .git
    const mainRoot = dirname(dotGitDir); // repo root

    return mainRoot;
  } catch {
    return cwd;
  }
}

/**
 * Get the default branch name (main, master, etc.) for the repo.
 * Tries `git symbolic-ref refs/remotes/origin/HEAD` first,
 * falls back to checking if 'main' or 'master' branches exist.
 */
export function getMainBranch(cwd: string): string {
  try {
    // Try symbolic-ref first (works when origin/HEAD is set)
    const result = Bun.spawnSync(['git', 'symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd,
      timeout: 2_000,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode === 0) {
      const ref = result.stdout.toString().trim();
      // ref is like "refs/remotes/origin/main" — extract the branch name
      const branchName = ref.split('/').pop();
      if (branchName) return branchName;
    }
  } catch {
    // Fall through to next strategy
  }

  // Fallback: check if 'main' branch exists
  try {
    const mainCheck = Bun.spawnSync(['git', 'show-ref', '--verify', 'refs/heads/main'], {
      cwd,
      timeout: 2_000,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (mainCheck.exitCode === 0) {
      return 'main';
    }
  } catch {
    // Fall through
  }

  // Fallback: check if 'master' branch exists
  try {
    const masterCheck = Bun.spawnSync(['git', 'show-ref', '--verify', 'refs/heads/master'], {
      cwd,
      timeout: 2_000,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (masterCheck.exitCode === 0) {
      return 'master';
    }
  } catch {
    // Fall through
  }

  // Default
  return 'main';
}

/**
 * Normalize the project path for cross-worktree consistency.
 * Returns the main repo root path so observations from different worktrees
 * of the same repo are associated with the same project.
 */
export function normalizeProjectPath(cwd: string): string {
  try {
    if (isWorktree(cwd)) {
      return getWorktreeMainRoot(cwd);
    }

    // Not a worktree — return the git toplevel
    const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
      cwd,
      timeout: 2_000,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode === 0) {
      const toplevel = result.stdout.toString().trim();
      if (toplevel) return toplevel;
    }

    return cwd;
  } catch {
    return cwd;
  }
}
