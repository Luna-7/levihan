import React from 'react';
import {
  PixelHeart,
  PixelSword,
  PixelPotion,
  PixelCoin,
  PixelBook,
  PixelChest,
  PixelController,
  PixelStar,
} from './PixelIcons';

interface Props {
  children: React.ReactNode;
  onOpenChest?: () => void;
  chestOpened?: boolean;
}

export const RetroPixelFrame: React.FC<Props> = ({
  children,
  onOpenChest,
  chestOpened = false,
}) => {
  return (
    <div className="w-full max-w-4xl mx-auto my-2 xs:my-4 sm:my-6 md:my-8 px-1.5 xs:px-2 sm:px-4 transition-all duration-300">
      {/* Outer Card with Dynamic responsive Stitched Border & Corner Pixel Hearts */}
      <div className="retro-frame-card relative bg-[#FBF7EC] border-2 xs:border-4 md:border-[6px] border-[#1E4334] rounded-md xs:rounded-lg p-2.5 xs:p-4 sm:p-6 md:p-8 lg:p-10 shadow-xl transition-all duration-300">
        {/* Inner Gold/Brown Stitched Dotted Line */}
        <div className="absolute inset-1 xs:inset-2 md:inset-3 border sm:border-2 border-dashed border-[#D4B26F] pointer-events-none rounded-sm xs:rounded-md" />

        {/* 4 Corner Purple Pixel Hearts */}
        <div className="absolute -top-2.5 xs:-top-3.5 -left-2.5 xs:-left-3.5 z-20 scale-75 xs:scale-100">
          <PixelHeart size={26} />
        </div>
        <div className="absolute -top-2.5 xs:-top-3.5 -right-2.5 xs:-right-3.5 z-20 scale-75 xs:scale-100">
          <PixelHeart size={26} />
        </div>
        <div className="absolute -bottom-2.5 xs:-bottom-3.5 -left-2.5 xs:-left-3.5 z-20 scale-75 xs:scale-100">
          <PixelHeart size={26} />
        </div>
        <div className="absolute -bottom-2.5 xs:-bottom-3.5 -right-2.5 xs:-right-3.5 z-20 scale-75 xs:scale-100">
          <PixelHeart size={26} />
        </div>

        {/* Decorative Pixel Assets positioned on the borders */}
        {/* Top Right: Potion Bottle */}
        <div className="absolute top-2 right-6 hidden sm:block pointer-events-none opacity-85">
          <PixelPotion size={24} />
        </div>

        {/* Left Edge: Vertical Sword */}
        <div className="absolute top-1/4 -left-3 hidden md:block pointer-events-none">
          <PixelSword size={28} vertical={true} />
        </div>

        {/* Left Mid: Gold Coin */}
        <div className="absolute top-1/2 -left-3.5 hidden md:block pointer-events-none">
          <PixelCoin size={24} />
        </div>

        {/* Right Mid: Open Book */}
        <div className="absolute top-1/3 -right-3.5 hidden md:block pointer-events-none">
          <PixelBook size={24} />
        </div>

        {/* Bottom Left: Interactive Treasure Chest */}
        <div
          onClick={onOpenChest}
          className="absolute -bottom-3.5 left-8 z-20 cursor-pointer transition-transform hover:scale-110 active:scale-95 hidden sm:block"
          title="点击开启利韩土豆群驻地彩蛋箱"
        >
          <PixelChest size={28} isOpen={chestOpened} />
        </div>

        {/* Bottom Right: Handheld Controller */}
        <div className="absolute -bottom-3 right-8 z-20 hidden sm:block pointer-events-none">
          <PixelController size={26} />
        </div>

        {/* Star Sparkles along the canvas */}
        <div className="absolute top-12 left-4 hidden lg:block opacity-40 pointer-events-none">
          <PixelStar size={14} />
        </div>
        <div className="absolute top-16 right-5 hidden lg:block opacity-40 pointer-events-none">
          <PixelStar size={12} />
        </div>
        <div className="absolute bottom-16 left-5 hidden lg:block opacity-30 pointer-events-none">
          <PixelStar size={12} />
        </div>
        <div className="absolute bottom-20 right-6 hidden lg:block opacity-40 pointer-events-none">
          <PixelStar size={14} />
        </div>

        {/* Content Container */}
        <div className="relative z-10">{children}</div>

        {/* Bottom Retro Footer */}
        <footer className="mt-4 pt-3 border-t-2 border-dashed border-[#D5C9AF] text-center">
          <div className="bg-[#1E4334] text-[#FAF5E8] px-2.5 py-1.5 xs:px-3 xs:py-2 rounded-xs flex flex-col sm:flex-row items-center justify-between gap-2 shadow-xs text-xs">
            <div className="flex items-center gap-1.5 font-pixel text-[#F9E79F] font-bold text-[10px] xs:text-xs">
              <span>🥔 利韩土豆仓</span>
              <span className="text-[#FAF5E8] font-normal">· 调查兵团粮仓</span>
            </div>

            <div className="font-retro-jp text-[9px] xs:text-[11px] text-[#D5F5E3] tracking-wide">
              ✦ 利韩专一向同好交流 · 严禁商用倒卖与公开二传 ✦
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[9px] xs:text-[10px] font-pixel text-[#EAA83B]">心臓を捧げよ</span>
              <span className="text-xs xs:text-sm">🥔</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};
