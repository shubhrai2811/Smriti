import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { deleteApi, fetchApi, postApi, putApi } from '../api.js';
import { useApi, useSSE } from '../hooks.js';
import { baseStyles, colors, formatTime, parseJsonArray, typeColors } from '../theme.js';
import type { ObservationRow, ObservationsResponse, ObservationTagsResponse, ObservationType } from '../types.js';

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
          background:
            i <= importance
              ? importance >= 8
                ? colors.accentRed
                : importance >= 5
                  ? colors.accentOrange
                  : colors.accentGreen
              : colors.border,
        }}
      />,
    );
  }
  return <span style={{ display: 'inline-flex', alignItems: 'center' }}>{dots}</span>;
}

function ScopeBadge({ scope }: { scope?: string }) {
  const isGlobal = scope === 'global';
  const color = isGlobal ? colors.accentCyan : colors.textMuted;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: '10px',
        fontSize: '10px',
        fontWeight: 500,
        color: color,
        background: `${color}15`,
        border: `1px solid ${color}30`,
        textTransform: 'uppercase',
        letterSpacing: '0.3px',
      }}
    >
      {isGlobal ? 'global' : 'project'}
    </span>
  );
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

  const handleRemoveTag = async (e: React.MouseEvent | React.KeyboardEvent, tag: string) => {
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
            role="button"
            tabIndex={0}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') handleRemoveTag(e, tag);
            }}
          >
            {tag}
            <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '2px' }}>&times;</span>
          </span>
        ))}
        <button
          type="button"
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

const OBS_TYPES: ObservationType[] = [
  'bugfix',
  'feature',
  'refactor',
  'discovery',
  'decision',
  'pattern',
  'config',
  'dependency',
];

function ObservationCard({
  obs,
  onDelete,
  onUpdate,
}: {
  obs: ObservationRow;
  onDelete: (id: number) => void;
  onUpdate: (id: number, fields: Partial<ObservationRow>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(obs.title);
  const [editImportance, setEditImportance] = useState(String(obs.importance));
  const [editType, setEditType] = useState(obs.type);
  const [editScope, setEditScope] = useState(obs.scope || 'project');
  const [deleting, setDeleting] = useState(false);

  const facts = parseJsonArray(obs.facts);
  const concepts = parseJsonArray(obs.concepts);
  const files = parseJsonArray(obs.files_affected);
  const typeColor = typeColors[obs.type] || colors.textSecondary;

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete observation #${obs.id}: "${obs.title}"?`)) return;
    setDeleting(true);
    try {
      await deleteApi(`/data/observations/${obs.id}`);
      onDelete(obs.id);
    } catch {
      setDeleting(false);
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTitle(obs.title);
    setEditImportance(String(obs.importance));
    setEditType(obs.type);
    setEditScope(obs.scope || 'project');
    setEditing(true);
  };

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await putApi<ObservationRow>(`/data/observations/${obs.id}`, {
        title: editTitle,
        importance: parseInt(editImportance, 10),
        type: editType,
        scope: editScope,
      });
      onUpdate(obs.id, updated);
      setEditing(false);
    } catch {
      // Silently fail
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(false);
  };

  if (deleting) return null;

  return (
    <div
      role="button"
      tabIndex={0}
      style={{
        ...baseStyles.card,
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        borderColor: expanded ? `${typeColor}60` : colors.border,
      }}
      onClick={() => !editing && setExpanded(!expanded)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (!editing) setExpanded(!expanded);
        }
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
          <span style={baseStyles.badge(typeColor)}>{obs.type}</span>
          <ScopeBadge scope={obs.scope} />
          <span
            style={{
              fontSize: '14px',
              fontWeight: 500,
              color: colors.textPrimary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
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
          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <button
              type="button"
              onClick={handleEdit}
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                color: colors.accentBlue,
                background: `${colors.accentBlue}15`,
                border: `1px solid ${colors.accentBlue}30`,
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={handleDelete}
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                color: colors.accentRed,
                background: `${colors.accentRed}15`,
                border: `1px solid ${colors.accentRed}30`,
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
          </div>

          {/* Inline edit form */}
          {editing && (
            <div
              role="group"
              style={{ marginBottom: '14px', padding: '12px', background: colors.bg, borderRadius: '6px' }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <div style={{ marginBottom: '8px' }}>
                <label
                  htmlFor={`edit-title-${obs.id}`}
                  style={{ fontSize: '12px', color: colors.textSecondary, display: 'block', marginBottom: '4px' }}
                >
                  Title
                </label>
                <input
                  id={`edit-title-${obs.id}`}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  style={{ ...baseStyles.input, width: '100%' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label
                    htmlFor={`edit-type-${obs.id}`}
                    style={{ fontSize: '12px', color: colors.textSecondary, display: 'block', marginBottom: '4px' }}
                  >
                    Type
                  </label>
                  <select
                    id={`edit-type-${obs.id}`}
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as ObservationType)}
                    style={{ ...baseStyles.input, appearance: 'auto' as any }}
                  >
                    {OBS_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label
                    htmlFor={`edit-importance-${obs.id}`}
                    style={{ fontSize: '12px', color: colors.textSecondary, display: 'block', marginBottom: '4px' }}
                  >
                    Importance (1-10)
                  </label>
                  <input
                    id={`edit-importance-${obs.id}`}
                    type="number"
                    min="1"
                    max="10"
                    value={editImportance}
                    onChange={(e) => setEditImportance(e.target.value)}
                    style={baseStyles.input}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label
                    htmlFor={`edit-scope-${obs.id}`}
                    style={{ fontSize: '12px', color: colors.textSecondary, display: 'block', marginBottom: '4px' }}
                  >
                    Scope
                  </label>
                  <select
                    id={`edit-scope-${obs.id}`}
                    value={editScope}
                    onChange={(e) => setEditScope(e.target.value)}
                    style={{ ...baseStyles.input, appearance: 'auto' as any }}
                  >
                    <option value="project">project</option>
                    <option value="global">global</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handleSave}
                  style={{
                    padding: '6px 14px',
                    fontSize: '12px',
                    color: '#fff',
                    background: colors.accentGreen,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  style={{
                    padding: '6px 14px',
                    fontSize: '12px',
                    color: colors.textSecondary,
                    background: 'transparent',
                    border: `1px solid ${colors.border}`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

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
              <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '6px', fontWeight: 500 }}>
                Facts
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                {facts.map((fact) => (
                  <li key={fact} style={{ fontSize: '13px', color: colors.textPrimary, marginBottom: '3px' }}>
                    {fact}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Concepts */}
          {concepts.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '6px', fontWeight: 500 }}>
                Concepts
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {concepts.map((concept) => (
                  <span key={concept} style={baseStyles.badge(colors.accentBlue)}>
                    {concept}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Files */}
          {files.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '6px', fontWeight: 500 }}>
                Files Affected
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {files.map((file) => (
                  <span
                    key={file}
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
  const [observations, setObservations] = useState<ObservationRow[]>([]);

  const { data, loading, error, refetch } = useApi<ObservationsResponse>(
    '/data/observations',
    { project, limit },
    30_000, // poll every 30s
  );

  // Sync API data to local state
  useEffect(() => {
    if (data?.observations) {
      setObservations(data.observations);
    }
  }, [data]);

  // SSE live updates — prepend new observations
  useSSE(
    '/data/events',
    (event) => {
      if (event === 'observation:new') {
        // Refetch to get the full observation data
        refetch();
      }
    },
    project ? { project } : undefined,
  );

  const handleDelete = (id: number) => {
    setObservations((prev) => prev.filter((o) => o.id !== id));
  };

  const handleUpdate = (id: number, fields: Partial<ObservationRow>) => {
    setObservations((prev) => prev.map((o) => (o.id === id ? { ...o, ...fields } : o)));
  };

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
      {loading && observations.length === 0 && <div style={baseStyles.loadingState}>Loading observations...</div>}
      {error && <div style={baseStyles.errorState}>{error}</div>}
      {!loading && !error && observations.length === 0 && (
        <div style={baseStyles.emptyState}>No observations found. Memory will appear here as you work.</div>
      )}
      {observations.map((obs) => (
        <ObservationCard key={obs.id} obs={obs} onDelete={handleDelete} onUpdate={handleUpdate} />
      ))}
    </div>
  );
}
