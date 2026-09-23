import React from 'react';
import { NavigationTab } from '../types';
import { CardPatternOverlay } from './CardPatternOverlay';

interface Props {
  activeTab: NavigationTab;
  onNavigateTab: (tabId: NavigationTab) => void;
  isSoundMuted: boolean;
  onToggleSound: () => void;
  onShowToast: (msg: string) => void;
  children: React.ReactNode;
}

export const GameStageLayout: React.FC<Props> = ({
  activeTab,
  children,
}) => {
  const isSeamless = activeTab === 'resources' || activeTab === 'dispatch';

  if (isSeamless) {
    return (
      <div className="relative w-full h-full select-none overflow-hidden text-[#374151] flex flex-col bg-[#FFFEEF]/80 md:bg-[#FFFEEF]/55 md:backdrop-blur-md">
        <CardPatternOverlay opacity={0.06} mode="multiply" />

        {/* 巨树餐厅与调查联络：全屏半透明磨砂底图，统一兵长茶会同款流动式舞台布局 */}
        <main
          className="relative z-10 w-full max-w-7xl mx-auto flex-1 min-h-0 flex flex-col overflow-hidden px-2.5 sm:px-4 md:px-6"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div id={`${activeTab}-scroll-container`} className="clear-adventure-nav relative w-full h-full overflow-y-auto pt-2.5 sm:pt-3.5 pr-0.5 sm:pr-1 overflow-x-hidden custom-adventure-scrollbar">
            {children}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-full select-none overflow-hidden bg-transparent text-[#374151] flex flex-col justify-between"
      style={{
        paddingTop: 'max(env(safe-area-inset-top, 0px), 6px)',
        paddingBottom: 'calc(max(env(safe-area-inset-bottom, 0px), 8px) + 8px)',
      }}
    >
      {/* 其他页面默认带复古金属框 */}
      <main className="relative z-10 w-full max-w-5xl mx-auto flex-1 min-h-0 flex flex-col overflow-hidden px-1.5 xs:px-2.5 sm:px-4 md:px-6">
        <div className="relative w-full h-full flex flex-col text-[#16273B] overflow-hidden silver-retro-frame glass-reflection-overlay max-sm:border-b-0 rounded-2xl max-sm:rounded-b-none p-2.5 xs:p-3.5 sm:p-5 md:p-6">
          <CardPatternOverlay opacity={0.08} mode="multiply" />
          <span className="silver-rivet top-2.5 left-2.5" />
          <span className="silver-rivet top-2.5 right-2.5" />
          <span className="silver-rivet bottom-2.5 left-2.5" />
          <span className="silver-rivet bottom-2.5 right-2.5" />

          {/* 内部主视图容器 */}
          <div id="general-stage-scroll-container" className="relative z-10 w-full h-full overflow-y-auto pr-0.5 sm:pr-1 overflow-x-hidden custom-adventure-scrollbar">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
};
