import React from 'react';
import { PixelPotion, PixelStar } from './PixelIcons';
import { soundManager } from '../utils/audio';

interface Props {
  activeTab: 'home' | 'resources' | 'doujinshi' | 'tatakaru';
  onSelectTab: (tab: 'home' | 'resources' | 'doujinshi' | 'tatakaru') => void;
  isSoundMuted: boolean;
  onToggleSound: () => void;
  onCopyGroupNumber: () => void;
}

export const HeaderCard: React.FC<Props> = ({
  activeTab,
  onSelectTab,
  isSoundMuted,
  onToggleSound,
  onCopyGroupNumber,
}) => {
  return (
    <header className="relative mb-4 space-y-2.5 sm:space-y-3.5 transition-all duration-300">
      {/* Sleek Minimal Top Header Banner - responsive padding and border */}
      <div className="bg-[#1E4334] text-[#FAF5E8] border-2 sm:border-[3px] border-[#153025] rounded-md px-3 py-2.5 xs:px-4 xs:py-3.5 shadow-md relative overflow-hidden flex items-center justify-between gap-3 transition-all">
        {/* Background pixel star accent */}
        <div className="absolute top-2 left-6 opacity-20 pointer-events-none">
          <PixelStar size={14} />
        </div>
        <div className="absolute top-2 right-12 opacity-15 pointer-events-none">
          <PixelStar size={12} />
        </div>

        {/* Title and Badge Info */}
        <div className="flex items-center gap-2 relative z-10 min-w-0">
          <span className="text-xl sm:text-2xl shrink-0">🥔</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-pixel text-sm xs:text-base sm:text-xl md:text-2xl text-[#F9E79F] tracking-wide font-black truncate">
                利韩土豆仓
              </h1>
              <span className="hidden xs:inline-block shrink-0">
                <PixelPotion size={16} />
              </span>
            </div>
            <div className="flex flex-col mt-1 sm:mt-1.5">
              <span className="font-pixel text-[9px] xs:text-[10px] sm:text-[11px] text-[#F9E79F] tracking-wider font-bold">
                LEVI × HANGE
              </span>
              <span className="font-retro-jp text-[8px] xs:text-[9px] sm:text-[10px] text-[#D5F5E3] tracking-wider mt-0.5">
                同好交流 & 资源站
              </span>
            </div>
          </div>
        </div>

        {/* Sound Toggle - Styled to blend in perfectly with the bg-[#1E4334] background */}
        <button
          onClick={onToggleSound}
          className="text-xs px-2 py-1 rounded-xs bg-[#1E4334] text-[#1E4334] border border-[#1E4334] cursor-pointer flex items-center gap-1 shrink-0 select-none transition-colors"
          title={isSoundMuted ? '开启音效' : '静音'}
        >
          <span>{isSoundMuted ? '🔇' : '🔊'}</span>
          <span className="hidden xs:inline text-[10px] sm:text-[11px] font-bold">{isSoundMuted ? '静音' : '音效'}</span>
        </button>
      </div>

      {/* Navigation Tabs - responsive tab paddings, dynamic alignment and balanced grid on mobile & desktop */}
      <nav aria-label="主要导航" className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 w-full">
        <button
          onClick={() => {
            soundManager.playBlip();
            onSelectTab('home');
          }}
          className={`w-full justify-center px-2 py-1.5 sm:px-3.5 sm:py-2 text-xs sm:text-sm font-retro-jp rounded-xs border cursor-pointer transition-all flex items-center gap-1 sm:gap-1.5 min-w-0 select-none ${
            activeTab === 'home'
              ? 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334] font-bold shadow-2xs'
              : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5]'
          }`}
        >
          <span className="shrink-0">🏠</span>
          <span className="truncate">兵团驻地</span>
        </button>

        <button
          onClick={() => {
            soundManager.playBlip();
            onSelectTab('resources');
          }}
          className={`w-full justify-center px-2 py-1.5 sm:px-3.5 sm:py-2 text-xs sm:text-sm font-retro-jp rounded-xs border cursor-pointer transition-all flex items-center gap-1 sm:gap-1.5 min-w-0 select-none ${
            activeTab === 'resources'
              ? 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334] font-bold shadow-2xs'
              : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5]'
          }`}
        >
          <span className="shrink-0">📚</span>
          <span className="truncate">资源外链</span>
        </button>

        <button
          onClick={() => {
            soundManager.playBlip();
            onSelectTab('doujinshi');
          }}
          className={`w-full justify-center px-2 py-1.5 sm:px-3.5 sm:py-2 text-xs sm:text-sm font-retro-jp rounded-xs border cursor-pointer transition-all flex items-center gap-1 sm:gap-1.5 min-w-0 select-none ${
            activeTab === 'doujinshi'
              ? 'bg-[#5B3F8A] text-[#F9E79F] border-[#5B3F8A] font-bold shadow-2xs'
              : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5]'
          }`}
        >
          <span className="shrink-0">🔒</span>
          <span className="truncate">土豆粮仓驻地</span>
        </button>

        <button
          onClick={() => {
            soundManager.playBlip();
            window.open('/tatakaru.html', '_blank', 'noopener,noreferrer');
          }}
          className={`w-full justify-center px-2 py-1.5 sm:px-3.5 sm:py-2 text-xs sm:text-sm font-retro-jp rounded-xs border cursor-pointer transition-all flex items-center gap-1 sm:gap-1.5 min-w-0 select-none ${
            activeTab === 'tatakaru'
              ? 'bg-[#B3402F] text-[#F9E79F] border-[#B3402F] font-bold shadow-2xs'
              : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5]'
          }`}
        >
          <span className="shrink-0">⚔️</span>
          <span className="truncate">塔塔开</span>
        </button>
      </nav>
    </header>
  );
};
