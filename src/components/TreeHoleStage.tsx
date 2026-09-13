import React, { useState } from 'react';

/**
 * 深夜树洞分区：以 iframe 内嵌 /treehole/ 静态子应用。
 * 直接沉浸式呈现——不画外框、不加工具栏、不加指示灯条，让树洞自身的暗色像素
 * UI 自然延伸到主站的羊皮纸底色中，避免任何「机框式割裂感」。
 * 树洞自带音效开关；主站只在加载阶段露出骨架屏，其余时间与树洞内容无缝衔接。
 */
export const TreeHoleStage: React.FC = () => {
  const [isLoading, setIsLoading] = useState<boolean>(true);

  return (
    <div className="w-full flex flex-col items-center">
      {/* iframe 内嵌主容器（直接沉浸式，无外框） */}
      <div className="relative w-full flex justify-center py-1">
        <div className="relative w-fit max-w-full overflow-hidden flex flex-col items-center">
          {/* 加载骨架屏：与 iframe 内部 bg 同色，避免「白闪」 */}
          {isLoading && (
            <div className="absolute inset-0 top-0 bg-[#0b0c16] flex flex-col items-center justify-center gap-3 z-10 text-[#F9E79F] font-pixel">
              <div className="text-3xl animate-bounce">🪵 📜 🌲</div>
              <p className="text-xs tracking-wider animate-pulse">正在点亮巨木森林的树洞...</p>
              <div className="w-32 bg-[#0D1C16] h-1.5 rounded-full overflow-hidden border border-[#2B5E4A]">
                <div className="bg-[#EAA83B] h-full w-2/3 animate-pulse" />
              </div>
            </div>
          )}

          <iframe
            src="/treehole/index.html"
            title="深夜树洞"
            onLoad={() => setIsLoading(false)}
            allow="autoplay"
            className="border-0 bg-[#0b0c16]"
            style={{
              aspectRatio: '448 / 860',
              height: 'auto',
              // 移动端几乎占满整宽（仅留主站 RetroPixelFrame 的内边距），桌面端受高度约束
              width: 'min(calc(100vw - 16px), calc((min(100dvh, 900px) - 56px) * 448 / 860), 480px)',
            }}
          />
        </div>
      </div>
    </div>
  );
};
