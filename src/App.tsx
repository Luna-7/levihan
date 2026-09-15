import React, { useState, useRef, useCallback } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { RetroPixelFrame } from './components/RetroPixelFrame';
import { HeaderCard } from './components/HeaderCard';
import { GroupHome } from './components/GroupHome';
import { ResourceHub } from './components/ResourceHub';
import { DoujinshiArchive } from './components/DoujinshiArchive';
import { TatakaruGame } from './components/TatakaruGame';
import { DispatchHub } from './components/DispatchHub';
import { MobileBottomNav } from './components/MobileBottomNav';
import { BackToTopButton } from './components/BackToTopButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { GROUP_INFO, POTATO_EGG_QUOTES } from './data/initialData';
import { soundManager } from './utils/audio';
import { NavigationTab } from './types';

export default function App() {
  // Navigation State: 'home' | 'resources' | 'doujinshi' | 'tatakaru' | 'dispatch'
  // 支持 ?tab=<name> 深度直达任意分区（配合 TatakaruGame 的 ?game=hange 可直达拯救韩吉对局）
  const [activeTab, setActiveTab] = useState<NavigationTab>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab === 'tatakaru' || tab === 'resources' || tab === 'doujinshi' || tab === 'dispatch') {
        return tab;
      }
      const game = params.get('game');
      if (game === 'hange' || game === '2048') {
        return 'tatakaru';
      }
    }
    return 'home';
  });
  const [isGamePlaying, setIsGamePlaying] = useState<boolean>(false);
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(soundManager.isMuted());
  const [chestOpened, setChestOpened] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

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

  const handleOpenChest = () => {
    soundManager.playChestOpen();
    setChestOpened(true);
    const quote = POTATO_EGG_QUOTES[Math.floor(Math.random() * POTATO_EGG_QUOTES.length)];
    showToast(quote);
  };

  const isImmersivePlaying = activeTab === 'tatakaru' && isGamePlaying;

  return (
    <main className="min-h-screen pt-0 sm:pt-4 md:pt-6 pb-0 sm:pb-8 px-0 sm:px-4 flex flex-col items-center justify-start bg-[#F4EEDC] transition-all duration-300 antialiased selection:bg-[#EAA83B] selection:text-[#18392B]">
      {/* Offline Connectivity Status Badge */}
      <OfflineIndicator />

      {/* Main Retro Stitched Pixel Frame with Fluid Adaptive Padding & Border */}
      <RetroPixelFrame
        onOpenChest={handleOpenChest}
        chestOpened={chestOpened}
        isGamePlaying={isImmersivePlaying}
      >
        {/* HeaderCard is hidden during immersive game to maximize game arena and eliminate top banners */}
        {!isImmersivePlaying && (
          <HeaderCard
            activeTab={activeTab}
            onSelectTab={(tab) => {
              setIsGamePlaying(false);
              setActiveTab(tab);
            }}
            isSoundMuted={isSoundMuted}
            onToggleSound={handleToggleSound}
            onCopyGroupNumber={handleCopyGroupNumber}
            onShowToast={showToast}
          />
        )}

        {/* VIEW 1: 群主页与群规宣传 */}
        {activeTab === 'home' && (
          <GroupHome
            onNavigateToResources={() => {
              soundManager.playBlip();
              setActiveTab('resources');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onNavigateToDoujin={() => {
              soundManager.playBlip();
              setActiveTab('doujinshi');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onShowToast={showToast}
          />
        )}

        {/* VIEW 2: 公共资源库 (动画Cut/官方资料/AO3/140+Pixiv画师) */}
        {activeTab === 'resources' && (
          <ResourceHub
            onCopyCode={handleCopyExtractionCode}
            onShowToast={showToast}
            onGoToDoujin={() => {
              soundManager.playBlip();
              setActiveTab('doujinshi');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}

        {/* VIEW 3: 同人本专区 (A-Z卷汉化精修/画册/防倒卖规范，已正式开放) */}
        {activeTab === 'doujinshi' && (
          <DoujinshiArchive
            onCopyCode={handleCopyExtractionCode}
            onShowToast={showToast}
            onGoToResources={() => {
              soundManager.playBlip();
              setActiveTab('resources');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}

        {/* VIEW 4: 兵团娱乐室 - 原生内嵌塔塔开小游戏 */}
        {activeTab === 'tatakaru' && (
          <TatakaruGame
            onShowToast={showToast}
            onPlayingChange={setIsGamePlaying}
          />
        )}

        {/* VIEW 5: 联络呈递 - 战术研讨与作品分享信箱 */}
        {activeTab === 'dispatch' && (
          <DispatchHub onShowToast={showToast} />
        )}
      </RetroPixelFrame>

      {/* Floating Retro Toast Notification (positioned above mobile bottom navigation) */}
      {toastMessage && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 transform -translate-x-1/2 z-50 bg-[#1E4334] text-[#FAF5E8] border-2 border-[#EAA83B] px-4 py-2 rounded-md shadow-2xl font-retro-jp text-xs sm:text-sm flex items-center gap-2 animate-bounce max-w-[90vw]">
          <span className="text-base shrink-0">🥔</span>
          <span className="truncate">{toastMessage}</span>
        </div>
      )}

      {/* Mobile Bottom Navigation Bar for easy thumb navigation on mobile / PWA - hidden during game */}
      {!isImmersivePlaying && (
        <MobileBottomNav
          activeTab={activeTab}
          onSelectTab={(tab) => {
            setIsGamePlaying(false);
            setActiveTab(tab);
          }}
        />
      )}

      {/* Back to Top Floating Button */}
      {!isImmersivePlaying && <BackToTopButton />}

      {/* Vercel Analytics */}
      <Analytics />
    </main>
  );
}
