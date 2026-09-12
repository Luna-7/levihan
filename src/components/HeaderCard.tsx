import React from 'react';
import { PixelPotion, PixelStar } from './PixelIcons';
import { soundManager } from '../utils/audio';

interface Props {
  activeTab: 'home' | 'resources' | 'doujinshi';
  onSelectTab: (tab: 'home' | 'resources' | 'doujinshi') => void;
  isSoundMuted: boolean;
  onToggleSound: () => void;
  onCopyGroupNumber: () => void;
}

export const HeaderCard: React.FC<Props> = ({
  activeTab,
  onSelectTab,
  isSoundMuted,
  onToggleSound,
}) => {
  return (
    <header className="relative mb-3 space-y-2">
      {/* Sleek Minimal Top Header Banner */}
      <div className="bg-[#1E4334] text-[#FAF5E8] border-2 border-[#153025] rounded-md px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-xs relative overflow-hidden flex items-center justify-between">
        {/* Background pixel star accent */}
        <div className="absolute top-2 left-6 opacity-20 pointer-events-none">
          <PixelStar size={14} />
        </div>
        <div className="absolute top-2 right-12 opacity-15 pointer-events-none">
          <PixelStar size={12} />
        </div>

        {/* Title */}
        <div className="flex items-center gap-2 relative z-10">
          <span className="text-2xl">🥔</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-pixel text-lg sm:text-2xl text-[#F9E79F] tracking-wide font-black">
                利韩土豆群
              </h1>
              <span className="hidden sm:inline-block">
                <PixelPotion size={18} />
              </span>
            </div>
            <div className="font-pixel text-[11px] text-[#D5F5E3] tracking-wider">
              LEVI × HANGE · 同好交流 & 资源归档站
            </div>
          </div>
        </div>

        {/* Sound Toggle */}
        <button
          onClick={onToggleSound}
          className="text-xs px-2 py-1 rounded-xs bg-[#FAF5E8] hover:bg-[#EAE2CE] text-[#1E3A2B] font-retro-jp border border-[#153025] cursor-pointer shadow-2xs flex items-center gap-1 shrink-0"
          title={isSoundMuted ? '开启音效' : '静音'}
        >
          <span>{isSoundMuted ? '🔇' : '🔊'}</span>
          <span className="hidden sm:inline text-[11px]">{isSoundMuted ? '静音' : '音效'}</span>
        </button>
      </div>

      {/* Navigation Tabs */}
      <nav aria-label="主要导航" className="flex items-center justify-start gap-1.5">
        <button
          onClick={() => {
            soundManager.playBlip();
            onSelectTab('home');
          }}
          className={`px-3 py-1 text-xs font-retro-jp rounded-xs border cursor-pointer transition-all flex items-center gap-1.5 ${
            activeTab === 'home'
              ? 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334] font-bold shadow-2xs'
              : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5]'
          }`}
        >
          <span>🏠</span>
          <span>兵团驻地</span>
        </button>

        <button
          onClick={() => {
            soundManager.playBlip();
            onSelectTab('resources');
          }}
          className={`px-3 py-1 text-xs font-retro-jp rounded-xs border cursor-pointer transition-all flex items-center gap-1.5 ${
            activeTab === 'resources'
              ? 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334] font-bold shadow-2xs'
              : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5]'
          }`}
        >
          <span>📚</span>
          <span>公共资源库</span>
        </button>

        <button
          onClick={() => {
            soundManager.playBlip();
            onSelectTab('doujinshi');
          }}
          className={`px-3 py-1 text-xs font-retro-jp rounded-xs border cursor-pointer transition-all flex items-center gap-1.5 ${
            activeTab === 'doujinshi'
              ? 'bg-[#5B3F8A] text-[#F9E79F] border-[#5B3F8A] font-bold shadow-2xs'
              : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5]'
          }`}
        >
          <span>🔒</span>
          <span>同人本专区</span>
        </button>
      </nav>
    </header>
  );
};
