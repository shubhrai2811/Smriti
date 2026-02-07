import { useState, useMemo } from 'react';
import { useApi } from '../hooks.js';
import { colors, typeColors, baseStyles, formatTime, parseJsonArray } from '../theme.js';
import type { ObservationsResponse, ObservationRow } from '../types.js';

function SearchResultCard({ obs, query }: { obs: ObservationRow; query: string }) {
  const [expanded, setExpanded] = useState(false);
  const typeColor = typeColors[obs.type] || colors.textSecondary;
  const facts = parseJsonArray(obs.facts);
  const concepts = parseJsonArray(obs.concepts);
  const files = parseJsonArray(obs.files_affected);

  // Highlight matching text
  function highlight(text: string): React.ReactNode {
    if (!query) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part)
        ? <span key={i} style={{ background: `${colors.accentOrange}40`, color: colors.accentOrange, borderRadius: '2px', padding: '0 1px' }}>{part}</span>
        : part,
    );
  }

  return (
    <div
      style={{
        ...baseStyles.card,
        cursor: 'pointer',
        borderColor: expanded ? typeColor + '60' : colors.border,
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
          <span style={baseStyles.badge(typeColor)}>{obs.type}</span>
          <span style={{ fontSize: '14px', fontWeight: 500, color: colors.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {highlight(obs.title)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <span style={{ fontSize: '12px', color: colors.textSecondary }}>{obs.project}</span>
          <span style={baseStyles.timestamp}>{formatTime(obs.created_at_epoch)}</span>
        </div>
      </div>

      {/* Show matching facts preview even when collapsed */}
      {!expanded && query && facts.some((f) => f.toLowerCase().includes(query.toLowerCase())) && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: colors.textSecondary }}>
          {facts
            .filter((f) => f.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 2)
            .map((fact, i) => (
              <div key={i} style={{ marginBottom: '2px' }}>... {highlight(fact)}</div>
            ))}
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px solid ${colors.border}` }}>
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
              Importance: <span style={{ color: colors.textPrimary }}>{obs.importance}/10</span>
            </span>
          </div>

          {facts.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '6px', fontWeight: 500 }}>Facts</div>
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                {facts.map((fact, i) => (
                  <li key={i} style={{ fontSize: '13px', color: colors.textPrimary, marginBottom: '3px' }}>{highlight(fact)}</li>
                ))}
              </ul>
            </div>
          )}

          {concepts.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '6px', fontWeight: 500 }}>Concepts</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {concepts.map((concept, i) => (
                  <span key={i} style={baseStyles.badge(colors.accentBlue)}>{highlight(concept)}</span>
                ))}
              </div>
            </div>
          )}

          {files.length > 0 && (
            <div>
              <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '6px', fontWeight: 500 }}>Files</div>
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
                    {highlight(file)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Search() {
  const [query, setQuery] = useState('');

  // Load all observations for client-side search
  const { data, loading, error } = useApi<ObservationsResponse>(
    '/data/observations',
    { project: '', limit: '200' },
  );

  const allObservations = data?.observations ?? [];

  // Client-side filtering
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return allObservations.filter((obs: ObservationRow) => {
      if (obs.title.toLowerCase().includes(q)) return true;
      const facts = parseJsonArray(obs.facts);
      if (facts.some((f) => f.toLowerCase().includes(q))) return true;
      const concepts = parseJsonArray(obs.concepts);
      if (concepts.some((c) => c.toLowerCase().includes(q))) return true;
      const files = parseJsonArray(obs.files_affected);
      if (files.some((f) => f.toLowerCase().includes(q))) return true;
      if (obs.type.toLowerCase().includes(q)) return true;
      if (obs.project.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [query, allObservations]);

  return (
    <div style={baseStyles.page}>
      <h2 style={baseStyles.pageTitle}>Search</h2>

      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Search observations by title, facts, concepts, files..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={baseStyles.input}
          autoFocus
        />
      </div>

      {loading && <div style={baseStyles.loadingState}>Loading data...</div>}
      {error && <div style={baseStyles.errorState}>{error}</div>}

      {!loading && !error && query.trim() && (
        <div style={{ fontSize: '13px', color: colors.textSecondary, marginBottom: '16px' }}>
          {results.length} result{results.length !== 1 ? 's' : ''} for "{query}"
        </div>
      )}

      {!loading && !error && !query.trim() && (
        <div style={baseStyles.emptyState}>
          Type a search query to find observations.
        </div>
      )}

      {!loading && !error && query.trim() && results.length === 0 && (
        <div style={baseStyles.emptyState}>
          No observations matching "{query}".
        </div>
      )}

      {results.map((obs) => (
        <SearchResultCard key={obs.id} obs={obs} query={query} />
      ))}
    </div>
  );
}
