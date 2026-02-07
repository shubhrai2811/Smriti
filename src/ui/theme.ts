import type React from 'react';

// Dark theme colors matching GitHub/VS Code dark

export const colors = {
  bg: '#0d1117',
  surface: '#161b22',
  surfaceHover: '#1c2129',
  border: '#30363d',
  textPrimary: '#c9d1d9',
  textSecondary: '#8b949e',
  textMuted: '#6e7681',
  accentBlue: '#58a6ff',
  accentGreen: '#3fb950',
  accentOrange: '#d29922',
  accentRed: '#f85149',
  accentPurple: '#bc8cff',
  accentCyan: '#39d3ef',
} as const;

// Observation type to color mapping
export const typeColors: Record<string, string> = {
  bugfix: colors.accentRed,
  feature: colors.accentGreen,
  refactor: colors.accentOrange,
  discovery: colors.accentBlue,
  decision: colors.accentPurple,
  pattern: colors.accentCyan,
  config: colors.textSecondary,
  dependency: colors.accentOrange,
};

// Session status to color mapping
export const statusColors: Record<string, string> = {
  active: colors.accentGreen,
  completed: colors.accentBlue,
  failed: colors.accentRed,
};

// Reflection category to color mapping
export const categoryColors: Record<string, string> = {
  pattern: colors.accentCyan,
  lesson: colors.accentGreen,
  warning: colors.accentOrange,
  improvement: colors.accentBlue,
  preference: colors.accentPurple,
  common_mistake: colors.accentRed,
  style: colors.accentCyan,
  expertise: colors.accentGreen,
};

// Reusable style objects
export const baseStyles = {
  page: {
    padding: '24px',
    maxWidth: '1200px',
  } as React.CSSProperties,

  pageTitle: {
    fontSize: '20px',
    fontWeight: 600,
    color: colors.textPrimary,
    margin: '0 0 20px 0',
  } as React.CSSProperties,

  card: {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '12px',
  } as React.CSSProperties,

  badge: (color: string) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500,
    color: color,
    background: `${color}20`,
    border: `1px solid ${color}40`,
  }) as React.CSSProperties,

  timestamp: {
    fontSize: '12px',
    color: colors.textMuted,
  } as React.CSSProperties,

  emptyState: {
    textAlign: 'center' as const,
    padding: '48px 24px',
    color: colors.textSecondary,
    fontSize: '14px',
  } as React.CSSProperties,

  errorState: {
    textAlign: 'center' as const,
    padding: '24px',
    color: colors.accentRed,
    fontSize: '14px',
  } as React.CSSProperties,

  loadingState: {
    textAlign: 'center' as const,
    padding: '48px 24px',
    color: colors.textSecondary,
    fontSize: '14px',
  } as React.CSSProperties,

  input: {
    width: '100%',
    padding: '10px 14px',
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: '6px',
    color: colors.textPrimary,
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,

  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '14px',
  } as React.CSSProperties,

  th: {
    textAlign: 'left' as const,
    padding: '8px 12px',
    borderBottom: `1px solid ${colors.border}`,
    color: colors.textSecondary,
    fontWeight: 500,
    fontSize: '12px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  } as React.CSSProperties,

  td: {
    padding: '10px 12px',
    borderBottom: `1px solid ${colors.border}`,
    color: colors.textPrimary,
  } as React.CSSProperties,
};

// Helper to format epoch timestamp
export function formatTime(epoch: number): string {
  const date = new Date(epoch);
  const now = Date.now();
  const diff = now - epoch;

  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

// Format ISO date string
export function formatDate(isoString: string | null): string {
  if (!isoString) return '-';
  return formatTime(new Date(isoString).getTime());
}

// Format uptime in ms to human-readable
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// Format number with commas
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

// Format USD cost
export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

// Parse JSON array string safely
export function parseJsonArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Confidence to visual bar (text-based)
export function confidenceBar(confidence: number): string {
  const filled = Math.round(confidence * 10);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
}
