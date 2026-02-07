// API client for the Smriti worker (same-origin requests)

const BASE_URL = window.location.origin;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function fetchApi<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, value);
      }
    }
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new ApiError(response.status, `API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

export async function putApi<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const url = new URL(path, BASE_URL);

  const response = await fetch(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new ApiError(response.status, `API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

export async function postApi<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const url = new URL(path, BASE_URL);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new ApiError(response.status, `API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

export async function deleteApi<T>(
  path: string,
): Promise<T> {
  const url = new URL(path, BASE_URL);

  const response = await fetch(url.toString(), {
    method: 'DELETE',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new ApiError(response.status, `API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

// Convenience functions for each endpoint
export const api = {
  getSessions: (project: string, limit = 20) =>
    fetchApi<{ sessions: any[] }>('/data/sessions', { project, limit: String(limit) }),

  getObservations: (project: string, limit = 50, branch?: string) =>
    fetchApi<{ observations: any[] }>('/data/observations', {
      project,
      limit: String(limit),
      ...(branch ? { branch } : {}),
    }),

  getReflections: (project: string, type?: string, limit = 20) =>
    fetchApi<{ reflections: any[] }>('/data/reflections', {
      project,
      limit: String(limit),
      ...(type ? { type } : {}),
    }),

  getProfile: (project: string, category?: string) =>
    fetchApi<{ entries: any[] }>('/data/profile', {
      project,
      ...(category ? { category } : {}),
    }),

  getLinks: (observationId: number) =>
    fetchApi<{ links: any[] }>('/data/links', { observationId: String(observationId) }),

  getSettings: () => fetchApi<any>('/settings'),

  updateSettings: (settings: any) => putApi<{ updated: boolean }>('/settings', settings),

  getHealth: () => fetchApi<{ status: string; uptime: number }>('/health'),

  getVersion: () => fetchApi<{ version: string }>('/version'),
};
