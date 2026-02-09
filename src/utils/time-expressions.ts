/**
 * Parse natural language time expressions into epoch ranges.
 * Returns { start, end } in milliseconds or null if not recognized.
 *
 * Supported expressions:
 *  - "today", "yesterday"
 *  - "this week", "last week", "last month"
 *  - "last N days", "last N hours"
 *  - "N hours ago", "N days ago"
 */
export function parseTimeExpression(expr: string): { start: number; end: number } | null {
  const trimmed = expr.trim().toLowerCase();
  const now = Date.now();

  // "today"
  if (trimmed === 'today') {
    const start = startOfDay(now);
    return { start, end: now };
  }

  // "yesterday"
  if (trimmed === 'yesterday') {
    const todayStart = startOfDay(now);
    return { start: todayStart - 86400000, end: todayStart };
  }

  // "this week"
  if (trimmed === 'this week') {
    const start = startOfWeek(now);
    return { start, end: now };
  }

  // "last week"
  if (trimmed === 'last week') {
    const thisWeekStart = startOfWeek(now);
    return { start: thisWeekStart - 7 * 86400000, end: thisWeekStart };
  }

  // "last month"
  if (trimmed === 'last month') {
    return { start: now - 30 * 86400000, end: now };
  }

  // "last N days"
  const lastNDays = trimmed.match(/^last\s+(\d+)\s+days?$/);
  if (lastNDays) {
    const days = parseInt(lastNDays[1], 10);
    return { start: now - days * 86400000, end: now };
  }

  // "last N hours"
  const lastNHours = trimmed.match(/^last\s+(\d+)\s+hours?$/);
  if (lastNHours) {
    const hours = parseInt(lastNHours[1], 10);
    return { start: now - hours * 3600000, end: now };
  }

  // "N hours ago"
  const nHoursAgo = trimmed.match(/^(\d+)\s+hours?\s+ago$/);
  if (nHoursAgo) {
    const hours = parseInt(nHoursAgo[1], 10);
    return { start: now - hours * 3600000, end: now };
  }

  // "N days ago"
  const nDaysAgo = trimmed.match(/^(\d+)\s+days?\s+ago$/);
  if (nDaysAgo) {
    const days = parseInt(nDaysAgo[1], 10);
    return { start: now - days * 86400000, end: now };
  }

  return null;
}

function startOfDay(epoch: number): number {
  const date = new Date(epoch);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfWeek(epoch: number): number {
  const date = new Date(epoch);
  const day = date.getDay();
  // Start of week = Sunday
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
