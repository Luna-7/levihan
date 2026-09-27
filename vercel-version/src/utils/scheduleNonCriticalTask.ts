/**
 * 把首页非关键网络请求放到首屏提交之后。
 * iOS Safari 没有 requestIdleCallback，因此用短延时兜底；两种路径都可取消，
 * 避免组件在 Tab 切换卸载后继续启动跨域请求。
 */
export function scheduleNonCriticalTask(task: () => void, delayMs = 600): () => void {
  let cancelled = false;
  let idleId: number | null = null;
  let waitingForVisible = false;
  const runWhenVisible = () => {
    waitingForVisible = false;
    if (cancelled) return;
    if (document.visibilityState !== 'visible') {
      if (!waitingForVisible) {
        waitingForVisible = true;
        document.addEventListener('visibilitychange', runWhenVisible, { once: true });
      }
      return;
    }
    waitingForVisible = false;
    task();
  };
  const timer = window.setTimeout(() => {
    if (window.requestIdleCallback) {
      idleId = window.requestIdleCallback(runWhenVisible, { timeout: 1500 });
    } else {
      idleId = window.setTimeout(runWhenVisible, 80);
    }
  }, delayMs);

  return () => {
    cancelled = true;
    document.removeEventListener('visibilitychange', runWhenVisible);
    window.clearTimeout(timer);
    if (idleId !== null) {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idleId);
      else window.clearTimeout(idleId);
    }
  };
}
