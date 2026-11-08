/**
 * PWA 主动检测更新
 *
 * VitePWA 的 registerType:'autoUpdate' 会让新 Service Worker 激活并重载已打开页面。
 * 这个模块负责在前台、聚焦、恢复联网时主动调用 registration.update()。
 *
 * 激活与页面重载由插件处理；这里低频触发更新检查。
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
