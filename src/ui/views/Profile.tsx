import { useState } from 'react';
import { useApi } from '../hooks.js';
import { baseStyles, categoryColors, colors, confidenceBar, formatTime, parseJsonArray } from '../theme.js';
import type { ProfileEntryRow, ProfileResponse } from '../types.js';

function ProfileCard({ entry }: { entry: ProfileEntryRow }) {
  const catColor = categoryColors[entry.category] || colors.textSecondary;
  const reflectionIds = parseJsonArray(entry.source_reflection_ids);

  return (
    <div style={baseStyles.card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={baseStyles.badge(catColor)}>{entry.category}</span>
          {entry.project ? (
            <span style={{ fontSize: '12px', color: colors.textSecondary }}>{entry.project}</span>
          ) : (
            <span style={{ fontSize: '12px', color: colors.accentOrange, fontStyle: 'italic' }}>global</span>
          )}
        </div>
        <span style={baseStyles.timestamp}>{formatTime(entry.updated_at_epoch)}</span>
      </div>

      <div style={{ fontSize: '14px', color: colors.textPrimary, lineHeight: '1.5', marginBottom: '12px' }}>
        {entry.description}
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Confidence bar */}
        <div>
          <div style={{ fontSize: '11px', color: colors.textMuted, marginBottom: '3px' }}>Confidence</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{ fontSize: '12px', color: colors.textPrimary, fontFamily: 'monospace', letterSpacing: '1px' }}
            >
              {confidenceBar(entry.confidence)}
            </span>
            <span style={{ fontSize: '11px', color: colors.textSecondary }}>
              {(entry.confidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {/* Evidence count */}
        <div>
          <div style={{ fontSize: '11px', color: colors.textMuted, marginBottom: '3px' }}>Evidence</div>
          <div style={{ fontSize: '13px', color: colors.textPrimary }}>
            {entry.evidence_count} observation{entry.evidence_count !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Source reflections */}
        {reflectionIds.length > 0 && (
          <div>
            <div style={{ fontSize: '11px', color: colors.textMuted, marginBottom: '3px' }}>From Reflections</div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {reflectionIds.map((id) => (
                <span
                  key={id}
                  style={{
                    fontSize: '11px',
                    color: colors.accentPurple,
                    background: `${colors.accentPurple}15`,
                    padding: '1px 5px',
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
      </div>
    </div>
  );
}

const CATEGORIES = ['', 'preference', 'pattern', 'common_mistake', 'style', 'expertise'] as const;

export function Profile() {
  const [project, setProject] = useState('');
  const [category, setCategory] = useState('');

  const { data, loading, error } = useApi<ProfileResponse>(
    '/data/profile',
    {
      project,
      ...(category ? { category } : {}),
    },
    30_000,
  );

  const entries = data?.entries ?? [];

  // Group by category for the summary
  const grouped = entries.reduce(
    (acc, entry) => {
      const cat = entry.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(entry);
      return acc;
    },
    {} as Record<string, ProfileEntryRow[]>,
  );

  return (
    <div style={baseStyles.page}>
      <h2 style={baseStyles.pageTitle}>Developer Profile</h2>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Filter by project..."
          value={project}
          onChange={(e) => setProject(e.target.value)}
          style={{ ...baseStyles.input, maxWidth: '280px' }}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{
            ...baseStyles.input,
            maxWidth: '180px',
            appearance: 'auto' as any,
          }}
        >
          <option value="">All categories</option>
          {CATEGORIES.filter(Boolean).map((cat) => (
            <option key={cat} value={cat}>
              {cat.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      {/* Category summary */}
      {!category && entries.length > 0 && (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {Object.entries(grouped).map(([cat, items]) => {
            const catColor = categoryColors[cat] || colors.textSecondary;
            return (
              <div
                key={cat}
                role="button"
                tabIndex={0}
                style={{
                  ...baseStyles.badge(catColor),
                  cursor: 'pointer',
                  padding: '4px 12px',
                  fontSize: '13px',
                }}
                onClick={() => setCategory(cat)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setCategory(cat);
                }}
              >
                {cat.replace('_', ' ')} ({items.length})
              </div>
            );
          })}
        </div>
      )}

      {loading && <div style={baseStyles.loadingState}>Loading profile...</div>}
      {error && <div style={baseStyles.errorState}>{error}</div>}
      {!loading && !error && entries.length === 0 && (
        <div style={baseStyles.emptyState}>
          No profile entries found. The developer profile is built from deep reflections.
        </div>
      )}

      {entries.map((entry) => (
        <ProfileCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
