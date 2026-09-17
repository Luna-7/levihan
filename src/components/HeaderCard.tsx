import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { PixelPotion, PixelStar } from './PixelIcons';
import { ImageNavBar } from './ImageNavBar';
import { NavigationTab } from '../types';
import { UserEntry } from './UserEntry';

interface Props {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  isSoundMuted?: boolean;
  onToggleSound?: () => void;
  onCopyGroupNumber?: () => void;
  onShowToast: (msg: string) => void;
}

export const HeaderCard: React.FC<Props> = ({
  activeTab,
  onSelectTab,
  isSoundMuted = false,
  onToggleSound,
  onShowToast,
}) => {
  // Tab-specific metadata for dynamic top banner
  const tabHeaders = {
    home: {
      icon: '🥔',
      title: '利韩土豆仓',
      subTitle: 'LEVI × HANS',
      desc: '同好交流 & 招募',
      themeBg: 'bg-[#1E4334]',
      themeBorder: 'border-[#153025]',
      btnBg: 'bg-[#245340] hover:bg-[#2e6850] border-[#37755c] text-[#D5F5E3]',
    },
    resources: {
      icon: '📚',
      title: '资源外链库',
      subTitle: 'RESOURCE ARCHIVES',
      desc: '动画原片 · 二创素材 · 画师推荐',
      themeBg: 'bg-[#16382B]',
      themeBorder: 'border-[#0F281E]',
      btnBg: 'bg-[#1e4c3a] hover:bg-[#27614a] border-[#337a5f] text-[#D5F5E3]',
    },
    doujinshi: {
      icon: '🍠',
      title: '土豆粮仓驻地',
      subTitle: 'LEVIHAN DOUJIN',
      desc: '汉化本 · 插画集 · 同人小说',
      themeBg: 'bg-[#4C336C]',
      themeBorder: 'border-[#362250]',
      btnBg: 'bg-[#5f4185] hover:bg-[#724f9e] border-[#7d57ad] text-[#F3E8FF]',
    },
    tatakaru: {
      icon: '⚔️',
      title: '兵团娱乐室 · 塔塔开',
      subTitle: 'TATAKARU MINI GAMES',
      desc: '拯救韩吉 · 合成大土豆',
      themeBg: 'bg-[#7D291D]',
      themeBorder: 'border-[#5A1C13]',
      btnBg: 'bg-[#9b3426] hover:bg-[#b53d2d] border-[#c44937] text-[#FFE8E5]',
    },
    dispatch: {
      icon: '✉️',
      title: '联络 · 调查兵团',
      subTitle: 'WALL ROSE DISPATCH',
      desc: '战术研讨 · 作品分享 · 商业定制',
      themeBg: 'bg-[#5A3825]',
      themeBorder: 'border-[#382012]',
      btnBg: 'bg-[#734A2E] hover:bg-[#855737] border-[#996841] text-[#FAF5E8]',
    },
  };

  const currentHeader = tabHeaders[activeTab];

  return (
    <header className="relative mb-3 sm:mb-4 space-y-2 sm:space-y-3 transition-all duration-300">
      {/* Sleek Dynamic Top Header Banner - Changes dynamically with active tab */}
      <div className={`${currentHeader.themeBg} text-[#FAF5E8] border-2 sm:border-[3px] ${currentHeader.themeBorder} rounded-md px-2.5 py-2 xs:px-4 xs:py-3 shadow-md relative overflow-hidden flex items-center justify-between gap-2 sm:gap-3 transition-colors duration-300`}>
        {/* Background pixel star accent */}
        <div className="absolute top-2 left-6 opacity-20 pointer-events-none">
          <PixelStar size={14} />
        </div>
        <div className="absolute top-2 right-16 opacity-15 pointer-events-none">
          <PixelStar size={12} />
        </div>

        {/* Title and Badge Info */}
        <div className="flex items-center gap-1.5 xs:gap-2.5 relative z-10 min-w-0">
          <span className="text-xl sm:text-2xl shrink-0 transition-transform duration-200">
            {currentHeader.icon}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 xs:gap-2">
              <h1 className="font-pixel text-sm xs:text-base sm:text-lg md:text-xl text-[#F9E79F] tracking-wide font-black truncate">
                {currentHeader.title}
              </h1>
              <span className="hidden sm:inline-block shrink-0">
                <PixelPotion size={16} />
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 sm:mt-1">
              <span className="font-pixel text-[10px] xs:text-[11px] sm:text-[10px] text-[#F9E79F] tracking-wider font-bold shrink-0">
                {currentHeader.subTitle}
              </span>
              <span className="hidden xs:inline font-retro-jp text-[10px] xs:text-[11px] sm:text-[10px] text-[#D5F5E3] tracking-wider truncate">
                · {currentHeader.desc}
              </span>
            </div>
          </div>
        </div>

        {/* Mini Borderless Global Sound Effect Switch */}
        <div className="relative z-10 flex items-center gap-1.5 shrink-0">
        <UserEntry onShowToast={onShowToast} />
        {onToggleSound && (
          <button
            type="button"
            onClick={onToggleSound}
            className="relative z-10 p-1 sm:p-1.5 text-[#F9E79F]/80 hover:text-[#F9E79F] hover:bg-black/20 active:scale-90 transition-all cursor-pointer flex items-center justify-center shrink-0 border-0 outline-hidden"
            title={isSoundMuted ? '点击开启全局音效 🔇' : '点击静音全局音效 🔊'}
            aria-label={isSoundMuted ? '开启全局音效' : '静音全局音效'}
          >
            {isSoundMuted ? (
              <VolumeX className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-300/90 hover:text-red-200 transition-colors" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#F9E79F] transition-colors" />
            )}
          </button>
        )}
        </div>
      </div>

      {/* 图片导航栏 (采用用户上传的城墙图片为底座，完美嵌入自由之翼、利威尔趴趴、韩吉趴趴、双刃与草花) */}
      <ImageNavBar activeTab={activeTab} onSelectTab={onSelectTab} isMobile={false} />
    </header>
  );
};
