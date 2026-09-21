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
 * 纯图标导航栏（2026-09-21 按用户参考图重做）：
 *  - 上面一行：仅 4 个图标（去掉文字标签，title/aria-label 兜底语义）；
 *  - 图标下方：行军进度条 —— 虚线为全程缝线、红色实线为已走进度；
 *    4 个爱心对齐在各图标正下方，当前打开页面的爱心放大高亮（红心=代表当前页）；
 *  - 行走像素小人 + 右端「靠墙伙伴小人 + NEXT」都站在图标下方的这条线上（勿删）；
 *  - 纯色纸底，不用渐变，无阴影/抬升特效。
 *
 * 容器高度 88 / 98 / 108px（base/sm/lg），index.css 的
 * .clear-adventure-nav 让位间距与此保持一致，正文不会被导航栏盖住。
 */
const NODE_X = [12.5, 37.5, 62.5, 87.5]; // 4 个节点横向位置（%），与图标列中心对齐
const LINE_TOP = 72; // 行军直线纵向位置（容器高度 %）：位于图标行下方
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
      <div className="relative w-full max-w-xl sm:max-w-2xl lg:max-w-3xl mx-auto h-[88px] sm:h-[98px] lg:h-[108px]">
        {/* 主题纸色平铺条（纯色，不用渐变） */}
        <div className="absolute inset-0 rounded-t-2xl border-t-2 border-[#C9B58C] bg-[#F6EDD7]" />

        {/* 纯图标导航行（去掉文字标签） */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between px-3 sm:px-4 pt-1.5 sm:pt-2">
          {STAGES.map((s, idx) => {
            const isActive = safeIndex === idx;
            return (
              <React.Fragment key={s.id}>
                <button
                  type="button"
                  onClick={() => handleSelectTab(s.id)}
                  title={s.stageName}
                  aria-label={s.stageName}
                  className={`flex-1 flex items-center justify-center py-1 px-1 cursor-pointer rounded-lg transition-transform active:scale-90 min-h-[36px] ${
                    isActive ? '' : 'opacity-75 hover:opacity-100'
                  }`}
                >
                  <div className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center">
                    <UiSprite
                      name={s.sprite}
                      width={isActive ? 26 : 23}
                      role="img"
                      label={s.stageName}
                      className="pointer-events-none"
                    />
                  </div>
                </button>

                {/* 竖向分隔线 (除最后一项外) */}
                {idx < STAGES.length - 1 && (
                  <div className="h-5 w-px bg-[#C9B58C] shrink-0 mt-2.5" />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* 行军直线：图标下方，虚线为全程缝线，红色实线为已走进度 */}
        <div
          className="absolute left-[12.5%] right-[12.5%] border-t-2 border-dashed border-[#8C6D4F]/55"
          style={{ top: `${LINE_TOP}%` }}
          aria-hidden="true"
        />
        <div
          className="absolute left-[12.5%] h-[3px] -mt-px bg-[#C52B2B] rounded-full transition-all duration-[650ms] ease-out"
          style={{
            top: `${LINE_TOP}%`,
            width: `${(safeIndex / (STAGES.length - 1)) * 75}%`,
          }}
          aria-hidden="true"
        />

        {/* 4 个爱心节点：对齐在各图标正下方，红心=已到达，当前页放大高亮 */}
        {STAGES.map((s, nodeIdx) => {
          const isCompleted = nodeIdx <= safeIndex;
          const isCurrent = nodeIdx === safeIndex;
          return (
            <div
              key={s.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none z-10"
              style={{ left: `${NODE_X[nodeIdx]}%`, top: `${LINE_TOP}%` }}
            >
              <Heart
                size={isCurrent ? 15 : 12}
                className={
                  isCompleted
                    ? `fill-[#C52B2B] text-[#8C1D1D] ${isCurrent ? 'drop-shadow-[0_0_3px_rgba(197,43,43,0.65)]' : ''}`
                    : 'text-[#8C6D4F] fill-white/80 opacity-60'
                }
              />
            </div>
          );
        })}

        {/* 行走中的像素小人：沿图标下方的直线插值，脚底贴线 */}
        <div
          className="absolute -translate-x-1/2 -translate-y-full z-30 pointer-events-none"
          style={{ left: `${heroX}%`, top: `${LINE_TOP}%` }}
        >
          <AdventureHeroSprite
            isWalking={isWalking}
            facingDirection={facingDirection}
            speechBubbleText={speechBubbleText}
            size={26}
          />
        </div>

        {/* 最右侧：靠墙伙伴小人 + NEXT 提示牌（与进度线同高，勿删） */}
        <div
          className="absolute right-[1.5%] -translate-y-1/2 flex flex-col items-center z-20 pointer-events-none"
          style={{ top: `${LINE_TOP}%` }}
        >
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
      </div>

      {/* 安全区垫条：与导航栏底缘同色 */}
      <div
        className="w-full max-w-xl mx-auto bg-[#F6EDD7]"
        style={{ height: 'max(env(safe-area-inset-bottom, 0px), 6px)' }}
      />
    </footer>
  );
};
