import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import type { ApiSuccess, Paged } from './types';

/**
 * Access token lives in memory only. The refresh token is an httpOnly,
 * SameSite=Strict cookie scoped to /api/auth that page scripts can't read,
 * so an XSS bug can't exfiltrate a long-lived credential.
 */
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => {
    accessToken = t;
  },
  onSessionLost: (fn: () => void) => {
    onSessionLost = fn;
  },
};

export const http = axios.create({ baseURL: '/api', withCredentials: true, timeout: 30_000 });

http.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

/** One refresh at a time: concurrent 401s wait for the same rotation (the server detects token reuse). */
export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= axios
    .post<ApiSuccess<{ accessToken: string }>>('/api/auth/refresh', {}, { withCredentials: true })
    .then((r) => {
      accessToken = r.data.data.accessToken;
      return accessToken;
    })
    .catch(() => {
      accessToken = null;
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

const RETRYABLE = new Set(['TOKEN_EXPIRED', 'INVALID_TOKEN', 'UNAUTHENTICATED']);

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<{ code?: string }>) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const code = error.response?.data?.code;
    if (error.response?.status === 401 && original && !original._retried && !original.url?.startsWith('/auth/') && RETRYABLE.has(code ?? '')) {
      original._retried = true;
      const token = await refreshAccessToken();
      if (token) return http(original);
    }
    if (error.response?.status === 401 && !original?.url?.startsWith('/auth/login')) onSessionLost?.();
    return Promise.reject(error);
  },
);

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as { code?: string; message?: string; details?: unknown } | undefined;
    if (!err.response) return new ApiError('NETWORK', err.message);
    // A gateway/proxy error page (API down or restarting) is not an API response: treat it as unreachable.
    if (!body?.code && err.response.status >= 500) return new ApiError('NETWORK', err.message, err.response.status);
    return new ApiError(body?.code ?? 'INTERNAL_ERROR', body?.message ?? err.message, err.response.status, body?.details);
  }
  return new ApiError('INTERNAL_ERROR', String(err));
}

/** Unwraps `{ success, data }`. */
export async function api<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const r = await http.request<ApiSuccess<T>>(config);
    return r.data.data;
  } catch (e) {
    throw toApiError(e);
  }
}

/** For list endpoints: returns items plus pagination meta. */
export async function apiPage<T>(url: string, params?: Record<string, unknown>): Promise<Paged<T>> {
  try {
    const r = await http.get<ApiSuccess<T[]>>(url, { params: clean(params) });
    return { items: r.data.data, meta: r.data.meta! };
  } catch (e) {
    throw toApiError(e);
  }
}

/** Drops empty filter values so they don't reach the query string. */
export function clean(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params) return undefined;
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}
