const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onUnauthorized: (() => void) | null = null;

/** Registered once by AuthProvider so the client can redirect to /login on a 401. */
export const setUnauthorizedHandler = (handler: () => void): void => {
  onUnauthorized = handler;
};

const getToken = (): string | null => localStorage.getItem('adminAccessToken');

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const token = getToken();
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    onUnauthorized?.();
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = data?.error ?? { code: 'UNKNOWN_ERROR', message: 'Request failed' };
    throw new ApiError(res.status, error.code, error.message);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Multipart upload — separate from `request` since it can't send a JSON body. */
export const uploadImage = async (file: File): Promise<{ imageUrl: string }> => {
  const form = new FormData();
  form.append('image', file);
  const token = getToken();

  const res = await fetch(`${API_BASE_URL}/admin/uploads/image`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });

  if (res.status === 401) onUnauthorized?.();

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = data?.error ?? { code: 'UNKNOWN_ERROR', message: 'Upload failed' };
    throw new ApiError(res.status, error.code, error.message);
  }
  return data as { imageUrl: string };
};

export const setToken = (token: string): void => localStorage.setItem('adminAccessToken', token);
export const clearToken = (): void => localStorage.removeItem('adminAccessToken');
export const hasToken = (): boolean => !!getToken();
