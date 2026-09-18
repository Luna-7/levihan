/**
 * PWA 自动检测更新 + 实时启用
 *
 * 背景：vite.config.ts 里 VitePWA 的 registerType:'autoUpdate' 会让新 Service Worker
 * 通过 skipWaiting + clientsClaim 立即激活并接管页面，但**已打开的页面不会自动刷新**，
 * 用户会一直停在旧版本上，直到自己手动刷新。这里补上缺口：
 *
 *  1. controllerchange → 弹「新版本」提示并自动重载（首次安装除外）
 *  2. 主动检测：60s 定时（仅前台且联网时）+ 回前台 / 聚焦 / 恢复联网时 registration.update()
 *  3. 兜底：万一新 SW 进入 waiting（未自动 skipWaiting），主动发 SKIP_WAITING 消息
 *
 * dev 模式下 vite-plugin-pwa 不产出 Service Worker，本模块所有调用都是空操作。
 */

const CHECK_INTERVAL_MS = 60 * 1000;
const RELOAD_DELAY_MS = 1200;

const showToast = (text: string) => {
  try {
    const el = document.createElement('div');
    el.textContent = text;
    el.setAttribute('style', [
      'position:fixed',
      'top:calc(env(safe-area-inset-top, 0px) + 14px)',
      'left:50%',
      'transform:translateX(-50%) translateY(-8px)',
      'z-index:9999',
      'padding:10px 18px',
      'background:#1E4334',
      'color:#F9E79F',
      'border:2px solid #153025',
      'box-shadow:4px 4px 0 rgba(21,48,37,.35)',
      'font:bold 13px/1.4 "DotGothic16","Noto Sans SC",sans-serif',
      'letter-spacing:.05em',
      'white-space:nowrap',
      'opacity:0',
      'transition:opacity .25s ease, transform .25s ease',
      'pointer-events:none',
    ].join(';'));
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
  } catch {
    // Toast 失败不影响刷新本身
  }
};

export function setupPwaAutoUpdate() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;

  // 页面加载时是否已被某个 SW 控制：首装时 controller 为空，
  // 此时触发的 controllerchange 是「首次接管」，不算更新，绝不能刷新。
  const hadControllerAtLoad = Boolean(sw.controller);
  let refreshing = false;

  sw.addEventListener('controllerchange', () => {
    if (!hadControllerAtLoad || refreshing) return;
    refreshing = true;
    showToast('✦ 检测到新版本，正在启用…');
    window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
  });

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

  // 兜底：正常情况下 autoUpdate 会让新 SW 直接激活，
  // 若环境异常出现 waiting SW，主动促其接管（随后同样走 controllerchange 重载）。
  void sw.ready.then((reg) => {
    const nudge = (worker: ServiceWorker | null) => {
      if (worker && sw.controller) worker.postMessage({ type: 'SKIP_WAITING' });
    };
    nudge(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed') nudge(installing);
      });
    });
  }).catch(() => undefined);
}
