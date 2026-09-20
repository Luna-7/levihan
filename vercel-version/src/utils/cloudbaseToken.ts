import { CLOUDBASE_API_BASE } from './cloudbaseEndpoint';

/**
 * 自建会话 token 的存取（替代 CloudBase 内置 auth()）。
 *
 * 登录/注册成功后，auth 云函数返回不透明 session token，前端存 localStorage，
 * 后续请求带 `Authorization: Bearer <token>` 头。服务端只存 SHA-256 哈希。
 */

const TOKEN_KEY = 'levihan.sessionToken.v1';

export function getSessionToken(): string | null {
  try {
    const token = window.localStorage.getItem(TOKEN_KEY);
    return token && typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 私密模式忽略 */
  }
}

export type AuthProfile = { uid: string; nickname: string; role?: string; createdAt?: string };

/** 用 text/plain 发送，避开浏览器对 application/json 的 CORS 预检 */
async function postAuth(action: string, body: Record<string, unknown>, token?: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'text/plain;charset=UTF-8' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${CLOUDBASE_API_BASE}/auth`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...body }),
  });
  const result = await response.json().catch(() => null);
  return { status: response.status, result };
}

/**
 * 取当前登录态的 session token（用于传给 admin-upload 等 HTTP 云函数做身份绑定）。
 * 未登录返回 null。命名保留 getAccessToken 以兼容现有调用点。
 */
export async function getAccessToken(): Promise<string | null> {
  return getSessionToken();
}

/**
 * 取当前登录用户档案（uid/nickname/role）。凭自建 token 调 auth 的 me。
 * 未登录或 token 失效返回 null。
 */
export async function getCurrentProfile(): Promise<AuthProfile | null> {
  const token = getSessionToken();
  if (!token) return null;
  try {
    const { result } = await postAuth('me', {}, token);
    if (result?.ok && result.profile) return result.profile as AuthProfile;
    return null;
  } catch {
    return null;
  }
}

/**
 * 取当前登录用户 uid（uuid）。凭自建 token 调 auth 的 me。
 * 未登录返回 null。
 */
export async function getCurrentUid(): Promise<string | null> {
  const profile = await getCurrentProfile();
  return profile?.uid || null;
}
