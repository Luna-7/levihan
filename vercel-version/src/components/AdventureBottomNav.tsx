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
 * 行军进度条导航（2026-09-21 第四版，按用户要求）：
 *  - 进度条无任何背景，直接浮在页面内容上（虚线全程 + 红色已走 + 爱心 + 行走小人 + 靠墙伙伴 + NEXT）；
 *  - 点击进度条 = 切换到对应页面（按点击位置取最近的爱心节点）：
 *    非首页上导航栏（图标行）随切换同时出现，切换完成后自动缩回；
 *  - 首页（兵团驻地）不采用折叠逻辑，导航栏一直显现；
 *  - 爱心对齐各图标列正下方，红心高亮 = 当前打开的页面。
 *
 * 浮条高度 BAR_H=64px 恒定；导航本体高度 NAV_H=66/70/74px（base/sm/lg）。
 * index.css：.clear-adventure-nav（折叠页）/ .clear-adventure-nav-home（首页常驻）。
 */
const NODE_X = [12.5, 37.5, 62.5, 87.5]; // 4 个节点横向位置（%），与图标列中心对齐
const BAR_H = 64; // 进度条浮条高度（px）
const LINE_TOP = 36; // 行军直线在浮条内的纵向位置（px）：小人身体(26px)+气泡留在其上方
const RETRACT_MS = 900; // 切换动画(650ms)结束后缩回导航栏
const WALK_DURATION = 650;

export const AdventureBottomNav: React.FC<Props> = ({ activeTab, onNavigateTab }) => {
  const [prevIndex, setPrevIndex] = useState<number>(() => {
    const idx = STAGES.findIndex((s) => s.id === activeTab);
    return idx >= 0 ? idx : 0;
  });
  const [isWalking, setIsWalking] = useState(false);
  const [facingDirection, setFacingDirection] = useState<'left' | 'right'>('right');
  const [speechBubbleText, setSpeechBubbleText] = useState<string | null>(null);
  // 非首页：切换页面时导航栏短暂出现，完成后缩回
  const [transientNav, setTransientNav] = useState(false);

  const speechTimerRef = useRef<number | null>(null);
  const walkRafRef = useRef<number | null>(null);
  const retractTimerRef = useRef<number | null>(null);

  // 小人当前横向位置（容器百分比；沿直线动画）
  const [heroX, setHeroX] = useState<number>(NODE_X[0]);

  const currentIndex = STAGES.findIndex((s) => s.id === activeTab);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const isHome = activeTab === 'home';
  const navOpen = isHome ? true : transientNav;

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

  useEffect(() => () => {
    if (retractTimerRef.current) window.clearTimeout(retractTimerRef.current);
  }, []);

  const clearRetractTimer = () => {
    if (retractTimerRef.current) {
      window.clearTimeout(retractTimerRef.current);
      retractTimerRef.current = null;
    }
  };

  /** 切换到第 idx 站；导航栏短暂显现，切换完成后缩回（首页常显不受影响） */
  const navigateTo = (best: number) => {
    const target = STAGES[best];
    soundManager.playNavClick();
    if (best === safeIndex) {
      // 点的是当前页：回到顶部即可，不出导航栏
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    clearRetractTimer();
    setTransientNav(true);
    retractTimerRef.current = window.setTimeout(() => setTransientNav(false), RETRACT_MS);
    onNavigateTab(target.id);
  };

  /** 点击进度条：取最近爱心节点 → 切换对应页面 */
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    let best = 0;
    let bestDist = Infinity;
    NODE_X.forEach((nx, i) => {
      const d = Math.abs(nx - xPct);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    navigateTo(best);
  };

  const handleSelectTab = (tab: NavigationTab) => {
    soundManager.playNavClick();
    // 图标切换：切完即缩（首页若切走，目标页同样回到折叠态）
    clearRetractTimer();
    setTransientNav(false);
    if (tab === activeTab) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    onNavigateTab(tab);
  };

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 select-none">
      <div className="w-full max-w-xl sm:max-w-2xl lg:max-w-3xl mx-auto">
        {/* 行军进度条（无背景，常驻可见；点击直接切换对应页面） */}
        <div
          role="button"
          tabIndex={0}
          aria-label="行军进度条：点击切换到对应页面"
          title="点击进度条切换页面"
          onClick={handleProgressClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              // 键盘兜底：切到下一站
              navigateTo((safeIndex + 1) % STAGES.length);
            }
          }}
          className="relative mx-1 sm:mx-2 cursor-pointer outline-none"
          style={{ height: BAR_H }}
        >
          {/* 行军直线：虚线为全程缝线，红色实线为已走进度 */}
          <div
            className="absolute left-[6%] right-[6%] border-t-2 border-dashed border-[#8C6D4F]/55"
            style={{ top: LINE_TOP }}
            aria-hidden="true"
          />
          <div
            className="absolute left-[12.5%] h-[3px] -mt-px bg-[#C52B2B] rounded-full transition-all duration-[650ms] ease-out"
            style={{
              top: LINE_TOP,
              width: `${(safeIndex / (STAGES.length - 1)) * 75}%`,
            }}
            aria-hidden="true"
          />

          {/* 4 个爱心节点：对齐各图标列正下方，红心=已到达，当前页放大高亮 */}
          {STAGES.map((s, nodeIdx) => {
            const isCompleted = nodeIdx <= safeIndex;
            const isCurrent = nodeIdx === safeIndex;
            return (
              <div
                key={s.id}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none z-10"
                style={{ left: `${NODE_X[nodeIdx]}%`, top: LINE_TOP }}
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

          {/* 行走中的像素小人：沿直线插值，脚底贴线 */}
          <div
            className="absolute -translate-x-1/2 -translate-y-full z-30 pointer-events-none"
            style={{ left: `${heroX}%`, top: LINE_TOP }}
          >
            <AdventureHeroSprite
              isWalking={isWalking}
              facingDirection={facingDirection}
              speechBubbleText={speechBubbleText}
              size={26}
            />
          </div>

          {/* 最右侧：靠墙伙伴小人 + NEXT 提示牌（整体提高到与爱心齐平：站在线上，牌贴线上缘） */}
          <div
            className="absolute right-[1.5%] -translate-y-full flex flex-col items-center z-20 pointer-events-none"
            style={{ top: LINE_TOP }}
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

        {/* 导航栏本体：首页常驻显现；其他页面切换时短暂出现、切完缩回 */}
        <div
          className="overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
          style={{ maxHeight: navOpen ? 120 : 0, opacity: navOpen ? 1 : 0 }}
          aria-hidden={!navOpen}
        >
          <div className="relative bg-[#F6EDD7] border-2 border-[#C9B58C] rounded-2xl mx-1 sm:mx-2 h-[66px] sm:h-[70px] lg:h-[74px]">
            {/* 4 格核心跳转按键（纯图标） */}
            <div className="absolute inset-x-0 top-0 flex items-start justify-between px-3 sm:px-4 pt-2">
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
          </div>
        </div>
      </div>

      {/* iOS 安全区垫条（透明，仅占位避免贴边） */}
      <div
        className="w-full"
        style={{ height: 'max(env(safe-area-inset-bottom, 0px), 4px)' }}
      />
    </footer>
  );
};
