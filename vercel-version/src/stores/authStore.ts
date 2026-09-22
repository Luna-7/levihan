import { create } from 'zustand';
import { CLOUDBASE_API_BASE, fetchBackend } from '../utils/cloudbaseEndpoint';
import { getSessionToken, setSessionToken, type AuthProfile } from '../utils/cloudbaseToken';
import { clearVerifiedComicCode } from '../utils/secureComicCode';
import { clearDoujinSessionUnlock } from '../utils/doujinAccess';

export type AuthQuestion = { id: string; prompt: string; options: string[] };

type AuthState = {
  profile: AuthProfile | null;
  hasSession: boolean;
  isLoading: boolean;
  isBusy: boolean;
  initialized: boolean;
  refreshProfile: () => Promise<AuthProfile | null>;
  requestChallenge: () => Promise<{ question: AuthQuestion; challengeId: string }>;
  answerChallenge: (challengeId: string, answer: string) => Promise<{ correct: boolean; ticket?: string; exhausted?: boolean; message?: string }>;
  register: (ticket: string, nickname: string, password: string) => Promise<void>;
  login: (nickname: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateNickname: (nickname: string) => Promise<void>;
};

type AuthResponse = {
  token?: string;
  profile?: AuthProfile;
  nickname?: string;
  question?: AuthQuestion;
  challengeId?: string;
  correct?: boolean;
  ticket?: string;
  exhausted?: boolean;
  message?: string;
};

const postAuth = async (action: string, body: Record<string, unknown>, token?: string | null): Promise<AuthResponse> => {
  const headers: Record<string, string> = { 'Content-Type': 'text/plain;charset=UTF-8' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetchBackend(`${CLOUDBASE_API_BASE}/auth`, {
      method: 'POST', headers, body: JSON.stringify({ action, ...body }), signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('账号服务连接超时，请检查网络后重试');
    if (error instanceof TypeError) throw new Error('无法连接账号服务，请检查网络后重试');
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    const error = new Error(result?.message || '账号服务暂时不可用，请稍后重试') as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return result as AuthResponse;
};

let revision = 0;
let refreshPromise: Promise<AuthProfile | null> | null = null;
let refreshToken: string | null = null;
let refreshRevision = -1;
const initialToken = getSessionToken();

export const useAuthStore = create<AuthState>((set, get) => ({
  profile: null,
  hasSession: Boolean(initialToken),
  isLoading: Boolean(initialToken),
  isBusy: false,
  initialized: !initialToken,

  refreshProfile: () => {
    const token = getSessionToken();
    if (refreshPromise && refreshToken === token && refreshRevision === revision) return refreshPromise;
    if (!token) {
      set({ profile: null, hasSession: false, isLoading: false, initialized: true });
      return Promise.resolve(null);
    }
    const startedAt = revision;
    set({ hasSession: true, isLoading: true });
    refreshToken = token;
    refreshRevision = startedAt;
    const request = (async () => {
      try {
        const result = await postAuth('me', {}, token);
        if (!result.profile) throw new Error('账号档案读取失败');
        if (revision === startedAt && getSessionToken() === token) {
          set({ profile: result.profile, hasSession: true, initialized: true });
        }
        return result.profile;
      } catch (error) {
        if (revision === startedAt && getSessionToken() === token) {
          const status = (error as { status?: number })?.status;
          if (status === 401 || status === 403) {
            setSessionToken(null);
            clearVerifiedComicCode();
            clearDoujinSessionUnlock();
            revision += 1;
            set({ profile: null, hasSession: false, isLoading: false });
          }
          // 网络故障或服务端 5xx 时保留已有身份，等待下次刷新。
          set({ initialized: true });
        }
        return get().profile;
      } finally {
        if (revision === startedAt) set({ isLoading: false });
        if (refreshPromise === request) {
          refreshPromise = null;
          refreshToken = null;
          refreshRevision = -1;
        }
      }
    })();
    refreshPromise = request;
    return request;
  },

  requestChallenge: async () => {
    set({ isBusy: true });
    try {
      const result = await postAuth('challenge', {});
      if (!result.question || !result.challengeId) throw new Error('答题服务返回的数据不完整');
      return { question: result.question, challengeId: result.challengeId };
    } finally { set({ isBusy: false }); }
  },

  answerChallenge: async (challengeId, answer) => {
    set({ isBusy: true });
    try {
      const result = await postAuth('answer', { challengeId, answer });
      return {
        correct: Boolean(result.correct), ticket: result.ticket,
        exhausted: result.exhausted, message: result.message,
      };
    } finally { set({ isBusy: false }); }
  },

  register: async (ticket, nickname, password) => {
    set({ isBusy: true });
    try {
      const result = await postAuth('register', { ticket, nickname, password });
      if (!result.token || !result.profile) throw new Error('注册成功，但会话数据不完整');
      revision += 1;
      setSessionToken(result.token);
      set({ profile: result.profile, hasSession: true, isLoading: false, initialized: true });
    } finally { set({ isBusy: false }); }
  },

  login: async (nickname, password) => {
    set({ isBusy: true });
    try {
      const result = await postAuth('login', { nickname, password });
      if (!result.token || !result.profile) throw new Error('登录成功，但会话数据不完整');
      revision += 1;
      setSessionToken(result.token);
      set({ profile: result.profile, hasSession: true, isLoading: false, initialized: true });
    } finally { set({ isBusy: false }); }
  },

  logout: async () => {
    set({ isBusy: true });
    try {
      const token = getSessionToken();
      if (token) {
        try { await postAuth('logout', {}, token); } catch { /* 本地仍须退出 */ }
      }
      revision += 1;
      setSessionToken(null);
      clearVerifiedComicCode();
      clearDoujinSessionUnlock();
      set({ profile: null, hasSession: false, isLoading: false, initialized: true });
    } finally { set({ isBusy: false }); }
  },

  updateNickname: async (nickname) => {
    const token = getSessionToken();
    if (!token) throw new Error('请先登录账号');
    set({ isBusy: true });
    try {
      const result = await postAuth('update-nickname', { nickname }, token);
      if (getSessionToken() !== token) throw new Error('登录状态已变化，请重新操作');
      revision += 1;
      const current = get().profile;
      if (current) set({ profile: { ...current, nickname: result.nickname || nickname } });
      // 服务端的 me 仍是完整档案的权威来源；请求失败时保留已确认的新昵称。
      await get().refreshProfile();
    } finally { set({ isBusy: false }); }
  },
}));
