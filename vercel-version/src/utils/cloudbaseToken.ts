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

/**
 * 取当前登录态的 session token（用于传给 admin-upload 等 HTTP 云函数做身份绑定）。
 * 未登录返回 null。命名保留 getAccessToken 以兼容现有调用点。
 */
export async function getAccessToken(): Promise<string | null> {
  return getSessionToken();
}
