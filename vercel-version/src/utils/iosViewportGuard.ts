/**
 * iOS 独立 PWA 视口守卫
 *
 * 背景（WebKit bug，2026 年仍在复现，见 https://webkit.org/b/262207）：
 * iOS 上「添加到主屏幕」的 PWA 在锁屏 / 切后台再回来时，WebKit 偶尔会丢掉
 * viewport-fit 与 mobile scaling 约束，回退到桌面虚拟视口（innerWidth 变成
 * 980px 甚至更大）。后果是整页按桌面宽度重新布局，元素相对屏幕急剧缩小，
 * 且 @media (max-width: 640px) 失效（html font-size 从 17px 掉回 16px）。
 * 这个状态不会自愈，只能强制 WebKit 重新计算视口。
 *
 * 策略：
 *  1. 以 screen 的最长边作为「健康的布局宽度上限」，正常情况下
 *     window.innerWidth 不可能超过它（横竖屏都不会）。
 *  2. 在启动、切回前台、转屏、resize 时检查；一旦 innerWidth 超过上限，
 *     就切换 viewport meta 的 content（去掉再补回 viewport-fit=cover），
 *     逼 WebKit 重新计算视口，之后验证是否恢复，未恢复则重试。
 *
 * 只在 iOS 上启用；其它平台该条件天然不成立，不会有任何副作用。
 */

const VIEWPORT_WITH_FIT = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
const VIEWPORT_FLAT = 'width=device-width, initial-scale=1.0';
const RECOVER_DELAY_MS = 80;
const VERIFY_DELAY_MS = 260;
const MAX_ATTEMPTS = 3;
let initialized = false;

function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** 布局视口宽度的健康上限：屏幕最长边（CSS px）。任何时刻 innerWidth 都不该超过它。 */
function maxLayoutWidth(): number {
  return Math.max(window.screen.width, window.screen.height);
}

function getViewportMeta(): HTMLMetaElement | null {
  return document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
}

export function setupIOSViewportGuard(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!isIOS()) return;
  if (initialized) return;
  initialized = true;

  const meta = getViewportMeta();
  if (!meta) return;

  let attempts = 0;
  let busy = false;
  let frame = 0;
  let editableFocused = false;

  const isBroken = (): boolean => window.innerWidth > maxLayoutWidth() + 1;

  const heal = (): void => {
    if (busy || !meta) return;
    busy = true;
    attempts += 1;

    // 先切到不带 viewport-fit 的写法，制造一次真实变更；再补回来。
    meta.setAttribute('content', VIEWPORT_FLAT);
    void document.documentElement.offsetWidth; // 强制同步 reflow
    window.setTimeout(() => {
      meta.setAttribute('content', VIEWPORT_WITH_FIT);
      window.setTimeout(() => {
        busy = false;
        if (isBroken() && attempts < MAX_ATTEMPTS) heal();
      }, VERIFY_DELAY_MS);
    }, RECOVER_DELAY_MS);
  };

  const syncAppHeight = (): void => {
    const isStandalone =
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    // iOS 键盘弹出时 visualViewport 会连续缩小。独立 PWA 若跟着改整个应用高度，
    // WebKit 很容易把外壳二次缩放，表现为输入框聚焦后整页突然变大。
    // 聚焦期间冻结外壳高度；普通 Safari 才跟随 visualViewport 的地址栏变化。
    if (isStandalone && editableFocused) return;
    const h = isStandalone
      ? window.innerHeight || document.documentElement.clientHeight
      : window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight;
    if (h) {
      document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
    }
  };

  const scheduleSync = (delay = 0): void => {
    window.setTimeout(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        syncAppHeight();
        if (isBroken()) heal();
      });
    }, delay);
  };

  const check = (): void => {
    syncAppHeight();
    // 修复成功后计数归零，保证后续再次变坏时仍有重试额度
    if (!isBroken()) {
      attempts = 0;
      return;
    }
    heal();
  };

  // 冷启动时就可能已经是坏视口
  check();
  window.addEventListener('load', check);
  window.addEventListener('pageshow', check);
  window.addEventListener('focus', check);
  window.addEventListener('orientationchange', () => scheduleSync(300), { passive: true });
  window.addEventListener('resize', () => scheduleSync(120), { passive: true });
  window.visualViewport?.addEventListener('resize', () => scheduleSync(), { passive: true });
  document.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement | null;
    editableFocused = !!target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    );
    document.documentElement.classList.toggle('ios-keyboard-open', editableFocused);
  });
  document.addEventListener('focusout', () => {
    editableFocused = false;
    document.documentElement.classList.remove('ios-keyboard-open');
    scheduleSync(320);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') window.setTimeout(check, 120);
  });
}
