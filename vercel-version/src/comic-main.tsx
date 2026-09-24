import { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ComicGate } from './components/ComicGate';
import { DoujinshiArchive } from './components/DoujinshiArchive';
import { soundManager } from './utils/audio';
import { setupIOSViewportGuard } from './utils/iosViewportGuard';
import './index.css';

// 漫画站是普通文档流滚动（没有主站「分区内部各自滚」的外壳），
// 而 index.css 为主站锁死了 html/body/#root 的滚动——
// 这里打上标记 class，让 CSS 只在漫画站放开滚动锁（见 index.css 的 .comic-site 规则）。
document.documentElement.classList.add('comic-site');
setupIOSViewportGuard();

/**
 * 漫画站独立入口（comic-main.tsx）。
 *
 * 部署到私有子域名（如 tudou.levihan.asia / lh3x9.levihan.asia），与宣发主站
 * 完全隔离：这里只有「漫画本」目录，没有游戏、茶会、排行榜、合订本、插画集。
 *
 * 整站入口由 ComicGate 守卫：打开即是一页仿真的 403 Forbidden，HTTP 仍是 200，
 * 不暴露「这是漫画站」的任何信息；群成员知道暗号（2.5 秒内连点「403」三次）才解锁。
 * 解锁态写入 sessionStorage，本次会话内刷新不重复，关标签页即失效。
 *
 * 不挂载主站的 App 外壳、authStore 登录态、Service Worker 主站缓存 ——
 * 漫画站是独立的轻量壳，iOS 上访问不会加载主站的游戏/立绘/动画。
 */
function ComicApp() {
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2800);
  }, []);

  const copyCode = useCallback((code: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(
        () => showToast(`已复制提取码：${code} 📋`),
        () => showToast(`提取码为：${code}`)
      );
    } else {
      showToast(`提取码为：${code}`);
    }
  }, [showToast]);

  return (
    <>
      <ComicGate>
        <DoujinshiArchive mode="comic" onShowToast={showToast} onCopyCode={copyCode} />
      </ComicGate>
      {toast && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-[2000] bg-[#FFFDF9] text-[#1E4334] border-2 border-[#5F977E] px-4 py-2 rounded-full shadow-[0_4px_16px_rgba(255,168,188,0.5)] font-retro-jp text-xs sm:text-sm flex items-center gap-2 animate-bounce max-w-[90vw]">
          <span className="text-base shrink-0">✨</span>
          <span className="truncate font-bold">{toast}</span>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ComicApp />
    </AppErrorBoundary>
  </StrictMode>
);

// 解锁后如有音频交互，确保音频上下文就绪（soundManager 惰性初始化，无副作用）。
void soundManager;
