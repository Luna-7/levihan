import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { soundManager } from '../utils/audio';
import { UiSprite } from './UiSprite';

interface Props {
  onOpenGameModal: () => void;
  onOpenResourceModal: () => void;
  onPreloadTab?: (tabId: string) => void;
}

export const MiniProgramJumpGrid: React.FC<Props> = ({
  onOpenGameModal,
  onOpenResourceModal,
  onPreloadTab,
}) => {
  const [showCinemaNotice, setShowCinemaNotice] = useState(false);

  return (
    <div className="w-full select-none relative z-20 px-1 sm:px-2 -mt-1 sm:-mt-2">
      {/* ====================================================
          首页 3 个复古羊皮纸勋章入口 (缩放更紧凑精致)
          1. 塔塔开 (街机训练)
          2. 影视厅 (筹备中 · 即将上线)
          3. 巨人资源 (官方典藏)
         ==================================================== */}
      <div className="w-full grid grid-cols-3 gap-2 sm:gap-3 max-w-md mx-auto items-end justify-items-center">
        {/* ==================== 1: 塔塔开 (街机训练) ==================== */}
        <button
          type="button"
          onClick={() => {
            soundManager.playWoodTap();
            onOpenGameModal();
          }}
          onMouseEnter={() => {
            void import('./TatakaruGame');
          }}
          onTouchStart={() => {
            void import('./TatakaruGame');
          }}
          className="group flex flex-col items-center cursor-pointer p-0"
          id="btn-jump-tatakaru"
          title="进入塔塔开·街机训练"
        >
          {/* 三层原画已在构建资产中预合成，避免 WebKit 为一个按钮解码并合成三张大图。 */}
          <div className="relative w-[103px] sm:w-[137px] md:w-[154px] aspect-[676/637]">
            <img
              src="/images/tatakaru-button.webp"
              alt="塔塔开"
              draggable={false}
              decoding="async"
              className="absolute inset-0 w-full h-full pointer-events-none select-none transition-transform duration-200 ease-out group-hover:scale-105 group-active:scale-110"
            />
          </div>
        </button>

        {/* ==================== 2: 影视厅 (内容待定) ==================== */}
        <button
          type="button"
          onClick={() => {
            soundManager.playScrollOpen();
            setShowCinemaNotice(true);
          }}
          className="group flex flex-col items-center cursor-pointer p-0"
          id="btn-jump-cinema"
          title="影视厅 · 待定"
        >
          <div className="relative w-[103px] sm:w-[137px] md:w-[154px] aspect-[681/647]">
            <img
              src="/images/cinema-button.webp"
              alt="影视厅"
              draggable={false}
              decoding="async"
              className="absolute inset-0 w-full h-full pointer-events-none select-none transition-transform duration-200 ease-out group-hover:scale-105 group-active:scale-110"
            />

            {/* 右上角「待定」小旗标 */}
            <span className="absolute -top-1 -right-1 z-30 px-1.5 py-[1px] rounded-full bg-[#9E4A3B] text-[#FBF3E2] text-[8px] sm:text-[9px] font-bold shadow-xs border border-[#7A3629] whitespace-nowrap">
              待定
            </span>
          </div>
        </button>

        {/* ==================== 3: 巨人资源 (官方典藏) ==================== */}
        <button
          type="button"
          onClick={() => {
            soundManager.playPageTurn();
            onOpenResourceModal();
          }}
          onMouseEnter={() => {
            onPreloadTab?.('resources');
            void import('./ResourceHub');
          }}
          onTouchStart={() => {
            onPreloadTab?.('resources');
            void import('./ResourceHub');
          }}
          className="group flex flex-col items-center cursor-pointer p-0"
          id="btn-jump-resources"
          title="进入巨人资源·官方典藏"
        >
          <div className="relative w-[103px] sm:w-[137px] md:w-[154px] aspect-[714/678]">
            <img
              src="/images/giant-button.webp"
              alt="巨人资源"
              draggable={false}
              decoding="async"
              className="absolute inset-0 w-full h-full pointer-events-none select-none transition-transform duration-200 ease-out group-hover:scale-105 group-active:scale-110"
            />
          </div>
        </button>
      </div>

      {/* ====================================================
          影视厅「即将上线」提示弹窗
         ==================================================== */}
      {typeof document !== 'undefined' && showCinemaNotice && createPortal(
        <div
          className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 select-none"
          onClick={() => {
            soundManager.playWoodTap();
            setShowCinemaNotice(false);
          }}
        >
          <div
            className="relative w-full max-w-xs bg-[#FBF7EC] border-[3px] border-[#1C1611] shadow-[7px_7px_0_#1C1611] p-5 text-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 顶部胶带装饰 */}
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-14 h-4 bg-[#E8DCBF]/90 border border-[#D0C09E]/80 -rotate-2 shadow-2xs rounded-2xs pointer-events-none" />

            <div className="flex flex-col items-center gap-2 pt-1">
              <UiSprite name="cinema" width={88} role="img" label="影视厅" className="drop-shadow-sm" />
              <h3 className="font-serif-title text-base font-black text-[#1E4334]">影视厅 · 待定</h3>
              <p className="font-retro-jp text-xs text-[#6B5138] leading-relaxed">
                放映机还在搬运途中…<br />影片整理完毕后即刻开映，敬请期待 ✦
              </p>
              <button
                type="button"
                onClick={() => {
                  soundManager.playWoodTap();
                  setShowCinemaNotice(false);
                }}
                className="mt-1.5 px-5 py-1.5 bg-[#1E4334] hover:bg-[#2C5C46] text-[#F9E79F] border border-[#C5A059] rounded-lg font-serif-title font-bold text-xs shadow-xs active:scale-95 transition-all cursor-pointer"
              >
                知道了
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
