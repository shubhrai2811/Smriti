import { useState, useEffect, useCallback, useRef } from 'react';
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
export function useApi<T>(
  path: string,
  params?: Record<string, string>,
  interval = 0,
): UseApiResult<T> {
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
  const serializedParams = params ? JSON.stringify(params) : '';
  useEffect(() => {
    fetchData();
  }, [serializedParams, fetchData]);

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
