import { useEffect, useState } from 'react';
import { useHashRoute, useApi } from './hooks.js';
import { colors, formatUptime } from './theme.js';
import { Timeline } from './views/Timeline.js';
import { Sessions } from './views/Sessions.js';
import { Search } from './views/Search.js';
import { Reflections } from './views/Reflections.js';
import { Profile } from './views/Profile.js';
import { Settings } from './views/Settings.js';
import { Metrics } from './views/Metrics.js';
import { Entities } from './views/Entities.js';
import type { HealthResponse, VersionResponse } from './types.js';

// Navigation items
const NAV_ITEMS = [
  { key: 'timeline', label: 'Timeline', icon: '\uD83D\uDCCB' },
  { key: 'sessions', label: 'Sessions', icon: '\u23F1\uFE0F' },
  { key: 'search', label: 'Search', icon: '\uD83D\uDD0D' },
  { key: 'entities', label: 'Entities', icon: '\uD83D\uDD17' },
  { key: 'reflections', label: 'Reflections', icon: '\uD83D\uDCA1' },
  { key: 'profile', label: 'Profile', icon: '\uD83D\uDC64' },
  { key: 'settings', label: 'Settings', icon: '\u2699\uFE0F' },
  { key: 'metrics', label: 'Metrics', icon: '\uD83D\uDCCA' },
] as const;

// Route to component mapping
function renderView(route: string): React.ReactNode {
  switch (route) {
    case 'timeline':
      return <Timeline />;
    case 'sessions':
      return <Sessions />;
    case 'search':
      return <Search />;
    case 'entities':
      return <Entities />;
    case 'reflections':
      return <Reflections />;
    case 'profile':
      return <Profile />;
    case 'settings':
      return <Settings />;
    case 'metrics':
      return <Metrics />;
    default:
      return <Timeline />;
  }
}

function HealthIndicator() {
  const { data: health } = useApi<HealthResponse>('/health', undefined, 15_000);
  const { data: version } = useApi<VersionResponse>('/version');

  const isHealthy = health?.status === 'ok';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {/* Status dot */}
      <div
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: isHealthy ? colors.accentGreen : colors.accentRed,
          boxShadow: isHealthy ? `0 0 6px ${colors.accentGreen}60` : `0 0 6px ${colors.accentRed}60`,
        }}
      />
      <span style={{ fontSize: '12px', color: colors.textSecondary }}>
        {isHealthy
          ? `Up ${formatUptime(health?.uptime ?? 0)}`
          : 'Connecting...'}
      </span>
      {version && (
        <span style={{ fontSize: '11px', color: colors.textMuted }}>
          v{version.version}
        </span>
      )}
    </div>
  );
}

function Sidebar({ activeRoute }: { activeRoute: string }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <nav
      style={{
        width: collapsed ? '52px' : '200px',
        minHeight: '100vh',
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s ease',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Brand header */}
      <div
        style={{
          padding: collapsed ? '16px 12px' : '16px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          minHeight: '56px',
        }}
      >
        {!collapsed && (
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: colors.textPrimary, letterSpacing: '0.5px' }}>
              Smriti
            </div>
            <div style={{ fontSize: '11px', color: colors.textMuted }}>
              Memory Dashboard
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: 'none',
            border: 'none',
            color: colors.textSecondary,
            cursor: 'pointer',
            fontSize: '14px',
            padding: '4px',
            lineHeight: 1,
          }}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '\u25B6' : '\u25C0'}
        </button>
      </div>

      {/* Nav items */}
      <div style={{ flex: 1, padding: '8px' }}>
        {NAV_ITEMS.map((item) => {
          const isActive = activeRoute === item.key;
          return (
            <a
              key={item.key}
              href={`#${item.key}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: collapsed ? '10px 12px' : '10px 12px',
                borderRadius: '6px',
                textDecoration: 'none',
                color: isActive ? colors.textPrimary : colors.textSecondary,
                background: isActive ? `${colors.accentBlue}15` : 'transparent',
                borderLeft: isActive ? `2px solid ${colors.accentBlue}` : '2px solid transparent',
                marginBottom: '2px',
                fontSize: '14px',
                transition: 'background 0.15s, color 0.15s',
                justifyContent: collapsed ? 'center' : 'flex-start',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = colors.surfaceHover;
                  (e.currentTarget as HTMLElement).style.color = colors.textPrimary;
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = colors.textSecondary;
                }
              }}
              title={collapsed ? item.label : undefined}
            >
              <span style={{ fontSize: '16px', width: '20px', textAlign: 'center' }}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </a>
          );
        })}
      </div>

      {/* Health indicator at bottom */}
      {!collapsed && (
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${colors.border}` }}>
          <HealthIndicator />
        </div>
      )}
    </nav>
  );
}

export function App() {
  const route = useHashRoute();

  // Set default hash if none
  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = 'timeline';
    }
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: colors.bg,
        color: colors.textPrimary,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
        fontSize: '14px',
        lineHeight: '1.5',
      }}
    >
      <Sidebar activeRoute={route} />

      <main
        style={{
          flex: 1,
          overflow: 'auto',
          minWidth: 0,
        }}
      >
        {renderView(route)}
      </main>
    </div>
  );
}
