import React, { useState } from 'react';
import { RetroPixelFrame } from './components/RetroPixelFrame';
import { HeaderCard } from './components/HeaderCard';
import { GroupHome } from './components/GroupHome';
import { ResourceHub } from './components/ResourceHub';
import { DoujinshiArchive } from './components/DoujinshiArchive';
import { GROUP_INFO, POTATO_EGG_QUOTES } from './data/initialData';
import { soundManager } from './utils/audio';

export default function App() {
  // Navigation State: 'home' (群主页与群规) | 'resources' (资源外链) | 'doujinshi' (土豆粮仓驻地) | 'tatakaru' (游戏小屋)
  const [activeTab, setActiveTab] = useState<'home' | 'resources' | 'doujinshi' | 'tatakaru'>('home');
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(soundManager.isMuted());
  const [chestOpened, setChestOpened] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 2800);
    return () => clearTimeout(timer);
  };

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
    showToast(muted ? '已静音 🔇' : '已开启复古8位音效 🔊');
  };

  const handleOpenChest = () => {
    soundManager.playChestOpen();
    setChestOpened(true);
    const quote = POTATO_EGG_QUOTES[Math.floor(Math.random() * POTATO_EGG_QUOTES.length)];
    showToast(quote);
  };

  return (
    <main className="min-h-screen py-2 xs:py-4 sm:py-6 md:py-8 px-1.5 xs:px-2 sm:px-4 flex flex-col items-center justify-start bg-[#F4EEDC] transition-all duration-300">
      {/* Main Retro Stitched Pixel Frame with Fluid Adaptive Padding & Border */}
      <RetroPixelFrame onOpenChest={handleOpenChest} chestOpened={chestOpened}>
        {/* Header is now the beautiful and unified green HeaderCard of 利韩土豆群 */}
        <HeaderCard
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          isSoundMuted={isSoundMuted}
          onToggleSound={handleToggleSound}
          onCopyGroupNumber={handleCopyGroupNumber}
        />

        {/* VIEW 1: 群主页与群规宣传 */}
        {activeTab === 'home' && (
          <GroupHome
            onNavigateToResources={() => {
              soundManager.playBlip();
              setActiveTab('resources');
            }}
            onNavigateToDoujin={() => {
              soundManager.playBlip();
              setActiveTab('doujinshi');
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
            }}
          />
        )}

        {/* VIEW 3: 保留同人本专区 (A-Z卷汉化精修/画册/防倒卖规范) */}
        {activeTab === 'doujinshi' && (
          <DoujinshiArchive
            onCopyCode={handleCopyExtractionCode}
            onShowToast={showToast}
          />
        )}
      </RetroPixelFrame>

      {/* Floating Retro Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 bg-[#1E4334] text-[#FAF5E8] border-2 border-[#EAA83B] px-4 py-2.5 rounded-md shadow-2xl font-retro-jp text-xs sm:text-sm flex items-center gap-2 animate-bounce">
          <span className="text-base">🥔</span>
          <span>{toastMessage}</span>
        </div>
      )}
    </main>
  );
}
