import React, { useState, useEffect, useCallback } from 'react';
import { useApi } from '../hooks.js';
import { fetchApi, postApi, deleteApi } from '../api.js';
import { colors, typeColors, baseStyles, formatTime, parseJsonArray } from '../theme.js';
import type { ObservationsResponse, ObservationRow, ObservationTagsResponse } from '../types.js';

function ImportanceIndicator({ importance }: { importance: number }) {
  const dots: React.ReactNode[] = [];
  for (let i = 1; i <= 10; i++) {
    dots.push(
      <span
        key={i}
        style={{
          display: 'inline-block',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          marginRight: '2px',
          background: i <= importance
            ? (importance >= 8 ? colors.accentRed : importance >= 5 ? colors.accentOrange : colors.accentGreen)
            : colors.border,
        }}
      />,
    );
  }
  return <span style={{ display: 'inline-flex', alignItems: 'center' }}>{dots}</span>;
}

function TagsSection({ observationId }: { observationId: number }) {
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTags = useCallback(async () => {
    try {
      const result = await fetchApi<ObservationTagsResponse>(`/data/observations/${observationId}/tags`);
      setTags(result.tags);
    } catch {
      // Silently fail - tags are non-critical
    } finally {
      setLoading(false);
    }
  }, [observationId]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const handleAddTag = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const tag = window.prompt('Enter tag name:');
    if (!tag?.trim()) return;
    try {
      await postApi(`/data/observations/${observationId}/tags`, { tag: tag.trim() });
      await fetchTags();
    } catch {
      // Silently fail
    }
  };

  const handleRemoveTag = async (e: React.MouseEvent, tag: string) => {
    e.stopPropagation();
    try {
      await deleteApi(`/data/observations/${observationId}/tags/${encodeURIComponent(tag)}`);
      await fetchTags();
    } catch {
      // Silently fail
    }
  };

  if (loading) return null;

  return (
    <div style={{ marginTop: '10px' }}>
      <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '6px', fontWeight: 500 }}>Tags</div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
        {tags.map((tag) => (
          <span
            key={tag}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 500,
              color: colors.accentPurple,
              background: `${colors.accentPurple}20`,
              border: `1px solid ${colors.accentPurple}40`,
              cursor: 'pointer',
            }}
            title={`Click to remove tag "${tag}"`}
            onClick={(e) => handleRemoveTag(e, tag)}
          >
            {tag}
            <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '2px' }}>&times;</span>
          </span>
        ))}
        <button
          onClick={handleAddTag}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            fontSize: '14px',
            fontWeight: 600,
            color: colors.accentPurple,
            background: `${colors.accentPurple}15`,
            border: `1px solid ${colors.accentPurple}30`,
            cursor: 'pointer',
            padding: 0,
            lineHeight: 1,
          }}
          title="Add tag"
        >
          +
        </button>
      </div>
    </div>
  );
}

function ObservationCard({ obs }: { obs: ObservationRow }) {
  const [expanded, setExpanded] = useState(false);
  const facts = parseJsonArray(obs.facts);
  const concepts = parseJsonArray(obs.concepts);
  const files = parseJsonArray(obs.files_affected);
  const typeColor = typeColors[obs.type] || colors.textSecondary;

  return (
    <div
      style={{
        ...baseStyles.card,
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        borderColor: expanded ? typeColor + '60' : colors.border,
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
          <span style={baseStyles.badge(typeColor)}>{obs.type}</span>
          <span style={{ fontSize: '14px', fontWeight: 500, color: colors.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {obs.title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <ImportanceIndicator importance={obs.importance} />
          <span style={baseStyles.timestamp}>{formatTime(obs.created_at_epoch)}</span>
          <span style={{ color: colors.textMuted, fontSize: '12px' }}>{expanded ? '\u25B2' : '\u25BC'}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px solid ${colors.border}` }}>
          {/* Meta row */}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: colors.textSecondary }}>
              Project: <span style={{ color: colors.textPrimary }}>{obs.project}</span>
            </span>
            {obs.branch && (
              <span style={{ fontSize: '12px', color: colors.textSecondary }}>
                Branch: <span style={{ color: colors.textPrimary }}>{obs.branch}</span>
              </span>
            )}
            <span style={{ fontSize: '12px', color: colors.textSecondary }}>
              IDE: <span style={{ color: colors.textPrimary }}>{obs.source_ide}</span>
            </span>
            <span style={{ fontSize: '12px', color: colors.textSecondary }}>
              ID: <span style={{ color: colors.textPrimary }}>#{obs.id}</span>
            </span>
          </div>

          {/* Facts */}
          {facts.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '6px', fontWeight: 500 }}>Facts</div>
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                {facts.map((fact, i) => (
                  <li key={i} style={{ fontSize: '13px', color: colors.textPrimary, marginBottom: '3px' }}>{fact}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Concepts */}
          {concepts.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '6px', fontWeight: 500 }}>Concepts</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {concepts.map((concept, i) => (
                  <span key={i} style={baseStyles.badge(colors.accentBlue)}>{concept}</span>
                ))}
              </div>
            </div>
          )}

          {/* Files */}
          {files.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '6px', fontWeight: 500 }}>Files Affected</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {files.map((file, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: '12px',
                      color: colors.accentOrange,
                      background: `${colors.accentOrange}15`,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontFamily: 'monospace',
                    }}
                  >
                    {file}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          <TagsSection observationId={obs.id} />
        </div>
      )}
    </div>
  );
}

export function Timeline() {
  const [project, setProject] = useState('');
  const [limit, setLimit] = useState('50');

  const { data, loading, error } = useApi<ObservationsResponse>(
    '/data/observations',
    { project, limit },
    30_000, // poll every 30s
  );

  const observations = data?.observations ?? [];

  return (
    <div style={baseStyles.page}>
      <h2 style={baseStyles.pageTitle}>Timeline</h2>

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
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          style={{
            ...baseStyles.input,
            maxWidth: '120px',
            appearance: 'auto' as any,
          }}
        >
          <option value="20">20 items</option>
          <option value="50">50 items</option>
          <option value="100">100 items</option>
        </select>
      </div>

      {/* Content */}
      {loading && <div style={baseStyles.loadingState}>Loading observations...</div>}
      {error && <div style={baseStyles.errorState}>{error}</div>}
      {!loading && !error && observations.length === 0 && (
        <div style={baseStyles.emptyState}>No observations found. Memory will appear here as you work.</div>
      )}
      {observations.map((obs) => (
        <ObservationCard key={obs.id} obs={obs} />
      ))}
    </div>
  );
}
