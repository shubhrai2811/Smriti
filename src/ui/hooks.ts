import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchApi } from './api.js';

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Generic hook for fetching data from the API with optional polling.
 * @param path - API path (e.g. '/data/sessions')
 * @param params - Query parameters
 * @param interval - Polling interval in ms (0 = no polling)
 */
export function useApi<T>(path: string, params?: Record<string, string>, interval = 0): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const paramsRef = useRef(params);

  // Update params ref to avoid stale closures in the interval
  paramsRef.current = params;

  const fetchData = useCallback(async () => {
    try {
      const result = await fetchApi<T>(path, paramsRef.current);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    fetchData();

    if (interval > 0) {
      const id = setInterval(fetchData, interval);
      return () => clearInterval(id);
    }
  }, [fetchData, interval]);

  // Re-fetch when params change (compare serialized)
  const _serializedParams = params ? JSON.stringify(params) : '';
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

/**
 * Hook to get and track the current hash route.
 */
export function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || 'timeline');

  useEffect(() => {
    const handler = () => {
      setRoute(window.location.hash.slice(1) || 'timeline');
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  return route;
}

/**
 * Simple toggle hook.
 */
export function useToggle(initial = false): [boolean, () => void] {
  const [value, setValue] = useState(initial);
  const toggle = useCallback(() => setValue((v) => !v), []);
  return [value, toggle];
}

/**
 * Hook for Server-Sent Events (SSE) with auto-reconnect.
 * @param path - SSE endpoint path (e.g. '/data/events')
 * @param onEvent - Callback for each event: (eventName, data) => void
 * @param params - Query parameters for the SSE endpoint
 */
export function useSSE(
  path: string,
  onEvent: (event: string, data: unknown) => void,
  params?: Record<string, string>,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const url = new URL(path, window.location.origin);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value) url.searchParams.set(key, value);
      }
    }

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource(url.toString());

      es.addEventListener('connected', () => {
        setConnected(true);
      });

      es.addEventListener('observation:new', (e) => {
        try {
          const data = JSON.parse(e.data);
          onEventRef.current('observation:new', data);
        } catch {
          /* ignore */
        }
      });

      es.addEventListener('session:complete', (e) => {
        try {
          const data = JSON.parse(e.data);
          onEventRef.current('session:complete', data);
        } catch {
          /* ignore */
        }
      });

      es.addEventListener('reflection:new', (e) => {
        try {
          const data = JSON.parse(e.data);
          onEventRef.current('reflection:new', data);
        } catch {
          /* ignore */
        }
      });

      es.onerror = () => {
        setConnected(false);
        es?.close();
        // Auto-reconnect after 5 seconds
        reconnectTimer = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      setConnected(false);
    };
  }, [path, params]);

  return { connected };
}
