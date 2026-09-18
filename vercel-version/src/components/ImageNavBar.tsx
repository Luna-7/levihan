import React from 'react';
import { NavigationTab } from '../types';
import { soundManager } from '../utils/audio';

interface Props {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  isMobile?: boolean;
}

interface NavItem {
  id: NavigationTab;
  label: string;
  imageSrc: string;
  alt: string;
  quote: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'home',
    label: '兵团驻地',
    imageSrc: '/images/nav/home.png',
    alt: '兵团驻地 - 自由之翼',
    quote: '献出心脏',
  },
  {
    id: 'resources',
    label: '资源外链',
    imageSrc: '/images/nav/resources.png',
    alt: '资源外链 - 利威尔趴趴',
    quote: '做不会后悔的选择',
  },
  {
    id: 'doujinshi',
    label: '土豆粮仓',
    imageSrc: '/images/nav/doujin.png',
    alt: '土豆粮仓 - 韩吉趴趴',
    quote: '来研究巨人吧',
  },
  {
    id: 'tatakaru',
    label: '塔塔开',
    imageSrc: '/images/nav/tatakaru.png',
    alt: '塔塔开 - 超硬质双刃',
    quote: '不战斗就无法胜利',
  },
  {
    id: 'dispatch',
    label: '联络',
    imageSrc: '/images/nav/dispatch.png',
    alt: '联络 - 像素花草',
    quote: '同好交流',
  },
];

export const ImageNavBar: React.FC<Props> = ({ activeTab, onSelectTab, isMobile = false }) => {
  const handleClick = (id: NavigationTab) => {
    soundManager.playBlip();
    if (activeTab === id && isMobile) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      onSelectTab(id);
    }
  };

  if (isMobile) {
    return (
      <nav
        aria-label="移动端图片导航栏"
        className="sm:hidden fixed left-0 right-0 z-40 select-none drop-shadow-[0_4px_12px_rgba(0,0,0,0.65)]"
        style={{
          backgroundImage: 'url(/images/nav/nav-background.svg)',
          backgroundSize: '100% 100%',
          backgroundPosition: 'center bottom',
          bottom: 0,
          aspectRatio: '2072 / 404',
          WebkitMaskImage: 'url(/images/nav/nav-background.svg)',
          maskImage: 'url(/images/nav/nav-background.svg)',
          maskMode: 'alpha',
          WebkitMaskSize: '100% 100%',
          maskSize: '100% 100%',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
        }}
      >
        <div className="absolute inset-x-0 bottom-0 z-10 grid grid-cols-5 items-end justify-around px-1 max-w-lg mx-auto pb-[max(3px,env(safe-area-inset-bottom))]">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleClick(item.id)}
                className={`flex flex-col items-center justify-end py-1.5 px-0.5 relative transition-all duration-150 cursor-pointer min-h-[60px] ${
                  isActive ? 'scale-105' : 'opacity-85 hover:opacity-100 active:scale-95'
                }`}
              >
                {/* Active Indicator Arrow */}
                {isActive && (
                  <span className="absolute -top-1 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[5px] border-b-[#F9E79F] drop-shadow-[0_1px_2px_#000]" />
                )}

                {/* Embedded Uploaded Image */}
                <div
                  className={`w-8 h-8 flex items-center justify-center transition-transform duration-200 ${
                    isActive ? 'scale-110 drop-shadow-[0_0_8px_rgba(249,231,159,0.85)]' : 'hover:scale-105'
                  }`}
                >
                  <img
                    src={item.imageSrc}
                    alt={item.alt}
                    className="w-full h-full object-contain pointer-events-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)]"
                    loading="eager"
                  />
                </div>

                {/* Tab Label */}
                <span
                  className={`font-retro-jp text-xs tracking-tight mt-1 leading-none truncate max-w-full text-center ${
                    isActive
                      ? 'text-[#F9E79F] font-bold drop-shadow-[0_1px_3px_#000]'
                      : 'text-[#F4ECE1] drop-shadow-[0_1px_2px_#000]'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    );
  }

  // Desktop / Tablet Image Navigation Bar
  return (
    <nav
      aria-label="城墙图片导航栏"
      className="hidden sm:block w-full select-none relative overflow-hidden drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
      style={{
        backgroundImage: 'url(/images/nav/nav-background.svg)',
        backgroundSize: '100% 100%',
        backgroundPosition: 'center center',
        aspectRatio: '2072 / 404',
        WebkitMaskImage: 'url(/images/nav/nav-background.svg)',
        maskImage: 'url(/images/nav/nav-background.svg)',
        maskMode: 'alpha',
        WebkitMaskSize: '100% 100%',
        maskSize: '100% 100%',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
      }}
    >
      <div className="relative z-10 grid grid-cols-5 gap-1 sm:gap-2 px-2 sm:px-3 pt-4 pb-2 h-full items-end">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleClick(item.id)}
              className={`group flex flex-col items-center justify-end py-1.5 px-1 sm:px-2 rounded-xs transition-all duration-150 cursor-pointer relative min-h-[64px] ${
                isActive
                  ? 'bg-black/40 ring-1 ring-[#F9E79F]/80 shadow-[inset_0_0_12px_rgba(249,231,159,0.25)] -translate-y-0.5'
                  : 'hover:bg-black/25 hover:-translate-y-0.5 active:translate-y-0'
              }`}
              title={`${item.label} (${item.quote})`}
            >
              {/* Active Golden Triangular Crest Pointer */}
              {isActive && (
                <span className="absolute -top-1 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[6px] border-b-[#F9E79F] drop-shadow-[0_1px_3px_#000]" />
              )}

              {/* Embedded Uploaded Nav Image */}
              <div
                className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center transition-all duration-200 ${
                  isActive
                    ? 'scale-115 drop-shadow-[0_0_10px_rgba(249,231,159,0.9)]'
                    : 'group-hover:scale-110 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]'
                }`}
              >
                <img
                  src={item.imageSrc}
                  alt={item.alt}
                  className="w-full h-full object-contain pointer-events-none"
                  loading="eager"
                />
              </div>

              {/* Navigation Label */}
              <span
                className={`font-retro-jp text-xs sm:text-[13px] tracking-wide mt-1 leading-tight select-none ${
                  isActive
                    ? 'text-[#F9E79F] font-bold drop-shadow-[0_1px_3px_#000]'
                    : 'text-[#FFF8E7] drop-shadow-[0_1px_3px_#000] group-hover:text-[#F9E79F]'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
