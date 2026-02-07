import { useApi } from '../hooks.js';
import { colors, baseStyles, formatNumber, formatCost } from '../theme.js';
import type { TokenUsageSummary } from '../types.js';

function SummaryCard({ label, value, subtext, color }: { label: string; value: string; subtext?: string; color: string }) {
  return (
    <div
      style={{
        ...baseStyles.card,
        flex: '1 1 200px',
        textAlign: 'center',
        marginBottom: '0',
      }}
    >
      <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: '28px', fontWeight: 700, color, fontFamily: 'monospace' }}>
        {value}
      </div>
      {subtext && (
        <div style={{ fontSize: '12px', color: colors.textMuted, marginTop: '4px' }}>{subtext}</div>
      )}
    </div>
  );
}

function BreakdownTable({ title, data }: { title: string; data: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return null;
  }

  return (
    <div style={{ ...baseStyles.card, marginBottom: '16px' }}>
      <h3 style={{ fontSize: '15px', fontWeight: 600, color: colors.textPrimary, margin: '0 0 12px 0' }}>
        {title}
      </h3>
      <table style={baseStyles.table}>
        <thead>
          <tr>
            <th style={baseStyles.th}>Name</th>
            <th style={{ ...baseStyles.th, textAlign: 'right' }}>Input Tokens</th>
            <th style={{ ...baseStyles.th, textAlign: 'right' }}>Output Tokens</th>
            <th style={{ ...baseStyles.th, textAlign: 'right' }}>Total Tokens</th>
            <th style={{ ...baseStyles.th, textAlign: 'right' }}>Est. Cost</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, usage]) => (
            <tr key={name}>
              <td style={{ ...baseStyles.td, fontWeight: 500 }}>{formatOperationName(name)}</td>
              <td style={{ ...baseStyles.td, textAlign: 'right', fontFamily: 'monospace', color: colors.accentBlue }}>
                {formatNumber(usage.inputTokens)}
              </td>
              <td style={{ ...baseStyles.td, textAlign: 'right', fontFamily: 'monospace', color: colors.accentGreen }}>
                {formatNumber(usage.outputTokens)}
              </td>
              <td style={{ ...baseStyles.td, textAlign: 'right', fontFamily: 'monospace', color: colors.textPrimary }}>
                {formatNumber(usage.inputTokens + usage.outputTokens)}
              </td>
              <td style={{ ...baseStyles.td, textAlign: 'right', fontFamily: 'monospace', color: colors.accentOrange }}>
                {formatCost(usage.costUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatOperationName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Metrics() {
  // The worker doesn't expose a /data/token-usage endpoint directly,
  // but we can compute from settings or add a note.
  // For now, we'll attempt to fetch from a metrics endpoint or show placeholder.
  const { data, loading, error } = useApi<TokenUsageSummary>(
    '/data/metrics',
    undefined,
    60_000, // poll every minute
  );

  // If the endpoint doesn't exist yet, show an informational state
  const noEndpoint = error && error.includes('404');

  return (
    <div style={baseStyles.page}>
      <h2 style={baseStyles.pageTitle}>Metrics</h2>

      {loading && <div style={baseStyles.loadingState}>Loading metrics...</div>}

      {noEndpoint && (
        <div style={baseStyles.emptyState}>
          <div style={{ marginBottom: '12px', fontSize: '16px', color: colors.textPrimary }}>
            Metrics endpoint not available
          </div>
          <div style={{ color: colors.textSecondary }}>
            Token usage tracking is stored in the database but the /data/metrics API endpoint
            has not been added to the data routes yet. Add a metrics route to expose
            the TokenUsageSummary from token-usage.ts.
          </div>
        </div>
      )}

      {error && !noEndpoint && <div style={baseStyles.errorState}>{error}</div>}

      {data && (
        <>
          {/* Summary cards */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <SummaryCard
              label="Total Tokens"
              value={formatNumber(data.totalInputTokens + data.totalOutputTokens)}
              subtext={`${formatNumber(data.totalInputTokens)} in / ${formatNumber(data.totalOutputTokens)} out`}
              color={colors.accentBlue}
            />
            <SummaryCard
              label="Estimated Cost"
              value={formatCost(data.totalCostUsd)}
              subtext="All-time total"
              color={colors.accentOrange}
            />
            <SummaryCard
              label="Providers"
              value={String(Object.keys(data.byProvider).length)}
              subtext={Object.keys(data.byProvider).join(', ') || 'None'}
              color={colors.accentGreen}
            />
            <SummaryCard
              label="Operations"
              value={String(Object.keys(data.byOperation).length)}
              subtext={Object.keys(data.byOperation).join(', ') || 'None'}
              color={colors.accentPurple}
            />
          </div>

          {/* Breakdown tables */}
          <BreakdownTable title="By Provider" data={data.byProvider} />
          <BreakdownTable title="By Operation" data={data.byOperation} />
        </>
      )}
    </div>
  );
}
