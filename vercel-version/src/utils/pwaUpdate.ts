/**
 * PWA 主动检测更新
 *
 * 背景：vite.config.ts 里 VitePWA 的 registerType:'autoUpdate' 会让新 Service Worker
 * 通过 skipWaiting + clientsClaim 立即激活并接管页面，但**已打开的页面不会自动刷新**，
 * 用户会一直停在旧版本上，直到自己手动刷新。这里补上缺口：
 *
 * 激活与刷新由 Workbox skipWaiting/clientsClaim + index.html 的首屏脚本负责；这里
 * 只负责在前台、聚焦、恢复联网时低频调用 registration.update()。这样不会渲染
 * 更新 UI，也不会与首屏 controllerchange 监听器重复刷新。
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
