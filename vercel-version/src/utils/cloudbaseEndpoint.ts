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
