/**
 * CloudBase 云函数（HTTP 访问服务）地址的唯一出口。
 *
 * 为什么本地开发不直连真实域名：
 * admin-upload / auth 都用 http 访问服务暴露，
 * 云函数的 ALLOWED_ORIGINS 只认 levihan.asia / www / admin / localhost:5173 / localhost:4173。
 * 而 `npm run dev` 跑在 localhost:3000（`--host=0.0.0.0` 时还有局域网 IP），
 * 浏览器跨域会被云函数回落的 ACAO 头挡下，报 TypeError: Failed to fetch，
 * 表现就是「后台明明有公告，前台一直空白」，登录注册也会一起失效。
 *
 * 解法：开发态改走同源的 /__cf 前缀，由 vite.config.ts 的 server.proxy 服务端转发到真实域名。
 * 服务端转发不带 Origin，因此不受白名单限制，且对任意端口 / 局域网 IP 都成立。
 * 生产构建时 import.meta.env.DEV 为 false，仍直连真实域名，行为不变。
 */
const CLOUDBASE_ORIGIN = 'https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com';

/** 本地开发的代理前缀，需与 vite.config.ts 的 server.proxy 键保持一致 */
const DEV_PROXY_PREFIX = '/__cf';

export const CLOUDBASE_API_BASE = import.meta.env.DEV ? DEV_PROXY_PREFIX : CLOUDBASE_ORIGIN;

/** admin-upload 云函数入口：公告 / 论坛 / 市集 / 投稿收件箱 / 头号玩家排行榜都走它 */
export const ADMIN_UPLOAD_ENDPOINT = `${CLOUDBASE_API_BASE}/admin-upload`;

/**
 * CloudBase 停用开关。
 *
 * 用途：CloudBase 环境欠费停服、或站点决定只保留 COS 静态资源时，
 * 把「互动层」（登录 / 论坛 / 评论 / 市集 / 排行榜 / 投稿）整体断掉——
 * 这些请求会**立即失败**，而不是发一个注定 400 的请求再干等 15 秒超时，
 * 否则首页会卡在拉取公告上，连游戏和漫画都进不去。
 *
 * 用法：默认**开启**。若再次遇到欠费停服、需要临时断开互动层保住首页时，
 * 构建时设 `VITE_CLOUDBASE_ENABLED=false` 即可，无需改代码。
 *
 * 注意：漫画 / 小说 / 游戏本体不经过云函数，图片走 COS 直链，
 * 因此即使关掉这个开关，「玩游戏 + 看漫画」也不受影响。
 */
export const CLOUDBASE_ENABLED = import.meta.env.VITE_CLOUDBASE_ENABLED !== 'false';

/** 后端被开关停用时的专用错误，便于调用方区分「停用了」和「网络坏了」 */
export class BackendUnavailableError extends Error {
  constructor(message = '互动功能已停用') {
    super(message);
    this.name = 'BackendUnavailableError';
  }
}

/**
 * 全站统一的后端请求入口。所有原本直接 `fetch(ADMIN_UPLOAD_ENDPOINT, ...)` 的调用
 * 都已改走这里，以便在开关关闭时立即失败。
 */
export async function fetchBackend(input: string, init?: RequestInit): Promise<Response> {
  if (!CLOUDBASE_ENABLED) throw new BackendUnavailableError();
  return fetch(input, init);
}
