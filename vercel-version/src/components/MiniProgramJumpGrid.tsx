import React from 'react';
import { soundManager } from '../utils/audio';

interface Props {
  onOpenGameModal: () => void;
  onOpenResourceModal: (category?: string) => void;
  onPreloadTab?: (tabId: string) => void;
}

export const MiniProgramJumpGrid: React.FC<Props> = React.memo(({
  onOpenGameModal,
  onOpenResourceModal,
  onPreloadTab,
}) => {
  return (
    <div className="home-jump-grid w-full select-none relative z-0 px-1 sm:px-2">
      {/* ====================================================
          首页 3 个复古羊皮纸勋章入口
          1. 塔塔开 (街机训练)
          2. 周边
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
          <div className="home-jump-art relative w-[103px] sm:w-[137px] md:w-[154px] aspect-[676/637]">
            <img
              src="/images/tatakaru-button.webp"
              alt="塔塔开"
              draggable={false}
              width={384}
              height={362}
              decoding="async"
              className="absolute inset-0 w-full h-full pointer-events-none select-none transition-transform duration-200 ease-out group-hover:scale-105 group-active:scale-110"
            />
          </div>
        </button>

        {/* ==================== 2: 周边 ==================== */}
        <button
          type="button"
          onClick={() => {
            soundManager.playScrollOpen();
            onOpenResourceModal('周边素材');
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
          id="btn-jump-merch"
          aria-label="周边"
          title="浏览周边"
        >
          <div className="home-jump-art relative w-[103px] sm:w-[137px] md:w-[154px] aspect-[681/647]">
            <img
              src="/images/merch-button.webp"
              alt="周边"
              draggable={false}
              width={384}
              height={365}
              decoding="async"
              className="absolute inset-0 w-full h-full pointer-events-none select-none transition-transform duration-200 ease-out group-hover:scale-105 group-active:scale-110"
            />
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
          <div className="home-jump-art relative w-[103px] sm:w-[137px] md:w-[154px] aspect-[714/678]">
            <img
              src="/images/giant-button.webp"
              alt="巨人资源"
              draggable={false}
              width={384}
              height={365}
              decoding="async"
              className="absolute inset-0 w-full h-full pointer-events-none select-none transition-transform duration-200 ease-out group-hover:scale-105 group-active:scale-110"
            />
          </div>
        </button>
      </div>

    </div>
  );
});
