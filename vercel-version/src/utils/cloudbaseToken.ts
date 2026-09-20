import { cloudbase } from './cloudbase';

/**
 * 取当前 CloudBase 登录态的 access_token（JWT），用于传给 admin-upload
 * 这类 HTTP 云函数做「发布/删除需登录 + 只能操作自己内容」的身份绑定。
 * 未登录返回 null。
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    const auth = cloudbase.auth();
    if (typeof auth.getAccessToken !== 'function') return null;
    const token = await auth.getAccessToken();
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

/**
 * 取当前登录用户的 uid（lh_<20位hex>）。通过 getUserAccount 云函数（网关注入身份）
 * 拿真实 uid，与后端 getUserInfoByAccessToken 返回的 uid 一致，可用于「是不是我发的」判断。
 * 未登录返回 null。
 */
export async function getCurrentUid(): Promise<string | null> {
  try {
    const user = await cloudbase.auth().getCurrentUser();
    if (!user) return null;
    const response = await cloudbase.callFunction({ name: 'getUserAccount', data: {} });
    const profile = (response?.result || response)?.profile;
    return typeof profile?.uid === 'string' && profile.uid ? profile.uid : null;
  } catch {
    return null;
  }
}

