import React, { useState, useRef } from 'react';
import { soundManager } from '../utils/audio';

interface Props {
  onShowToast: (msg: string) => void;
}

export const TatakaruGame: React.FC<Props> = ({ onShowToast }) => {
  const [activeGame, setActiveGame] = useState<'daxigua' | 'comingSoon'>('daxigua');
  const [iframeKey, setIframeKey] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleRefresh = () => {
    soundManager.playBlip();
    setIsLoading(true);
    setIframeKey((prev) => prev + 1);
    onShowToast('正在重新加载战局 🍉');
  };

  const handleToggleFullscreen = () => {
    soundManager.playCoin();
    setIsFullscreen(!isFullscreen);
    onShowToast(!isFullscreen ? '已进入沉浸式对局 ⚔️' : '已退出沉浸对局 🛡️');
  };

  return (
    <div id="tatakaru-embedded-root" className="space-y-4 text-[#2C241D]">
      {/* 顶部标牌 */}
      <div className="bg-[#1E4334] text-[#FAF5E8] border-2 sm:border-[3px] border-[#153025] rounded-md p-3.5 sm:p-5 shadow-md relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl">⚔️</span>
              <h2 className="font-pixel text-base sm:text-xl text-[#F9E79F] font-bold tracking-wide">
                塔塔开
              </h2>
            </div>
            <p className="font-retro-jp text-xs sm:text-sm text-[#D5F5E3] leading-relaxed">
              将心脏献给土豆，献给每一次并肩作战与永不熄灭的勇气。
            </p>
          </div>

          {/* 小游戏选择器 */}
          <div className="flex items-center gap-1.5 bg-[#142B21] border border-[#2B5E4A] p-1 rounded-xs">
            <button
              onClick={() => {
                soundManager.playBlip();
                setActiveGame('daxigua');
              }}
              className={`px-3 py-1 text-xs font-pixel rounded-2xs cursor-pointer transition-all ${
                activeGame === 'daxigua'
                  ? 'bg-[#B3402F] text-[#F9E79F] shadow-xs'
                  : 'text-[#D5C9AF] hover:text-[#FAF5E8]'
              }`}
            >
              🍉 合成大西瓜
            </button>
            <button
              onClick={() => {
                soundManager.playBlip();
                onShowToast('更多利韩主题像素小游戏开发中 🥔');
              }}
              className="px-3 py-1 text-xs font-pixel rounded-2xs text-[#8A7968] hover:text-[#D5C9AF] cursor-pointer"
              title="待解锁"
            >
              🔒 敬请期待
            </button>
          </div>
        </div>
      </div>

      {/* 游戏操作小工具栏 */}
      <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-md px-3 py-2 flex flex-wrap items-center justify-between gap-2 shadow-2xs text-xs font-retro-jp">
        <div className="flex items-center gap-2 text-[#5B4636]">
          <span className="font-pixel text-[#1E4334] font-bold">🎮 当前对局：</span>
          <span className="bg-[#FAF5E8] border border-[#D5C9AF] px-2 py-0.5 rounded-2xs text-[11px] text-[#B3402F] font-bold">
            利韩·合成大西瓜
          </span>
          <span className="hidden md:inline text-[11px] text-[#7A6958]">
            （点击或滑动屏幕放下水果）
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRefresh}
            className="px-2.5 py-1 bg-[#FAF5E8] hover:bg-[#F3EAD5] text-[#1E4334] border border-[#D5C9AF] rounded-2xs cursor-pointer transition-all flex items-center gap-1 text-[11px] font-bold shadow-2xs"
            title="重置并重新开始游戏"
          >
            <span>🔄</span>
            <span>重新开始</span>
          </button>

          <button
            onClick={handleToggleFullscreen}
            className="px-2.5 py-1 bg-[#1E4334] hover:bg-[#2B5E4A] text-[#F9E79F] rounded-2xs cursor-pointer transition-all flex items-center gap-1 text-[11px] font-pixel shadow-2xs"
            title="沉浸全屏对局"
          >
            <span>⛶</span>
            <span>{isFullscreen ? '退出全屏' : '沉浸模式'}</span>
          </button>
        </div>
      </div>

      {/* 游戏内嵌主容器 (9:16 标准竖屏移动游戏比例约束) */}
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
              <span>⚔️</span>
              <span>塔塔开 · 沉浸对局中</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRefresh}
                className="px-2 py-0.5 bg-[#1E4334] text-[#F9E79F] border border-[#3B7E64] rounded-2xs text-xs font-pixel cursor-pointer"
              >
                🔄 重开
              </button>
              <button
                onClick={handleToggleFullscreen}
                className="px-2.5 py-0.5 bg-[#B3402F] text-[#FAF5E8] rounded-2xs text-xs font-pixel cursor-pointer"
              >
                ✕ 退出
              </button>
            </div>
          </div>
        )}

        {/* 游戏机框体 */}
        <div
          className={`relative w-full max-w-[460px] bg-[#142B21] border-3 sm:border-4 border-[#1E4334] rounded-md shadow-2xl overflow-hidden flex flex-col items-center ${
            isFullscreen
              ? 'h-[calc(100vh-60px)] max-h-[860px]'
              : 'h-[620px] xs:h-[660px] sm:h-[720px] max-h-[76vh]'
          }`}
        >
          {/* 顶部怀旧指示灯 */}
          <div className="w-full bg-[#1A382B] px-3 py-1 border-b border-[#2B5E4A] flex items-center justify-between select-none">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#E74C3C] animate-pulse" />
              <span className="w-2 h-2 rounded-full bg-[#F39C12]" />
              <span className="w-2 h-2 rounded-full bg-[#2ECC71]" />
              <span className="text-[10px] font-pixel text-[#F9E79F] ml-1">TATAKARU STAGE</span>
            </div>
            <span className="text-[10px] font-mono text-[#A3E4D7]">9:16 RES</span>
          </div>

          {/* 加载骨架屏动画 */}
          {isLoading && (
            <div className="absolute inset-0 top-6 bg-[#142B21] flex flex-col items-center justify-center gap-3 z-10 text-[#F9E79F] font-pixel">
              <div className="text-3xl animate-bounce">🥔 🍉 ⚔️</div>
              <p className="text-xs tracking-wider animate-pulse">正在进入利韩战斗舞台...</p>
              <div className="w-32 bg-[#0D1C16] h-1.5 rounded-full overflow-hidden border border-[#2B5E4A]">
                <div className="bg-[#EAA83B] h-full w-2/3 animate-pulse" />
              </div>
            </div>
          )}

          {/* 原生内嵌游戏 Iframe */}
          <iframe
            ref={iframeRef}
            key={iframeKey}
            src="/daxigua/index.html"
            title="利韩合成大西瓜"
            onLoad={() => setIsLoading(false)}
            allow="autoplay; fullscreen"
            className="w-full h-full border-0 bg-white"
            style={{ display: 'block' }}
          />
        </div>
      </div>

      {/* 底部玩法提示与免责声明 */}
      <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-md p-3 sm:p-4 text-xs font-retro-jp space-y-2 text-[#5B4636] shadow-2xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-pixel text-[#1E4334] font-bold text-xs">
            <span>📜</span>
            <span>作战指南与玩法规则</span>
          </div>
          <span className="text-[11px] text-[#B3402F] font-bold">
            ⚠️ 免责声明：图源网络，侵删
          </span>
        </div>
        <ul className="list-disc list-inside space-y-1 text-[11px] sm:text-xs text-[#6E5844] leading-relaxed">
          <li>
            <b>操作方式：</b>鼠标左键点击或手指在屏幕左右轻扫，松开即可投下掉落物。
          </li>
          <li>
            <b>合成规则：</b>两个相同形态的水果/头像发生碰撞即可融合升级为更高阶形态，目标是向着终极巨大形态进发！
          </li>
          <li>
            <b>防触顶警戒：</b>掉落物堆积超过顶部虚线警戒线时游戏将结算，请合理规划堆叠布局。
          </li>
        </ul>
      </div>
    </div>
  );
};
