import React, { useEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
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
  stageName: string;
  sprite: UiSpriteName;
  arrivalText: string;
}

const STAGES: StageItem[] = [
  { id: 'home', stageName: '兵团驻地', sprite: 'home', arrivalText: '📍 到达兵团驻地！' },
  { id: 'resources', stageName: '巨树餐厅', sprite: 'restaurant', arrivalText: '🍽️ 到达巨树餐厅！' },
  { id: 'doujinshi', stageName: '兵长茶会', sprite: 'tea-party', arrivalText: '☕ 到达兵长茶会！' },
  { id: 'dispatch', stageName: '联络', sprite: 'dispatch', arrivalText: '✉️ 到达联络处！' },
];

/**
 * 纯 CSS 主题色导航栏（2026-09-20 重做，同日修正）：
 *  - 不再用 nav-bar.webp 波浪美术图，改为主题纸色平铺条（纯色，不用渐变）；
 *  - 进度条小人走直线：四个节点均分（tab 中心 12.5%..87.5%），
 *    红色已走进度为一条水平直线，随切tab平移；
 *  - 进度线右端保留「靠墙伙伴小人 + NEXT」提示牌（nav-companion，勿删）；
 *  - 不设阴影 / 缩放 / 悬停抬升等特殊效果。
 *
 * 容器高度保持 min(26.65vw, 179.2px)，与 index.css 的
 * .clear-adventure-nav 让位间距一致，正文不会被导航栏盖住。
 */
const NODE_X = [12.5, 37.5, 62.5, 87.5]; // 4 个节点横向位置（%）
const LINE_Y = 24; // 行军直线纵向位置（%）
const WALK_DURATION = 650;

export const AdventureBottomNav: React.FC<Props> = ({ activeTab, onNavigateTab }) => {
  const [prevIndex, setPrevIndex] = useState<number>(() => {
    const idx = STAGES.findIndex((s) => s.id === activeTab);
    return idx >= 0 ? idx : 0;
  });
  const [isWalking, setIsWalking] = useState(false);
  const [facingDirection, setFacingDirection] = useState<'left' | 'right'>('right');
  const [speechBubbleText, setSpeechBubbleText] = useState<string | null>(null);

  const speechTimerRef = useRef<number | null>(null);
  const walkRafRef = useRef<number | null>(null);

  // 小人当前横向位置（容器百分比；沿直线动画）
  const [heroX, setHeroX] = useState<number>(NODE_X[0]);

  const currentIndex = STAGES.findIndex((s) => s.id === activeTab);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;

  // tab 切换：小人沿直线从上一节点走到新节点（rAF 插值）
  useEffect(() => {
    if (safeIndex === prevIndex) return;

    const fromX = NODE_X[prevIndex];
    const toX = NODE_X[safeIndex];
    setFacingDirection(toX >= fromX ? 'right' : 'left');
    setIsWalking(true);
    setSpeechBubbleText(null);

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / WALK_DURATION);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setHeroX(fromX + (toX - fromX) * eased);
      if (t < 1) {
        walkRafRef.current = requestAnimationFrame(step);
      } else {
        setIsWalking(false);
        setPrevIndex(safeIndex);
        setSpeechBubbleText(STAGES[safeIndex].arrivalText);
        if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
        speechTimerRef.current = window.setTimeout(() => setSpeechBubbleText(null), 2200);
      }
    };
    walkRafRef.current = requestAnimationFrame(step);

    return () => {
      if (walkRafRef.current) cancelAnimationFrame(walkRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIndex]);

  const handleSelectTab = (tab: NavigationTab) => {
    soundManager.playNavClick();
    if (tab === activeTab) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    onNavigateTab(tab);
  };

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 select-none">
      <div
        className="relative w-full max-w-xl sm:max-w-2xl lg:max-w-3xl mx-auto"
        style={{ height: 'min(26.65vw, 179.2px)' }}
      >
        {/* 主题纸色平铺条（纯色，不用渐变） */}
        <div className="absolute inset-0 rounded-t-2xl border-t-2 border-[#C9B58C] bg-[#F6EDD7]" />

        {/* 行军直线：虚线为全程缝线，红色实线为已走进度 */}
        <div
          className="absolute left-[12.5%] right-[12.5%] border-t-2 border-dashed border-[#8C6D4F]/55"
          style={{ top: `${LINE_Y}%` }}
          aria-hidden="true"
        />
        <div
          className="absolute left-[12.5%] h-[3px] -mt-px bg-[#C52B2B] rounded-full transition-all duration-[650ms] ease-out"
          style={{
            top: `${LINE_Y}%`,
            width: `${(safeIndex / (STAGES.length - 1)) * 75}%`,
          }}
          aria-hidden="true"
        />

        {/* 4 个爱心里程碑节点 */}
        {STAGES.map((s, nodeIdx) => {
          const isCompleted = nodeIdx <= safeIndex;
          return (
            <div
              key={s.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none z-10"
              style={{ left: `${NODE_X[nodeIdx]}%`, top: `${LINE_Y}%` }}
            >
              <Heart
                size={13}
                className={
                  isCompleted
                    ? 'fill-[#C52B2B] text-[#8C1D1D]'
                    : 'text-[#8C6D4F] fill-white/80 opacity-60'
                }
              />
            </div>
          );
        })}

        {/* 行走中的像素小人：沿直线插值，脚底贴线 */}
        <div
          className="absolute -translate-x-1/2 -translate-y-full z-30 pointer-events-none"
          style={{ left: `${heroX}%`, top: `${LINE_Y}%` }}
        >
          <AdventureHeroSprite
            isWalking={isWalking}
            facingDirection={facingDirection}
            speechBubbleText={speechBubbleText}
            size={26}
          />
        </div>

        {/* 最右侧：靠墙伙伴小人 + NEXT 提示牌（进度线终点右侧，站在导航栏上段） */}
        <div className="absolute right-[1.5%] top-[24%] -translate-y-1/2 flex flex-col items-center z-20 pointer-events-none">
          <UiSprite
            name="nav-companion"
            width={16}
            role="img"
            label="进度条靠墙角色"
            className="drop-shadow-xs shrink-0"
          />
          <span className="px-1 py-[0.5px] text-[7px] font-black bg-[#C52B2B] text-white rounded-xs leading-none shadow-2xs tracking-wider shrink-0 -mt-0.5">
            NEXT
          </span>
        </div>

        {/* 4 格核心跳转按键 */}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-3 sm:px-4 pt-1 pb-[7%] sm:pb-[5%]">
          {STAGES.map((s, idx) => {
            const isActive = safeIndex === idx;
            return (
              <React.Fragment key={s.id}>
                <button
                  type="button"
                  onClick={() => handleSelectTab(s.id)}
                  className={`flex-1 flex flex-col items-center justify-center py-1 px-1 relative cursor-pointer whitespace-nowrap rounded-lg min-h-[40px] ${
                    isActive ? 'text-[#1E4334]' : 'text-[#5D4733]'
                  }`}
                >
                  {/* 道具槽图标 */}
                  <div className="w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center relative mb-0.5">
                    <UiSprite
                      name={s.sprite}
                      width={isActive ? 22 : 20}
                      role="img"
                      label={s.stageName}
                      className="pointer-events-none"
                    />
                  </div>

                  {/* 标签文字 */}
                  <span
                    className={`font-serif-title text-xs sm:text-[13px] whitespace-nowrap tracking-tight ${
                      isActive ? 'font-black text-[#1E4334]' : 'font-bold text-[#5D4733]'
                    }`}
                  >
                    {s.stageName}
                  </span>
                </button>

                {/* 竖向分隔线 (除最后一项外) */}
                {idx < STAGES.length - 1 && (
                  <div className="h-4 w-px bg-[#C9B58C] shrink-0 mb-2 sm:mb-2.5" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* 安全区垫条：与导航栏底缘同色 */}
      <div
        className="w-full max-w-xl mx-auto bg-[#F6EDD7]"
        style={{ height: 'max(env(safe-area-inset-bottom, 0px), 6px)' }}
      />
    </footer>
  );
};
