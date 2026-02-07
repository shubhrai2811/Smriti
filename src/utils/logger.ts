type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  // Try to read from config, but handle the case where config
  // isn't loaded yet (e.g., during startup) by defaulting to 'info'.
  // Also respect SMRITI_LOG_LEVEL env var directly for bootstrap.
  const envLevel = process.env.SMRITI_LOG_LEVEL;
  if (envLevel && envLevel in LOG_LEVEL_PRIORITY) {
    return envLevel as LogLevel;
  }

  try {
    // Dynamic import to avoid circular dependency at module load time.
    // We lazy-require here instead of importing at top level.
    const { getConfig } = require('../shared/config.js');
    const config = getConfig();
    const level = config.get('log', 'level') as string;
    if (level in LOG_LEVEL_PRIORITY) {
      return level as LogLevel;
    }
  } catch {
    // Config not available yet - use default
  }

  return 'info';
}

function shouldLog(level: LogLevel): boolean {
  const configuredLevel = getConfiguredLevel();
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[configuredLevel];
}

function formatMessage(
  level: LogLevel,
  component: string,
  message: string,
  context?: Record<string, unknown>,
): string {
  const tag = level.toUpperCase().padEnd(5);
  let line = `[smriti] [${tag}] [${component}] ${message}`;
  if (context !== undefined && Object.keys(context).length > 0) {
    line += ` ${JSON.stringify(context)}`;
  }
  return line;
}

function log(
  level: LogLevel,
  component: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (!shouldLog(level)) return;
  const formatted = formatMessage(level, component, message, context);
  process.stderr.write(formatted + '\n');
}

export const logger = {
  debug(component: string, message: string, context?: Record<string, unknown>): void {
    log('debug', component, message, context);
  },
  info(component: string, message: string, context?: Record<string, unknown>): void {
    log('info', component, message, context);
  },
  warn(component: string, message: string, context?: Record<string, unknown>): void {
    log('warn', component, message, context);
  },
  error(component: string, message: string, context?: Record<string, unknown>): void {
    log('error', component, message, context);
  },
};
