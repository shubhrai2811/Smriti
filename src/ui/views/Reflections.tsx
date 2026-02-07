import { useState } from 'react';
import { useApi } from '../hooks.js';
import { colors, categoryColors, baseStyles, formatTime, confidenceBar, parseJsonArray } from '../theme.js';
import type { ReflectionsResponse, ReflectionRow } from '../types.js';

function ReflectionCard({ reflection }: { reflection: ReflectionRow }) {
  const [expanded, setExpanded] = useState(false);
  const catColor = categoryColors[reflection.category || ''] || colors.textSecondary;
  const sourceIds = parseJsonArray(reflection.source_observation_ids);

  return (
    <div
      style={{
        ...baseStyles.card,
        cursor: 'pointer',
        borderColor: expanded ? catColor + '60' : colors.border,
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={baseStyles.badge(reflection.type === 'deep' ? colors.accentPurple : colors.accentBlue)}>
              {reflection.type}
            </span>
            {reflection.category && (
              <span style={baseStyles.badge(catColor)}>{reflection.category}</span>
            )}
          </div>
          <div style={{ fontSize: '14px', color: colors.textPrimary, lineHeight: '1.5' }}>
            {reflection.insight}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
          <span style={baseStyles.timestamp}>{formatTime(reflection.created_at_epoch)}</span>
          <span style={{ color: colors.textMuted, fontSize: '12px' }}>{expanded ? '\u25B2' : '\u25BC'}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px solid ${colors.border}` }}>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '4px' }}>Confidence</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', color: colors.textPrimary, fontFamily: 'monospace', letterSpacing: '1px' }}>
                  {confidenceBar(reflection.confidence)}
                </span>
                <span style={{ fontSize: '12px', color: colors.textSecondary }}>
                  {(reflection.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '4px' }}>Project</div>
              <div style={{ fontSize: '13px', color: colors.textPrimary }}>{reflection.project}</div>
            </div>

            {sourceIds.length > 0 && (
              <div>
                <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '4px' }}>Source Observations</div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {sourceIds.map((id, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: '11px',
                        color: colors.accentBlue,
                        background: `${colors.accentBlue}15`,
                        padding: '1px 6px',
                        borderRadius: '4px',
                        fontFamily: 'monospace',
                      }}
                    >
                      #{id}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {reflection.session_id && (
              <div>
                <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '4px' }}>Session ID</div>
                <div style={{ fontSize: '13px', color: colors.textPrimary }}>#{reflection.session_id}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Reflections() {
  const [project, setProject] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const { data, loading, error } = useApi<ReflectionsResponse>(
    '/data/reflections',
    {
      project,
      limit: '50',
      ...(typeFilter ? { type: typeFilter } : {}),
    },
    30_000,
  );

  const reflections = data?.reflections ?? [];

  // Group by type
  const quickReflections = reflections.filter((r) => r.type === 'quick');
  const deepReflections = reflections.filter((r) => r.type === 'deep');

  return (
    <div style={baseStyles.page}>
      <h2 style={baseStyles.pageTitle}>Reflections</h2>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Filter by project..."
          value={project}
          onChange={(e) => setProject(e.target.value)}
          style={{ ...baseStyles.input, maxWidth: '280px' }}
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{
            ...baseStyles.input,
            maxWidth: '140px',
            appearance: 'auto' as any,
          }}
        >
          <option value="">All types</option>
          <option value="quick">Quick</option>
          <option value="deep">Deep</option>
        </select>
      </div>

      {loading && <div style={baseStyles.loadingState}>Loading reflections...</div>}
      {error && <div style={baseStyles.errorState}>{error}</div>}
      {!loading && !error && reflections.length === 0 && (
        <div style={baseStyles.emptyState}>
          No reflections found. Reflections are generated automatically after sessions.
        </div>
      )}

      {/* Show grouped when no type filter */}
      {!typeFilter && deepReflections.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '15px', color: colors.accentPurple, margin: '0 0 12px 0', fontWeight: 500 }}>
            Deep Reflections ({deepReflections.length})
          </h3>
          {deepReflections.map((r) => (
            <ReflectionCard key={r.id} reflection={r} />
          ))}
        </div>
      )}

      {!typeFilter && quickReflections.length > 0 && (
        <div>
          <h3 style={{ fontSize: '15px', color: colors.accentBlue, margin: '0 0 12px 0', fontWeight: 500 }}>
            Quick Reflections ({quickReflections.length})
          </h3>
          {quickReflections.map((r) => (
            <ReflectionCard key={r.id} reflection={r} />
          ))}
        </div>
      )}

      {/* Show flat list when type filter is active */}
      {typeFilter && reflections.map((r) => (
        <ReflectionCard key={r.id} reflection={r} />
      ))}
    </div>
  );
}
