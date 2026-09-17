import React from 'react';
import { soundManager } from '../utils/audio';
import { UiSprite } from './UiSprite';

interface Props {
  onNavigateTab: (tabId: string) => void;
  onOpenGameModal: () => void;
  onOpenRestaurant: () => void;
}

export const MiniProgramJumpGrid: React.FC<Props> = ({
  onOpenGameModal,
  onOpenRestaurant,
}) => {
  return (
    <div className="w-full h-full select-none relative z-20 pb-0.5">
      {/* ====================================================
          首页跳转按键：上面图案，下面button名称，高于导航栏
          1. ⚔️ 塔塔开 (进入小游戏/街机训练室)
          2. 🍽️ 巨树餐厅 (展示中)
         ==================================================== */}
      <div className="w-full h-full grid grid-cols-2 gap-2.5 sm:gap-3">
        {/* 方块 1: 塔塔开 */}
        <button
          type="button"
          onClick={() => {
            soundManager.playWoodTap();
            onOpenGameModal();
          }}
          className="group relative h-full bg-[#FAF6ED]/84 backdrop-blur-[3px] hover:bg-[#F5EFE0]/92 border-2 border-[#16273B] hover:border-[#C5A059] rounded-xl py-3 px-3 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all duration-150 shadow-md hover:shadow-lg active:scale-95 overflow-hidden"
          id="btn-jump-tatakaru"
        >
          {/* 金色内边框细线 */}
          <div className="absolute inset-1 border border-[#C5A059]/30 pointer-events-none rounded-lg" />
          {/* 上面：图案（适当缩小，给文字留呼吸感） */}
          <div className="h-20 sm:h-24 flex items-center justify-center group-hover:scale-105 transition-transform z-10">
            <UiSprite name="tatakaru" width={100} role="img" label="塔塔开" className="drop-shadow-sm" />
          </div>

          {/* 下面：button名称 */}
          <span className="font-serif-title text-xs sm:text-sm font-black text-[#16273B] tracking-wider z-10">
            <span className="mr-1">⚔️</span>塔塔开
          </span>
        </button>

        {/* 方块 2: 巨树餐厅论坛 */}
        <div
          onClick={() => {
            soundManager.playWoodTap();
            onOpenRestaurant();
          }}
          className="group relative h-full bg-[#FAF6ED]/76 backdrop-blur-[3px] hover:bg-[#FAF6ED]/90 border-2 border-[#D5C19A] hover:border-[#C5A059] rounded-xl py-3 px-3 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all duration-150 shadow-md hover:shadow-lg active:scale-95 overflow-hidden"
          id="block-display-restaurant"
          title="进入巨树餐厅论坛"
        >
          {/* 装饰内边框细线 */}
          <div className="absolute inset-1 border border-[#D5C19A]/40 pointer-events-none rounded-lg" />
          {/* 上面：图案（适当缩小，给文字留呼吸感） */}
          <div className="h-20 sm:h-24 flex items-center justify-center group-hover:scale-105 transition-transform z-10">
            <UiSprite name="restaurant" width={100} role="img" label="巨树餐厅" className="drop-shadow-sm" />
          </div>

          {/* 下面：button名称 */}
          <span className="font-serif-title text-xs sm:text-sm font-black text-[#16273B]/85 tracking-wider z-10">
            <span className="mr-1">🍽️</span>巨树餐厅
          </span>
        </div>
      </div>
    </div>
  );
};
