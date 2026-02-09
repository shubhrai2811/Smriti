import { useApi } from '../hooks.js';
import { baseStyles, colors } from '../theme.js';
import type { SmritiSettings } from '../types.js';

// Section display configuration
const sectionMeta: Record<string, { label: string; description: string }> = {
  worker: { label: 'Worker', description: 'Background worker process settings' },
  extraction: { label: 'Extraction', description: 'AI-powered observation extraction' },
  context: { label: 'Context', description: 'Context injection into prompts' },
  scoring: { label: 'Scoring', description: 'Relevance scoring weights' },
  reflection: { label: 'Reflection', description: 'Automatic reflection and learning' },
  provider: { label: 'AI Provider', description: 'AI provider configuration' },
  masking: { label: 'Masking', description: 'Observation detail masking over time' },
  branch: { label: 'Branch', description: 'Branch filtering behavior' },
  privacy: { label: 'Privacy', description: 'Secret redaction and privacy' },
  log: { label: 'Logging', description: 'Log level configuration' },
};

// Keys to mask in the display
const SENSITIVE_KEYS = new Set(['openrouterApiKey']);

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value || '(empty)';
  return JSON.stringify(value);
}

function formatKey(key: string): string {
  // Convert camelCase to Title Case
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function SettingsSection({ sectionKey, data }: { sectionKey: string; data: Record<string, unknown> }) {
  const meta = sectionMeta[sectionKey] || { label: sectionKey, description: '' };

  return (
    <div style={{ ...baseStyles.card, marginBottom: '16px' }}>
      <div style={{ marginBottom: '12px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, color: colors.textPrimary, margin: '0 0 2px 0' }}>
          {meta.label}
        </h3>
        {meta.description && <div style={{ fontSize: '12px', color: colors.textMuted }}>{meta.description}</div>}
      </div>

      <table style={baseStyles.table}>
        <tbody>
          {Object.entries(data).map(([key, value]) => {
            const isSensitive = SENSITIVE_KEYS.has(key);
            const displayValue =
              isSensitive && value ? String(value).slice(0, 4) + '\u2022'.repeat(12) : formatValue(value);

            const valueColor =
              typeof value === 'boolean' ? (value ? colors.accentGreen : colors.accentRed) : colors.textPrimary;

            return (
              <tr key={key}>
                <td
                  style={{
                    ...baseStyles.td,
                    width: '200px',
                    fontSize: '13px',
                    color: colors.textSecondary,
                    fontWeight: 500,
                  }}
                >
                  {formatKey(key)}
                </td>
                <td
                  style={{
                    ...baseStyles.td,
                    fontSize: '13px',
                    color: valueColor,
                    fontFamily: typeof value === 'number' || typeof value === 'string' ? 'monospace' : 'inherit',
                  }}
                >
                  {displayValue}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Settings() {
  const { data, loading, error } = useApi<SmritiSettings>('/settings');

  return (
    <div style={baseStyles.page}>
      <h2 style={baseStyles.pageTitle}>Settings</h2>

      <div
        style={{
          fontSize: '13px',
          color: colors.textSecondary,
          marginBottom: '20px',
          padding: '10px 14px',
          background: `${colors.accentBlue}10`,
          border: `1px solid ${colors.accentBlue}30`,
          borderRadius: '6px',
        }}
      >
        Settings are read-only in this view. Edit settings via the config file or environment variables.
      </div>

      {loading && <div style={baseStyles.loadingState}>Loading settings...</div>}
      {error && <div style={baseStyles.errorState}>{error}</div>}

      {data &&
        Object.entries(data).map(([sectionKey, sectionData]) => (
          <SettingsSection key={sectionKey} sectionKey={sectionKey} data={sectionData as Record<string, unknown>} />
        ))}
    </div>
  );
}
