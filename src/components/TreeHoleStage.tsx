import React, { useState } from 'react';

interface Props {
  onShowToast: (msg: string) => void;
}

/**
 * 深夜树洞分区：以 iframe 内嵌 /treehole/ 静态子应用。
 * 机框 / 指示灯条 / 加载骨架 / 沉浸模式 均沿用「塔塔开」分区的既有范式。
 * 树洞自带音效开关，故这里不提供 BGM 控制，只做提示。
 */
export const TreeHoleStage: React.FC<Props> = ({ onShowToast }) => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const handleFullscreen = () => {
    setIsFullscreen((v) => !v);
    onShowToast(isFullscreen ? '已退出树洞沉浸模式 🪵' : '进入树洞沉浸模式 🪵');
  };

  return (
    <div className="w-full flex flex-col gap-3 sm:gap-4">
      {/* 标题 + 操作工具栏 */}
      <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-md px-3 py-2 flex flex-wrap items-center justify-between gap-2 shadow-2xs text-xs font-retro-jp">
        <div className="flex items-center gap-2 text-[#5B4636]">
          <span className="font-pixel text-[#1E4334] font-bold">🪵 深夜树洞：</span>
          <span className="bg-[#FAF5E8] border border-[#D5C9AF] px-2 py-0.5 rounded-2xs text-[11px] text-[#B3402F] font-bold">
            写下心事 · 投进树洞 · 拾取他人卷轴
          </span>
        </div>

        <button
          onClick={handleFullscreen}
          className="px-2 sm:px-2.5 py-0.5 sm:py-1 bg-[#1E4334] hover:bg-[#2B5E4A] text-[#F9E79F] rounded-2xs cursor-pointer transition-all flex items-center gap-1 text-[10px] sm:text-[11px] font-pixel shadow-2xs"
          title="沉浸全屏"
        >
          <span>⛶</span>
          <span>{isFullscreen ? '退出全屏' : '沉浸模式'}</span>
        </button>
      </div>

      {/* iframe 内嵌主容器（竖屏卡片比例） */}
      <div
        className={
          isFullscreen
            ? 'fixed inset-0 z-50 bg-[#121A15]/95 backdrop-blur-md flex flex-col items-center justify-center p-2 sm:p-4'
            : 'relative w-full flex justify-center py-1'
        }
      >
        {isFullscreen && (
          <div className="w-full max-w-[460px] flex items-center justify-between pb-2 text-[#FAF5E8]">
            <div className="flex items-center gap-1.5 font-pixel text-xs text-[#F9E79F]">
              <span>🪵</span>
              <span>深夜树洞 · 沉浸中</span>
            </div>
            <button
              onClick={handleFullscreen}
              className="px-2 py-0.5 bg-[#B3402F] text-[#FAF5E8] rounded-2xs text-xs font-pixel cursor-pointer"
            >
              ✕ 退出
            </button>
          </div>
        )}

        {/* 树洞机框 */}
        <div className="relative w-fit max-w-full bg-[#142B21] border-3 sm:border-4 border-[#1E4334] rounded-md shadow-2xl overflow-hidden flex flex-col items-center">
          {/* 顶部指示灯条 */}
          <div className="w-full h-7 bg-[#1A382B] px-3 border-b border-[#2B5E4A] flex items-center justify-between select-none shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#E74C3C] animate-pulse" />
              <span className="w-2 h-2 rounded-full bg-[#F39C12]" />
              <span className="w-2 h-2 rounded-full bg-[#2ECC71]" />
              <span className="text-[10px] font-pixel text-[#F9E79F] ml-1">TREE HOLLOW</span>
            </div>
          </div>

          {/* 加载骨架屏 */}
          {isLoading && (
            <div className="absolute inset-0 top-7 bg-[#142B21] flex flex-col items-center justify-center gap-3 z-10 text-[#F9E79F] font-pixel">
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
              width: isFullscreen
                ? 'min(100vw, calc((100dvh - 96px) * 448 / 860))'
                : 'min(calc(100vw - 56px), calc((min(76vh, 860px) - 46px) * 448 / 860), 460px)',
            }}
          />
        </div>
      </div>

      {/* 底部玩法提示 */}
      <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-md p-3 sm:p-4 text-xs font-retro-jp space-y-2 text-[#5B4636] shadow-2xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-pixel text-[#1E4334] font-bold text-xs">
            <span>📜</span>
            <span>树洞玩法</span>
          </div>
          <span className="text-[11px] text-[#B3402F] font-bold">🌲 树洞内自带音效开关</span>
        </div>
        <ul className="space-y-1 text-[11px] leading-relaxed">
          <li>· 点「投递卷轴」写下心事，把它投进巨树树洞；</li>
          <li>· 点「点击拾取」随机读到一位同行者的卷轴；</li>
          <li>· 卷轴匿名封存，不记 IP、不留任何身份痕迹。</li>
        </ul>
        <p className="text-[10px] text-[#7A6958]">⚠️ 图源网络，侵删；树洞内容由同好自发投递。</p>
      </div>
    </div>
  );
};
