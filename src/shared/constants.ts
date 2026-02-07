export const HOOK_EXIT_CODES = {
  SUCCESS: 0,
  FAILURE: 1,
  BLOCKING_ERROR: 2,
} as const;

export const HOOK_TIMEOUTS = {
  DEFAULT: 300_000,
  HEALTH_CHECK: 30_000,
  HEALTH_POLL_INTERVAL: 200,
  STDIN_SAFETY: 30_000,
  STDIN_PARSE_DELAY: 50,
  SUMMARIZE: 90_000,
} as const;

export const WORKER_DEFAULTS = {
  IDLE_TIMEOUT_MINUTES: 30,
  MAX_RETRIES: 3,
} as const;

export const META_TOOLS = new Set([
  'TodoWrite',
  'TodoRead',
  'Skill',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'TaskCreate',
  'TaskUpdate',
  'TaskGet',
  'TaskList',
  'TaskStop',
]);
