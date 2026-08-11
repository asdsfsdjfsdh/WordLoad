// 认证状态：token 持久化 + 用户信息 + 角色
import { create } from 'zustand';
import type { AuthUser } from '@word-journey/shared';
import { api } from '../lib/api';
import { clearAuth, loadAuth, saveAuth } from '../lib/api';

interface AuthState {
  user: AuthUser | null;
  initialized: boolean;
  restore: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  initialized: false,

  restore: async () => {
    const stored = loadAuth();
    if (!stored) {
      set({ initialized: true });
      return;
    }
    try {
      const user = await api.get<AuthUser>('/auth/me');
      set({ user, initialized: true });
    } catch {
      // token 失效 → 交给下一次请求时刷新，刷新失败则登出
      set({ user: null, initialized: true });
    }
  },

  login: async (username, password) => {
    const r = await api.post<{ user: AuthUser; accessToken: string; refreshToken: string }>(
      '/auth/login',
      { username, password },
      { noRefresh: true },
    );
    saveAuth({
      accessToken: r.accessToken,
      refreshToken: r.refreshToken,
      userId: r.user.id,
      username: r.user.username,
    });
    set({ user: r.user });
  },

  register: async (username, password) => {
    const r = await api.post<{ user: AuthUser; accessToken: string; refreshToken: string }>(
      '/auth/register',
      { username, password },
      { noRefresh: true },
    );
    saveAuth({
      accessToken: r.accessToken,
      refreshToken: r.refreshToken,
      userId: r.user.id,
      username: r.user.username,
    });
    set({ user: r.user });
  },

  logout: () => {
    clearAuth();
    set({ user: null });
  },

  refreshUser: async () => {
    const user = await api.get<AuthUser>('/auth/me');
    set({ user });
  },
}));