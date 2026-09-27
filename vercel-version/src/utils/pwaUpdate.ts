/**
 * PWA 主动检测更新
 *
 * 背景：vite.config.ts 里 VitePWA 的 registerType:'autoUpdate' 会让新 Service Worker
 * 通过 skipWaiting + clientsClaim 立即激活并接管后续请求。已打开页面不因
 * controllerchange 立即刷新，避免 iOS 首屏二次 reload；旧 chunk 404 由 HTML 内联
 * 错误监听器自愈，下一次 navigation 则使用后台更新后的 HTML。
 *
 * 激活由 Workbox skipWaiting/clientsClaim 负责；这里
 * 只负责在前台、聚焦、恢复联网时低频调用 registration.update()。这样不会渲染
 * 更新 UI，也不会触发首屏二次刷新。
 *
 * dev 模式下 vite-plugin-pwa 不产出 Service Worker，本模块所有调用都是空操作。
 */

const CHECK_INTERVAL_MS = 60 * 1000;
export function setupPwaAutoUpdate() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;

  const checkForUpdate = () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    sw.getRegistration()
      .then((reg) => reg?.update().catch(() => undefined))
      .catch(() => undefined);
  };

  window.addEventListener('focus', checkForUpdate);
  window.addEventListener('online', checkForUpdate);
  document.addEventListener('visibilitychange', checkForUpdate);
  window.setInterval(checkForUpdate, CHECK_INTERVAL_MS);

  // 首次渲染后空闲触发一次，不与首屏关键请求争抢网络/主线程。
  if (window.requestIdleCallback) {
    window.requestIdleCallback(checkForUpdate, { timeout: 3000 });
  } else {
    window.setTimeout(checkForUpdate, 2000);
  }
}
