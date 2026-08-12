// API client：baseURL + token 注入 + 401 自动刷新重试
import type { AuthTokens } from '@word-journey/shared';

const BASE = '/api';

// 认证状态（与 auth store 共享存储键）
export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  userId: number;
  username: string;
}

const STORAGE_KEY = 'wj-auth';

export function loadAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

export function saveAuth(auth: StoredAuth): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

export function clearAuth(): void {
  refreshInFlight = null;
  localStorage.removeItem(STORAGE_KEY);
}

// 简化错误类型
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

// 单飞刷新：并发 401 共享同一次 refresh，避免旧 token 被后发请求失效误登出
async function refreshOnce(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const auth = loadAuth();
  if (!auth?.refreshToken) return false;
  refreshInFlight = (async () => {
    try {
      return await tryRefresh(auth);
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function request<T>(
  path: string,
  init?: RequestInit & { token?: string; noRefresh?: boolean },
): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const auth = loadAuth();
    const token = init?.token ?? auth?.accessToken;
    return fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  };

  let res = await doFetch();
  if (res.status === 401 && !init?.noRefresh && loadAuth()?.refreshToken) {
    const ok = await refreshOnce();
    if (ok) {
      // doFetch 重新读 localStorage → 拿到刷新后的新 token
      res = await doFetch();
    }
  }
  if (!res.ok) {
    let msg = `请求失败(${res.status})`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (typeof body.message === 'string') msg = body.message;
      else if (Array.isArray(body.message)) msg = body.message.join('; ');
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

// 尝试用 refreshToken 换新 token，成功则更新存储
async function tryRefresh(auth: StoredAuth): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    });
    if (!res.ok) {
      clearAuth();
      return false;
    }
    const tokens = (await res.json()) as AuthTokens;
    saveAuth({ ...auth, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    return true;
  } catch {
    clearAuth();
    return false;
  }
}

export const api = {
  get: <T>(path: string, init?: RequestInit & { noRefresh?: boolean }) =>
    request<T>(path, { ...init, method: 'GET' }),
  post: <T>(path: string, body?: unknown, init?: RequestInit & { noRefresh?: boolean }) =>
    request<T>(path, { ...init, method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
};