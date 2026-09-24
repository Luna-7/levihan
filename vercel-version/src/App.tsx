import React, { useState, useEffect, Suspense } from 'react';
const Analytics = () => null;
import { RetroPixelFrame } from './components/RetroPixelFrame';
import { ImmersiveGameHome } from './components/ImmersiveGameHome';
import { GameStageLayout } from './components/GameStageLayout';
import { AdventureWorldBackground } from './components/AdventureWorldBackground';
import { AdventureBottomNav } from './components/AdventureBottomNav';
// 注：ResourceHub 不在这里静态引入 —— 它由 ImmersiveGameHome 用 React.lazy 按需加载。
// 静态 import 会让「巨人资源」整块（含漫画索引/小说/周边橱窗）落进首屏主包，别加回来。
import { ExquisiteStoryWorkshop } from './components/ExquisiteStoryWorkshop';
const DoujinshiArchive = React.lazy(() => import('./components/DoujinshiArchive').then(m => ({ default: m.DoujinshiArchive })));
const RestaurantForum = React.lazy(() => import('./components/RestaurantForum').then(m => ({ default: m.RestaurantForum })));
const DispatchHub = React.lazy(() => import('./components/DispatchHub').then(m => ({ default: m.DispatchHub })));
import { BackToTopButton } from './components/BackToTopButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { GROUP_INFO, POTATO_EGG_QUOTES } from './data/initialData';
import { soundManager } from './utils/audio';
import { NavigationTab } from './types';
import { useAppShellStore } from './stores/appShellStore';
import { cosService } from './services/cosClient';

/**
 * 导航分区与对应动态组件 Chunk 的预加载函数
 * 当用户在底部导航栏、今日上新或悬浮卡片悬停 (hover / touchstart) 时触发，
 * 异步拉取目标分区的 JS Chunk 与核心元数据，消除初次进入时的网络等待。
 */
export const preloadTabChunk = (tab: NavigationTab | string) => {
  switch (tab) {
    case 'resources': // 巨树餐厅 (同人典藏阁 & 小说本)
      void import('./components/DoujinshiArchive');
      void cosService.loadNovelList();
      break;
    case 'doujinshi': // 兵长茶会 (团长茶话会·同好茶室·接龙)
      void import('./components/RestaurantForum');
      break;
    case 'dispatch': // 调查联络 (飞鸽信使·投递反馈·营地)
      void import('./components/DispatchHub');
      break;
    case 'home': // 兵团驻地
      void import('./components/ImmersiveGameHome');
      break;
    default:
      break;
  }
};

const RestaurantLoadingSkeleton = () => (
  <div className="space-y-3 w-full animate-in fade-in duration-200">
    <div className="bg-[#FFFEEF]/80 backdrop-blur-md rounded-xl p-2.5 h-10 animate-pulse border border-[#D5C9AF]/60" />
    <div className="flex items-center gap-2">
      <div className="h-7 w-36 bg-[#1E4334]/20 rounded-lg animate-pulse" />
    </div>
    <div className="columns-2 gap-3.5 sm:gap-4.5 w-full animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="mb-3.5 break-inside-avoid bg-[#FFFEEF]/70 border border-[#D5C9AF]/60 rounded-xl p-4 space-y-2.5">
          <div className="flex gap-1.5">
            <div className="h-4 w-12 bg-[#D5C9AF]/40 rounded-xs" />
            <div className="h-4 w-10 bg-[#D5C9AF]/30 rounded-xs" />
          </div>
          <div className="h-5 w-4/5 bg-[#D5C9AF]/50 rounded-xs" />
          <div className="h-3 w-1/2 bg-[#D5C9AF]/30 rounded-xs" />
          <div className="h-10 w-full bg-[#D5C9AF]/20 rounded-xs" />
        </div>
      ))}
    </div>
  </div>
);

const TeaPartyLoadingSkeleton = () => (
  <div className="w-full h-full flex flex-col p-3 sm:p-4 space-y-3 animate-in fade-in duration-200">
    <div className="bg-[#FFFEEF]/80 backdrop-blur-md rounded-xl p-3 h-12 animate-pulse border border-[#D5C9AF]/60 flex items-center justify-between">
      <div className="h-6 w-32 bg-[#2D4F3B]/20 rounded-md" />
      <div className="h-6 w-20 bg-[#C5A059]/20 rounded-md" />
    </div>
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-[#FFFEEF]/75 border border-[#D5C9AF]/60 rounded-xl p-4 space-y-2.5 animate-pulse">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#D5C9AF]/40" />
            <div className="space-y-1 flex-1">
              <div className="h-4 w-1/3 bg-[#D5C9AF]/50 rounded-xs" />
              <div className="h-3 w-1/4 bg-[#D5C9AF]/30 rounded-xs" />
            </div>
          </div>
          <div className="h-4 w-4/5 bg-[#D5C9AF]/40 rounded-xs" />
          <div className="h-12 w-full bg-[#D5C9AF]/20 rounded-xs" />
        </div>
      ))}
    </div>
  </div>
);

const DispatchLoadingSkeleton = () => (
  <div className="w-full h-full flex flex-col p-3 sm:p-4 space-y-3 animate-in fade-in duration-200">
    <div className="bg-[#FFFEEF]/80 backdrop-blur-md rounded-xl p-3 h-12 animate-pulse border border-[#D5C9AF]/60 flex items-center justify-between">
      <div className="h-6 w-28 bg-[#16273B]/20 rounded-md" />
      <div className="h-6 w-16 bg-[#C5A059]/20 rounded-md" />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-[#FFFEEF]/75 border border-[#D5C9AF]/60 rounded-xl p-4 space-y-2.5">
          <div className="h-4 w-1/2 bg-[#D5C9AF]/50 rounded-xs" />
          <div className="h-14 w-full bg-[#D5C9AF]/20 rounded-xs" />
        </div>
      ))}
    </div>
  </div>
);

const TAB_INDEX_MAP: Partial<Record<NavigationTab, number>> = {
  home: 0,
  resources: 1,
  doujinshi: 2,
  dispatch: 3,
};

const ORDERED_TABS: NavigationTab[] = ['home', 'resources', 'doujinshi', 'dispatch'];

export default function App() {
  // Navigation State: 'home' | 'resources' | 'doujinshi' | 'dispatch'
  // 单一来源：appShellStore，支持 ?tab=<name> 深度直达，且 URL 与分区实时同步
  const activeTab = useAppShellStore((state) => state.activeTab);
  const navigate = useAppShellStore((state) => state.navigate);
  const pendingDoujinOpen = useAppShellStore((state) => state.pendingDoujinOpen);
  const showToast = useAppShellStore((state) => state.showToast);
  const toastMessage = useAppShellStore((state) => state.toast);

  // 保持已访问分区的挂载（同时预先挂载与「兵团驻地」相邻的「巨树餐厅」），
  // 杜绝滑动或切页时出现空白、二次重载或 DOM 闪烁
  const [visitedTabs, setVisitedTabs] = useState<Set<NavigationTab>>(() => new Set([activeTab, 'resources']));

  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  // 空闲预热排队策略：首屏 600ms 后静默预热最近的「巨树餐厅」及其小说索引；
  // 1800ms 后分步预热「茶会」和「联络」，确保用户随后交互时所有 chunk 均已处于本地缓存
  useEffect(() => {
    const t1 = window.setTimeout(() => {
      preloadTabChunk('resources');
    }, 600);
    const t2 = window.setTimeout(() => {
      preloadTabChunk('doujinshi');
      preloadTabChunk('dispatch');
    }, 1800);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  const handlePreloadTab = React.useCallback((tab: NavigationTab | string) => {
    preloadTabChunk(tab);
    if (tab === 'resources' || tab === 'doujinshi' || tab === 'dispatch' || tab === 'home') {
      setVisitedTabs((prev) => {
        if (prev.has(tab as NavigationTab)) return prev;
        const next = new Set(prev);
        next.add(tab as NavigationTab);
        return next;
      });
    }
  }, []);

  const isMounted = (tab: NavigationTab) => visitedTabs.has(tab);
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(soundManager.isMuted());

  const activeIndex = TAB_INDEX_MAP[activeTab] ?? 0;

  // 触屏侧滑手势支持（优化 iOS Safari 与 PWA 模式下的横向切页体验）
  const touchStartRef = React.useRef<{ x: number; y: number; time: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const isStandalone = typeof window !== 'undefined' && (
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    );

    // Safari 浏览器模式下保留系统边缘滑动手势（左右各 22px 避让），PWA 模式下全屏平滑切页
    if (!isStandalone) {
      if (touch.clientX < 22 || touch.clientX > window.innerWidth - 22) {
        return;
      }
    }

    // 检查是否从不可滑动的组件内部触发（弹窗、游戏画布、水平滚动容器、输入框等）
    let el = touch.target as HTMLElement | null;
    while (el && el !== e.currentTarget) {
      const role = el.getAttribute('role');
      if (
        role === 'dialog' ||
        role === 'alertdialog' ||
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'CANVAS' ||
        el.classList.contains('no-swipe') ||
        el.hasAttribute('data-no-swipe') ||
        (el.scrollWidth > el.clientWidth + 10 && (window.getComputedStyle(el).overflowX === 'auto' || window.getComputedStyle(el).overflowX === 'scroll'))
      ) {
        return;
      }
      el = el.parentElement;
    }

    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current || e.changedTouches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const deltaTime = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;

    // 限制单次手势最长 600ms，且水平位移明显大于垂直位移（防误触正常上下滚动）
    if (deltaTime > 600) return;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absX >= 45 && absX > absY * 1.3) {
      if (deltaX < 0 && activeIndex < ORDERED_TABS.length - 1) {
        // 向左滑：切到下一个 Tab
        handleNavigate(ORDERED_TABS[activeIndex + 1]);
      } else if (deltaX > 0 && activeIndex > 0) {
        // 向右滑：切到上一个 Tab
        handleNavigate(ORDERED_TABS[activeIndex - 1]);
      }
    }
  };

  const handleTouchCancel = () => {
    touchStartRef.current = null;
  };

  // 接龙合订本跳转意图：切换到巨树餐厅（同人典藏阁）。
  // 由 appShellStore.openDoujinArchive() 触发，取代 window 隐式事件。
  useEffect(() => {
    if (pendingDoujinOpen === 0) return;
    navigate('resources');
    // 依赖 navigate 会导致每次跳转都重跑；这里只关注意图信号的跳变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDoujinOpen]);

  const handleCopyGroupNumber = () => {
    soundManager.playCoin();
    const groupText = GROUP_INFO.qqGroups
      .map((g) => `${g.name}：${g.number}`)
      .join(' ');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(groupText).then(
        () => showToast(`已复制全部QQ群号！📋`),
        () => showToast(`QQ群：${groupText}`)
      );
    } else {
      showToast(`QQ群：${groupText}`);
    }
  };

  const handleCopyExtractionCode = (code: string) => {
    soundManager.playCoin();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(
        () => showToast(`已复制提取码：${code} 📋`),
        () => showToast(`提取码为：${code}`)
      );
    } else {
      showToast(`提取码为：${code}`);
    }
  };

  const handleToggleSound = () => {
    const muted = soundManager.toggleMute();
    setIsSoundMuted(muted);
    if (!muted) {
      soundManager.playCoin();
    }
    showToast(muted ? '已静音 🔇' : '已开启复古8位音效 🔊');
  };

  const handleNavigate = (tab: NavigationTab) => {
    soundManager.playNavClick();
    navigate(tab);
  };

  return (
    <main className="relative w-full h-[var(--app-h)] max-h-[var(--app-h)] pt-0 pb-0 px-0 flex flex-col items-center justify-start bg-transparent antialiased selection:bg-[#C5A059] selection:text-[#16273B] overflow-hidden">
      {/* 勇者大冒险 · 完全固定优雅羊皮纸背景 (固定不移动) */}
      <AdventureWorldBackground activeTab={activeTab} />

      {/* Offline Connectivity Status Badge */}
      <OfflineIndicator />

      {/* ====================================================
          卡片随着小人行军水平平移滑动层 (Card Follows Character Walking)
          4 个页面卡片横向平铺，随导航小人移动平滑平移切换
         ==================================================== */}
      <div
        className="relative z-10 w-full flex-1 min-h-0 overflow-hidden touch-pan-y"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        <div
          className="flex w-[400%] h-full transition-transform duration-350 ease-out"
          style={{
            transform: `translateX(-${activeIndex * 25}%)`,
          }}
        >
          {/* VIEW 1: 兵团驻地大厅 (完全固定，无滚轮) */}
          <div
            className={`w-1/4 shrink-0 h-full overflow-hidden transition-opacity duration-300 ${
              activeTab === 'home' ? 'opacity-100' : 'opacity-85 pointer-events-none'
            }`}
            aria-hidden={activeTab !== 'home'}
          >
            {isMounted('home') && <ImmersiveGameHome
              onNavigateTab={handleNavigate}
              onPreloadTab={handlePreloadTab}
              onShowToast={showToast}
              isSoundMuted={isSoundMuted}
              onToggleSound={handleToggleSound}
            />}
          </div>

          {/* VIEW 2: 巨树餐厅 (同人归档) */}
          <div
            className={`w-1/4 shrink-0 h-full overflow-hidden transition-opacity duration-300 ${
              activeTab === 'resources' ? 'opacity-100' : 'opacity-85 pointer-events-none'
            }`}
            aria-hidden={activeTab !== 'resources'}
          >
            {isMounted('resources') && <GameStageLayout
              activeTab="resources"
              onNavigateTab={handleNavigate}
              isSoundMuted={isSoundMuted}
              onToggleSound={handleToggleSound}
              onShowToast={showToast}
            >
              <Suspense fallback={<RestaurantLoadingSkeleton />}><DoujinshiArchive
                mode="main"
                onCopyCode={handleCopyExtractionCode}
                onShowToast={showToast}
              /></Suspense>
            </GameStageLayout>}
          </div>

          {/* VIEW 3: 团长茶话会 (同好茶室·故事接龙·安科创作) */}
          <div
            className={`w-1/4 shrink-0 h-full overflow-hidden transition-opacity duration-300 ${
              activeTab === 'doujinshi' ? 'opacity-100' : 'opacity-85 pointer-events-none'
            }`}
            aria-hidden={activeTab !== 'doujinshi'}
          >
            {isMounted('doujinshi') && <Suspense fallback={<TeaPartyLoadingSkeleton />}><RestaurantForum
              onBack={() => handleNavigate('home')}
              onShowToast={showToast}
            /></Suspense>}
          </div>

          {/* VIEW 4: 调查联络 (飞鸽信使·投递·讨论·营地) */}
          <div
            className={`w-1/4 shrink-0 h-full overflow-hidden transition-opacity duration-300 ${
              activeTab === 'dispatch' ? 'opacity-100' : 'opacity-85 pointer-events-none'
            }`}
            aria-hidden={activeTab !== 'dispatch'}
          >
            {isMounted('dispatch') && <GameStageLayout
              activeTab="dispatch"
              onNavigateTab={handleNavigate}
              isSoundMuted={isSoundMuted}
              onToggleSound={handleToggleSound}
              onShowToast={showToast}
            >
              <Suspense fallback={<DispatchLoadingSkeleton />}><DispatchHub onShowToast={showToast} /></Suspense>
            </GameStageLayout>}
          </div>
        </div>
      </div>

      {/* 勇者大冒险 · 底部行军路线与走动小人导航栏 (常驻底部，小人跑向对应地标) */}
      <AdventureBottomNav
        activeTab={activeTab}
        onNavigateTab={handleNavigate}
        onPreloadTab={handlePreloadTab}
      />

      {/* Floating Retro Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-22 sm:bottom-24 left-1/2 transform -translate-x-1/2 z-[2000] bg-[#FFFDF9] text-[#1E4334] border-2 border-[#5F977E] px-4 py-2 rounded-full shadow-[0_4px_16px_rgba(255,168,188,0.5)] font-retro-jp text-xs sm:text-sm flex items-center gap-2 animate-bounce max-w-[90vw]">
          <span className="text-base shrink-0">✨</span>
          <span className="truncate font-bold">{toastMessage}</span>
        </div>
      )}

      {/* Back to Top Floating Button */}
      {activeTab !== 'home' && <BackToTopButton />}

      {/* Vercel Analytics */}
      <Analytics />
    </main>
  );
}
