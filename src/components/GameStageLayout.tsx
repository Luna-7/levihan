import React from 'react';
import { NavigationTab } from '../types';

interface Props {
  activeTab: NavigationTab;
  onNavigateTab: (tabId: NavigationTab) => void;
  isSoundMuted: boolean;
  onToggleSound: () => void;
  onShowToast: (msg: string) => void;
  children: React.ReactNode;
}

export const GameStageLayout: React.FC<Props> = ({
  children,
}) => {
  return (
    <div className="relative w-full h-[100dvh] max-h-[100dvh] select-none overflow-hidden bg-transparent text-[#374151] flex flex-col justify-between pb-16 sm:pb-22">
      {/* 子页面主内容区：固定边框舞台卡片 (透明度降低25%，呈现精致磨砂透光效果) */}
      <main className="relative z-10 w-full max-w-5xl mx-auto px-1.5 xs:px-2.5 sm:px-4 md:px-6 pt-2 sm:pt-3 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="w-full h-full flex flex-col bg-[#FAF6ED]/70 backdrop-blur-md border-2 sm:border-3 border-[#1E4334] max-sm:border-b-0 rounded-2xl max-sm:rounded-b-none shadow-[0_12px_40px_rgba(0,0,0,0.18)] p-2.5 xs:p-3.5 sm:p-5 md:p-6 text-[#16273B] overflow-hidden">
          {/* 内部主视图容器：默认初始无滚轮，只有在列表/书籍/表单展开超出时才出现滚轮 */}
          <div className="relative z-10 w-full h-full overflow-y-auto pr-0.5 sm:pr-1 overflow-x-hidden custom-adventure-scrollbar">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
};
