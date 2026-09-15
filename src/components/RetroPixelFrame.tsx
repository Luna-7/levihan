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
  isGamePlaying?: boolean;
}

export const RetroPixelFrame: React.FC<Props> = ({
  children,
  onOpenChest,
  chestOpened = false,
  isGamePlaying = false,
}) => {
  return (
    <div className={`w-full ${isGamePlaying ? 'max-w-5xl my-0 sm:my-1' : 'max-w-4xl my-0 sm:my-4 md:my-6'} mx-auto px-0 sm:px-4 transition-all duration-300`}>
      {/* Outer Card with Dynamic responsive Border */}
      <div className={`retro-frame-card relative bg-[#FBF7EC] border-t-2 xs:border-t-3 sm:border-t-4 md:border-t-[5px] border-x-2 xs:border-x-3 sm:border-x-4 md:border-x-[5px] border-b-0 sm:border-b-4 md:border-b-[5px] border-[#1E4334] rounded-t-none xs:rounded-t-md sm:rounded-lg rounded-b-none sm:rounded-b-lg ${
        isGamePlaying
          ? 'p-1 xs:p-1.5 sm:p-3 pb-2 sm:pb-3'
          : 'p-2.5 xs:p-3 sm:p-5 md:p-7 pb-24 sm:pb-7'
      } shadow-xl transition-all duration-300 min-h-screen sm:min-h-0`}>
        {/* 4 Corner Purple Pixel Hearts - Bottom hearts hidden on mobile (tucked under nav), visible on web */}
        <div className="absolute -top-2.5 xs:-top-3.5 -left-2.5 xs:-left-3.5 z-20 scale-75 xs:scale-100">
          <PixelHeart size={26} />
        </div>
        <div className="absolute -top-2.5 xs:-top-3.5 -right-2.5 xs:-right-3.5 z-20 scale-75 xs:scale-100">
          <PixelHeart size={26} />
        </div>
        <div className="absolute -bottom-2.5 xs:-bottom-3.5 -left-2.5 xs:-left-3.5 z-20 scale-75 xs:scale-100 hidden sm:block">
          <PixelHeart size={26} />
        </div>
        <div className="absolute -bottom-2.5 xs:-bottom-3.5 -right-2.5 xs:-right-3.5 z-20 scale-75 xs:scale-100 hidden sm:block">
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
      </div>
    </div>
  );
};
