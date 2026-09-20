import React, { useState, useRef, useCallback, useEffect } from 'react';
const Analytics = () => null;
import { RetroPixelFrame } from './components/RetroPixelFrame';
import { HeaderCard } from './components/HeaderCard';
import { ImmersiveGameHome } from './components/ImmersiveGameHome';
import { GameStageLayout } from './components/GameStageLayout';
import { AdventureWorldBackground } from './components/AdventureWorldBackground';
import { AdventureBottomNav } from './components/AdventureBottomNav';
import { ResourceHub } from './components/ResourceHub';
import { ExquisiteStoryWorkshop } from './components/ExquisiteStoryWorkshop';
import { DoujinshiArchive } from './components/DoujinshiArchive';
import { RestaurantForum } from './components/RestaurantForum';
import { DispatchHub } from './components/DispatchHub';
import { BackToTopButton } from './components/BackToTopButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { GROUP_INFO, POTATO_EGG_QUOTES } from './data/initialData';
import { soundManager } from './utils/audio';
import { NavigationTab } from './types';
import { LEVIHAN_OPEN_DOUJIN_EVENT } from './utils/relayNovels';

const TAB_INDEX_MAP: Partial<Record<NavigationTab, number>> = {
  home: 0,
  resources: 1,
  doujinshi: 2,
  dispatch: 3,
};

export default function App() {
  // Navigation State: 'home' | 'resources' | 'doujinshi' | 'dispatch'
  // 支持 ?tab=<name> 深度直达任意分区
  const [activeTab, setActiveTab] = useState<NavigationTab>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab === 'resources' || tab === 'doujinshi' || tab === 'dispatch') {
        return tab;
      }
    }
    return 'home';
  });
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(soundManager.isMuted());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const activeIndex = TAB_INDEX_MAP[activeTab] ?? 0;

  // 监听接龙合订本跳转事件，切换到巨树餐厅（同人典藏阁）
  useEffect(() => {
    const handleOpenNovel = () => {
      setActiveTab('resources');
    };
    window.addEventListener(LEVIHAN_OPEN_DOUJIN_EVENT, handleOpenNovel);
    return () => {
      window.removeEventListener(LEVIHAN_OPEN_DOUJIN_EVENT, handleOpenNovel);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastMessage(msg);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2800);
  }, []);

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
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main className="relative w-full h-[100dvh] max-h-[100dvh] pt-0 pb-0 px-0 flex flex-col items-center justify-start bg-transparent antialiased selection:bg-[#C5A059] selection:text-[#16273B] overflow-hidden">
      {/* 勇者大冒险 · 完全固定优雅羊皮纸背景 (固定不移动) */}
      <AdventureWorldBackground activeTab={activeTab} />

      {/* Offline Connectivity Status Badge */}
      <OfflineIndicator />

      {/* ====================================================
          卡片随着小人行军水平平移滑动层 (Card Follows Character Walking)
          4 个页面卡片横向平铺，随导航小人移动平滑平移切换
         ==================================================== */}
      <div className="relative z-10 w-full flex-1 min-h-0 overflow-hidden">
        <div
          className="flex w-[400%] h-full transition-transform duration-650 ease-out"
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
            <ImmersiveGameHome
              onNavigateTab={handleNavigate}
              onShowToast={showToast}
              isSoundMuted={isSoundMuted}
              onToggleSound={handleToggleSound}
            />
          </div>

          {/* VIEW 2: 巨树餐厅 (同人归档) */}
          <div
            className={`w-1/4 shrink-0 h-full overflow-hidden transition-opacity duration-300 ${
              activeTab === 'resources' ? 'opacity-100' : 'opacity-85 pointer-events-none'
            }`}
            aria-hidden={activeTab !== 'resources'}
          >
            <GameStageLayout
              activeTab="resources"
              onNavigateTab={handleNavigate}
              isSoundMuted={isSoundMuted}
              onToggleSound={handleToggleSound}
              onShowToast={showToast}
            >
              <DoujinshiArchive
                onCopyCode={handleCopyExtractionCode}
                onShowToast={showToast}
              />
            </GameStageLayout>
          </div>

          {/* VIEW 3: 团长茶话会 (同好茶室·故事接龙·安科创作) */}
          <div
            className={`w-1/4 shrink-0 h-full overflow-hidden transition-opacity duration-300 ${
              activeTab === 'doujinshi' ? 'opacity-100' : 'opacity-85 pointer-events-none'
            }`}
            aria-hidden={activeTab !== 'doujinshi'}
          >
            <RestaurantForum
              onBack={() => handleNavigate('home')}
              onShowToast={showToast}
            />
          </div>

          {/* VIEW 4: 调查联络 (飞鸽信使·投递·讨论·营地) */}
          <div
            className={`w-1/4 shrink-0 h-full overflow-hidden transition-opacity duration-300 ${
              activeTab === 'dispatch' ? 'opacity-100' : 'opacity-85 pointer-events-none'
            }`}
            aria-hidden={activeTab !== 'dispatch'}
          >
            <GameStageLayout
              activeTab="dispatch"
              onNavigateTab={handleNavigate}
              isSoundMuted={isSoundMuted}
              onToggleSound={handleToggleSound}
              onShowToast={showToast}
            >
              <DispatchHub onShowToast={showToast} />
            </GameStageLayout>
          </div>
        </div>
      </div>

      {/* 勇者大冒险 · 底部行军路线与走动小人导航栏 (常驻底部，小人跑向对应地标) */}
      <AdventureBottomNav
        activeTab={activeTab}
        onNavigateTab={handleNavigate}
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
