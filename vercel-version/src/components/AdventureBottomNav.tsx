import React, { useEffect, useState, useRef } from 'react';
import { NavigationTab } from '../types';
import { soundManager } from '../utils/audio';
import { AdventureHeroSprite } from './AdventureHeroSprite';
import { UiSprite } from './UiSprite';
import { UiSpriteName } from './uiSprite.generated';

interface Props {
  activeTab: NavigationTab;
  onNavigateTab: (tab: NavigationTab) => void;
}

interface StageItem {
  id: NavigationTab;
  stageNumber: number;
  stageName: string;
  stageSub: string;
  sprite: UiSpriteName;
  landmark: string;
  arrivalText: string;
}

const STAGES: StageItem[] = [
  {
    id: 'home',
    stageNumber: 1,
    stageName: '兵团驻地',
    stageSub: '要塞营地',
    sprite: 'home',
    landmark: '🏰',
    arrivalText: '📍 到达大本营！',
  },
  {
    id: 'resources',
    stageNumber: 2,
    stageName: '资源外链',
    stageSub: '原片·手稿·小说',
    sprite: 'resources',
    landmark: '📚',
    arrivalText: '📚 查阅官方典藏资料！',
  },
  {
    id: 'doujinshi',
    stageNumber: 3,
    stageName: '土豆粮仓',
    stageSub: '丰收粮仓',
    sprite: 'doujin',
    landmark: '🥔',
    arrivalText: '🥔 粮仓大丰收！',
  },
  {
    id: 'dispatch',
    stageNumber: 4,
    stageName: '联络',
    stageSub: '飞鸽信使',
    sprite: 'dispatch',
    landmark: '🕊️',
    arrivalText: '✉️ 到达通讯塔！',
  },
];

export const AdventureBottomNav: React.FC<Props> = ({ activeTab, onNavigateTab }) => {
  const [prevIndex, setPrevIndex] = useState<number>(() => {
    const idx = STAGES.findIndex((s) => s.id === activeTab);
    return idx >= 0 ? idx : 0;
  });
  const [isWalking, setIsWalking] = useState(false);
  const [facingDirection, setFacingDirection] = useState<'left' | 'right'>('right');
  const [speechBubbleText, setSpeechBubbleText] = useState<string | null>(null);

  const walkingTimerRef = useRef<number | null>(null);
  const speechTimerRef = useRef<number | null>(null);

  const currentIndex = STAGES.findIndex((s) => s.id === activeTab);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;

  useEffect(() => {
    if (safeIndex !== prevIndex) {
      // 判断行走方向：从左往右走 face right, 从右往左走 face left
      const direction = safeIndex === 0 ? 'right' : safeIndex > prevIndex ? 'right' : 'left';
      setFacingDirection(direction);
      setIsWalking(true);
      setSpeechBubbleText(null);

      // 清除旧计时器
      if (walkingTimerRef.current) window.clearTimeout(walkingTimerRef.current);
      if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);

      // 650ms 后到达目的地
      walkingTimerRef.current = window.setTimeout(() => {
        setIsWalking(false);
        setPrevIndex(safeIndex);

        // 弹出到达地点的气泡对话
        const stage = STAGES[safeIndex];
        setSpeechBubbleText(stage.arrivalText);

        speechTimerRef.current = window.setTimeout(() => {
          setSpeechBubbleText(null);
        }, 2200);
      }, 650);
    }
  }, [safeIndex, prevIndex]);

  const handleSelectTab = (tab: NavigationTab) => {
    if (tab === activeTab) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    soundManager.playWoodTap();
    onNavigateTab(tab);
  };

  // 小人在道路上的横向百分比位置 (4个格子，各占 25%，中心点为 12.5%, 37.5%, 62.5%, 87.5%)
  const heroLeftPercent = safeIndex * 25 + 12.5;

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 bg-transparent select-none pb-[var(--sab)]">
      {/* ====================================================
          上层：调查兵团行军路 (绿+紫双色渐变爱心进度条)
         ==================================================== */}
      <div className="relative w-full max-w-xl mx-auto h-7 sm:h-8 bg-transparent overflow-visible">
        {/* 道路底纹与爱心里程碑连线 (绿+紫渐变) */}
        <div className="absolute top-1/2 left-4 right-4 h-2 -translate-y-1/2 bg-[#E5DACE] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#2B7A4B] via-[#48BB78] to-[#805AD5] rounded-full transition-all duration-700 ease-out"
            style={{ width: `${(safeIndex / 3) * 100}%` }}
          />
        </div>

        <UiSprite
          name="nav-companion"
          width={19}
          role="img"
          label="进度条右侧角色"
          className="absolute right-0.5 bottom-0 z-20 pointer-events-none drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)]"
        />

        {/* 4 个地标驿站爱心节点 */}
        <div className="absolute inset-0 grid grid-cols-4 items-center px-1">
          {STAGES.map((s, idx) => (
            <div key={s.id} className="flex flex-col items-center justify-center relative">
              <div
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] transition-all duration-300 shadow-2xs ${
                  safeIndex === idx
                    ? 'bg-[#805AD5] text-white scale-125 shadow-[0_0_8px_rgba(128,90,213,0.6)]'
                    : safeIndex > idx
                    ? 'bg-[#2B7A4B] text-[#D5F5E3]'
                    : 'bg-white text-[#C5B4A0]'
                }`}
                title="爱心里程节点"
              >
                <span className="leading-none select-none">♥</span>
              </div>
            </div>
          ))}
        </div>

        {/* 行走中的像素小人 (沿道路滑行至目标) */}
        <div
          className="absolute -top-3.5 sm:-top-4 transition-all duration-650 ease-out z-20 pointer-events-none"
          style={{
            left: `${heroLeftPercent}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <AdventureHeroSprite
            isWalking={isWalking}
            facingDirection={facingDirection}
            speechBubbleText={speechBubbleText}
            size={34}
          />
        </div>
      </div>

      {/* ====================================================
          下层：4 格核心跳转按键 (去除墨绿粗边框，保持极简无边框轻盈质感)
         ==================================================== */}
      <div className="w-full max-w-xl mx-auto grid grid-cols-4 items-center justify-around px-1 py-1 sm:py-1.5 bg-[#FAF6ED]/95 backdrop-blur-md shadow-[0_-2px_12px_rgba(0,0,0,0.08)]">
        {STAGES.map((s, idx) => {
          const isActive = safeIndex === idx;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => handleSelectTab(s.id)}
              className={`flex flex-col items-center justify-center py-1 px-1 relative transition-all cursor-pointer whitespace-nowrap shrink-0 rounded-xl ${
                isActive
                  ? 'bg-gradient-to-b from-[#F5EFE0] to-[#EAE0CD] scale-102 shadow-[0_2px_8px_rgba(0,0,0,0.08)]'
                  : 'opacity-75 hover:opacity-100 hover:bg-[#F5EFE0]'
              }`}
            >
              {/* 激活爱心指引 */}
              {isActive && (
                <span className="absolute -top-1.5 text-[9px] text-[#805AD5] animate-bounce leading-none">
                  ♥
                </span>
              )}

              {/* 道具槽图标 */}
              <div className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center relative">
                <UiSprite
                  name={s.sprite}
                  width={isActive ? 29 : 26}
                  role="img"
                  label={s.stageName}
                  className="pointer-events-none drop-shadow-2xs transition-all"
                />
              </div>

              {/* 标题与分区副标 */}
              <div className="flex flex-col items-center mt-0.5 leading-none">
                <span
                  className={`font-serif-title text-[10px] sm:text-xs leading-none whitespace-nowrap ${
                    isActive ? 'text-[#1E4334] font-black' : 'text-[#715431] font-semibold'
                  }`}
                >
                  {s.stageName}
                </span>
                <span className="font-serif-title text-[7px] sm:text-[8px] text-[#9A8772] scale-90 whitespace-nowrap mt-0.5">
                  {s.stageSub}
                </span>
              </div>
            </button>
          );
        })}
      </div>

    </footer>
  );
};
