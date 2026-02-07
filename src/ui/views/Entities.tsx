import { useState } from 'react';
import { useApi } from '../hooks.js';
import { colors, baseStyles, formatTime } from '../theme.js';
import type { EntitiesResponse, HotspotsResponse, EntityRow } from '../types.js';

const ENTITY_TYPE_OPTIONS = ['All', 'file', 'function', 'error_pattern', 'dependency', 'concept'] as const;

const entityTypeColors: Record<string, string> = {
  file: colors.accentOrange,
  function: colors.accentBlue,
  error_pattern: colors.accentRed,
  dependency: colors.accentGreen,
  concept: colors.accentPurple,
};

function getEntityColor(entityType: string): string {
  return entityTypeColors[entityType] || colors.textSecondary;
}

function HotspotCard({ entity }: { entity: EntityRow }) {
  const color = getEntityColor(entity.entity_type);

  return (
    <div
      style={{
        ...baseStyles.card,
        borderLeft: `3px solid ${color}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        minWidth: '220px',
        flex: '1 1 220px',
        maxWidth: '320px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: colors.textPrimary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
          title={entity.name}
        >
          {entity.name}
        </span>
        <span style={baseStyles.badge(color)}>{entity.entity_type.replace('_', ' ')}</span>
      </div>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', color: colors.textSecondary }}>
          Mentions: <span style={{ color: color, fontWeight: 600 }}>{entity.mention_count}</span>
        </span>
        <span style={{ fontSize: '12px', color: colors.textSecondary }}>
          Last seen: <span style={{ color: colors.textPrimary }}>{formatTime(entity.last_seen_epoch)}</span>
        </span>
      </div>

      {entity.metadata && (() => {
        try {
          const meta = JSON.parse(entity.metadata);
          const entries = Object.entries(meta).slice(0, 3);
          if (entries.length === 0) return null;
          return (
            <div style={{ fontSize: '11px', color: colors.textMuted }}>
              {entries.map(([key, value]) => (
                <span key={key} style={{ marginRight: '10px' }}>
                  {key}: {String(value)}
                </span>
              ))}
            </div>
          );
        } catch {
          return null;
        }
      })()}
    </div>
  );
}

function EntityTable({ entities }: { entities: EntityRow[] }) {
  if (entities.length === 0) {
    return <div style={baseStyles.emptyState}>No entities found.</div>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={baseStyles.table}>
        <thead>
          <tr>
            <th style={baseStyles.th}>Name</th>
            <th style={baseStyles.th}>Type</th>
            <th style={{ ...baseStyles.th, textAlign: 'right' as const }}>Mentions</th>
            <th style={baseStyles.th}>First Seen</th>
            <th style={baseStyles.th}>Last Seen</th>
            <th style={baseStyles.th}>Project</th>
          </tr>
        </thead>
        <tbody>
          {entities.map((entity) => {
            const color = getEntityColor(entity.entity_type);
            return (
              <tr
                key={entity.id}
                style={{ transition: 'background 0.1s' }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = colors.surfaceHover;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <td
                  style={{
                    ...baseStyles.td,
                    fontWeight: 500,
                    maxWidth: '300px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={entity.name}
                >
                  {entity.name}
                </td>
                <td style={baseStyles.td}>
                  <span style={baseStyles.badge(color)}>{entity.entity_type.replace('_', ' ')}</span>
                </td>
                <td style={{ ...baseStyles.td, textAlign: 'right' as const, fontWeight: 600, color }}>
                  {entity.mention_count}
                </td>
                <td style={{ ...baseStyles.td, ...baseStyles.timestamp }}>
                  {formatTime(entity.first_seen_epoch)}
                </td>
                <td style={{ ...baseStyles.td, ...baseStyles.timestamp }}>
                  {formatTime(entity.last_seen_epoch)}
                </td>
                <td style={{ ...baseStyles.td, fontSize: '12px', color: colors.textSecondary }}>
                  {entity.project}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Entities() {
  const [project, setProject] = useState('');
  const [entityType, setEntityType] = useState('All');

  const entityTypeParam = entityType === 'All' ? '' : entityType;

  const { data: hotspotsData, loading: hotspotsLoading, error: hotspotsError } = useApi<HotspotsResponse>(
    '/data/hotspots',
    { project, entityType: entityTypeParam, limit: '20' },
  );

  const { data: entitiesData, loading: entitiesLoading, error: entitiesError } = useApi<EntitiesResponse>(
    '/data/entities',
    { project, entityType: entityTypeParam, limit: '50' },
  );

  const hotspots = hotspotsData?.hotspots ?? [];
  const entities = entitiesData?.entities ?? [];

  return (
    <div style={baseStyles.page}>
      <h2 style={baseStyles.pageTitle}>Entities</h2>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Filter by project..."
          value={project}
          onChange={(e) => setProject(e.target.value)}
          style={{ ...baseStyles.input, maxWidth: '280px' }}
        />
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          style={{
            ...baseStyles.input,
            maxWidth: '180px',
            appearance: 'auto' as any,
          }}
        >
          {ENTITY_TYPE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt === 'All' ? 'All Types' : opt.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      {/* Hotspots Section */}
      <div style={{ marginBottom: '32px' }}>
        <h3
          style={{
            fontSize: '16px',
            fontWeight: 600,
            color: colors.textPrimary,
            margin: '0 0 14px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span style={{ color: colors.accentRed }}>Hotspots</span>
          <span style={{ fontSize: '12px', color: colors.textMuted, fontWeight: 400 }}>
            Top entities by mention count
          </span>
        </h3>

        {hotspotsLoading && <div style={baseStyles.loadingState}>Loading hotspots...</div>}
        {hotspotsError && <div style={baseStyles.errorState}>{hotspotsError}</div>}
        {!hotspotsLoading && !hotspotsError && hotspots.length === 0 && (
          <div style={baseStyles.emptyState}>No hotspot entities found.</div>
        )}
        {!hotspotsLoading && !hotspotsError && hotspots.length > 0 && (
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {hotspots.map((entity) => (
              <HotspotCard key={entity.id} entity={entity} />
            ))}
          </div>
        )}
      </div>

      {/* All Entities Section */}
      <div>
        <h3
          style={{
            fontSize: '16px',
            fontWeight: 600,
            color: colors.textPrimary,
            margin: '0 0 14px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          All Entities
          {!entitiesLoading && !entitiesError && (
            <span style={{ fontSize: '12px', color: colors.textMuted, fontWeight: 400 }}>
              {entities.length} result{entities.length !== 1 ? 's' : ''}
            </span>
          )}
        </h3>

        {entitiesLoading && <div style={baseStyles.loadingState}>Loading entities...</div>}
        {entitiesError && <div style={baseStyles.errorState}>{entitiesError}</div>}
        {!entitiesLoading && !entitiesError && <EntityTable entities={entities} />}
      </div>
    </div>
  );
}
