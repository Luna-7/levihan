import React from 'react';

export const CadetZiplineHeader: React.FC = () => {
  return (
    <div
      className="relative w-full max-w-xl mx-auto h-8 sm:h-10 overflow-hidden pointer-events-none -mt-2 sm:-mt-2.5 z-20 select-none"
      aria-label="滑索上的新兵蛋子们（让、萨沙、三笠、阿尔敏）"
    >
      {/* 顶部钢缆横索（紧贴 Header 底边，呈现悬挂在滑索上的真实物理感） */}
      <div className="absolute top-[8px] sm:top-[9px] left-0 right-0 h-[2px] bg-[#544331]/50 shadow-[0_1px_2px_rgba(0,0,0,0.15)] z-10" />

      {/* 动态向右滑行的小人队伍 */}
      <div className="w-full h-full animate-zipline-glide flex items-start pl-0">
        <div className="animate-cadet-bob flex-shrink-0 flex items-center">
          <img
            src="/images/zipline-cadets.webp"
            alt="滑索小分队"
            className="h-10 sm:h-12 w-auto object-contain select-none drop-shadow-[0_2px_5px_rgba(0,0,0,0.3)] filter contrast-105"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
};
