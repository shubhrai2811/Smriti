import { useState } from 'react';
import { useApi } from '../hooks.js';
import { baseStyles, colors, formatDate, formatTime, parseJsonArray, statusColors, typeColors } from '../theme.js';
import type { ObservationRow, ObservationsResponse, SessionRow, SessionsResponse } from '../types.js';

function SessionCard({
  session,
  onSelect,
  isSelected,
}: {
  session: SessionRow;
  onSelect: (id: number | null) => void;
  isSelected: boolean;
}) {
  const statusColor = statusColors[session.status] || colors.textSecondary;

  return (
    <div
      role="button"
      tabIndex={0}
      style={{
        ...baseStyles.card,
        cursor: 'pointer',
        borderColor: isSelected ? `${colors.accentBlue}60` : colors.border,
      }}
      onClick={() => onSelect(isSelected ? null : session.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(isSelected ? null : session.id);
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
          <span style={baseStyles.badge(statusColor)}>{session.status}</span>
          <span style={{ fontSize: '14px', fontWeight: 500, color: colors.textPrimary }}>
            {session.project || 'Unknown Project'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
          <span style={{ fontSize: '12px', color: colors.textSecondary }}>{session.prompt_count} prompts</span>
          <span style={baseStyles.timestamp}>{formatTime(session.created_at_epoch)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '16px', marginTop: '8px', flexWrap: 'wrap' }}>
        {session.branch && (
          <span style={{ fontSize: '12px', color: colors.textSecondary }}>
            Branch: <span style={{ color: colors.textPrimary }}>{session.branch}</span>
          </span>
        )}
        <span style={{ fontSize: '12px', color: colors.textSecondary }}>
          IDE: <span style={{ color: colors.textPrimary }}>{session.source_ide}</span>
        </span>
        {session.completed_at && (
          <span style={{ fontSize: '12px', color: colors.textSecondary }}>
            Completed: <span style={{ color: colors.textPrimary }}>{formatDate(session.completed_at)}</span>
          </span>
        )}
        <span style={{ fontSize: '12px', color: colors.textMuted }}>
          ID: {session.content_session_id.slice(0, 12)}...
        </span>
      </div>
    </div>
  );
}

function SessionObservations({ sessionId }: { sessionId: number }) {
  // We fetch all observations and filter client-side by session_id
  // since there's no direct session-observations endpoint in data routes
  const { data, loading, error } = useApi<ObservationsResponse>('/data/observations', { project: '', limit: '200' });

  const observations = (data?.observations ?? []).filter((obs: ObservationRow) => obs.session_id === sessionId);

  if (loading) return <div style={{ ...baseStyles.loadingState, padding: '16px' }}>Loading...</div>;
  if (error) return <div style={baseStyles.errorState}>{error}</div>;
  if (observations.length === 0)
    return <div style={{ ...baseStyles.emptyState, padding: '16px' }}>No observations for this session.</div>;

  return (
    <div style={{ marginBottom: '16px', paddingLeft: '16px', borderLeft: `2px solid ${colors.accentBlue}40` }}>
      <div style={{ fontSize: '13px', color: colors.textSecondary, marginBottom: '10px', fontWeight: 500 }}>
        Session Observations ({observations.length})
      </div>
      {observations.map((obs: ObservationRow) => {
        const typeColor = typeColors[obs.type] || colors.textSecondary;
        const facts = parseJsonArray(obs.facts);
        return (
          <div
            key={obs.id}
            style={{
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              padding: '10px 12px',
              marginBottom: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={baseStyles.badge(typeColor)}>{obs.type}</span>
              <span style={{ fontSize: '13px', color: colors.textPrimary }}>{obs.title}</span>
              <span style={{ ...baseStyles.timestamp, marginLeft: 'auto' }}>{formatTime(obs.created_at_epoch)}</span>
            </div>
            {facts.length > 0 && (
              <ul style={{ margin: '6px 0 0 0', paddingLeft: '16px' }}>
                {facts.slice(0, 3).map((fact) => (
                  <li key={fact} style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '2px' }}>
                    {fact}
                  </li>
                ))}
                {facts.length > 3 && (
                  <li style={{ fontSize: '12px', color: colors.textMuted }}>+{facts.length - 3} more</li>
                )}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Sessions() {
  const [project, setProject] = useState('');
  const [selectedSession, setSelectedSession] = useState<number | null>(null);

  const { data, loading, error } = useApi<SessionsResponse>('/data/sessions', { project, limit: '30' }, 30_000);

  const sessions = data?.sessions ?? [];

  return (
    <div style={baseStyles.page}>
      <h2 style={baseStyles.pageTitle}>Sessions</h2>

      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Filter by project..."
          value={project}
          onChange={(e) => setProject(e.target.value)}
          style={{ ...baseStyles.input, maxWidth: '280px' }}
        />
      </div>

      {loading && <div style={baseStyles.loadingState}>Loading sessions...</div>}
      {error && <div style={baseStyles.errorState}>{error}</div>}
      {!loading && !error && sessions.length === 0 && <div style={baseStyles.emptyState}>No sessions found.</div>}

      {sessions.map((session) => (
        <div key={session.id}>
          <SessionCard session={session} onSelect={setSelectedSession} isSelected={selectedSession === session.id} />
          {selectedSession === session.id && <SessionObservations sessionId={session.id} />}
        </div>
      ))}
    </div>
  );
}
