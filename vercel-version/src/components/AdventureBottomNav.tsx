import React, { useEffect, useState, useRef } from 'react';
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
    stageSub: '',
    sprite: 'home',
    landmark: '🏰',
    arrivalText: '📍 到达兵团驻地！',
  },
  {
    id: 'resources',
    stageNumber: 2,
    stageName: '巨树餐厅',
    stageSub: '',
    sprite: 'restaurant',
    landmark: '🍽️',
    arrivalText: '🍽️ 到达巨树餐厅！',
  },
  {
    id: 'doujinshi',
    stageNumber: 3,
    stageName: '兵长茶会',
    stageSub: '',
    sprite: 'tea-party',
    landmark: '☕',
    arrivalText: '☕ 到达兵长茶会！',
  },
  {
    id: 'dispatch',
    stageNumber: 4,
    stageName: '联络',
    stageSub: '',
    sprite: 'dispatch',
    landmark: '🕊️',
    arrivalText: '✉️ 到达联络处！',
  },
];

/**
 * 导航栏波浪羊皮纸（public/images/nav-bar.webp，1242×331）的行军路线。
 *
 * 路线由素材的 alpha 顶缘轮廓向纸内偏移 16px（正好落在美术自带的虚线
 * 缝线上）平滑而来：x ∈ [155, 1087]，对应 4 个 tab 中心的 12.5%..87.5%。
 * SVG 使用 preserveAspectRatio="none" 与背景图同步拉伸，所以任意宽度下
 * 线都贴合图片边缘。
 */
const VB_W = 1242;
const VB_H = 331;
const ROUTE_D =
  'M 155.0 88.9 C 161.2 86.8 179.5 78.3 192.0 75.9 C 204.5 73.5 217.5 72.6 230.0 74.5 C 242.5 76.5 254.7 82.2 267.0 87.6 C 279.3 93.0 291.7 103.1 304.0 106.8 C 316.3 110.5 328.5 110.4 341.0 109.8 C 353.5 109.2 366.5 106.7 379.0 103.4 C 391.5 100.1 403.7 94.5 416.0 89.9 C 428.3 85.3 440.5 79.5 453.0 75.8 C 465.5 72.0 478.5 68.6 491.0 67.5 C 503.5 66.3 515.7 66.9 528.0 68.8 C 540.3 70.8 552.7 75.6 565.0 79.3 C 577.3 83.0 589.5 89.3 602.0 91.1 C 614.5 92.9 627.5 92.8 640.0 90.3 C 652.5 87.8 664.7 80.0 677.0 76.2 C 689.3 72.4 701.7 68.8 714.0 67.5 C 726.3 66.3 738.5 67.0 751.0 68.7 C 763.5 70.5 776.5 74.3 789.0 78.2 C 801.5 82.2 813.7 88.0 826.0 92.4 C 838.3 96.8 850.5 101.9 863.0 104.8 C 875.5 107.8 888.5 109.8 901.0 109.9 C 913.5 110.1 925.7 109.8 938.0 105.7 C 950.3 101.7 962.7 91.1 975.0 85.8 C 987.3 80.5 999.5 75.7 1012.0 74.1 C 1024.5 72.5 1037.5 73.6 1050.0 76.4 C 1062.5 79.1 1080.8 88.2 1087.0 90.6';

/** 4 个里程碑节点的 viewBox 坐标（x 对齐 tab 中心，y 为路径采样值） */
const NODE_X = [155, 466, 776, 1087];
const NODE_Y = [88.9, 72.1, 74.2, 90.6];

const WALK_DURATION = 650;

export const AdventureBottomNav: React.FC<Props> = ({ activeTab, onNavigateTab }) => {
  const [prevIndex, setPrevIndex] = useState<number>(() => {
    const idx = STAGES.findIndex((s) => s.id === activeTab);
    return idx >= 0 ? idx : 0;
  });
  const [isWalking, setIsWalking] = useState(false);
  const [facingDirection, setFacingDirection] = useState<'left' | 'right'>('right');
  const [speechBubbleText, setSpeechBubbleText] = useState<string | null>(null);

  // 导航栏常驻展示（2026-09-20 起取消「收起 / 滑到底部弹出」行为）
  const speechTimerRef = useRef<number | null>(null);
  const walkRafRef = useRef<number | null>(null);

  // SVG 路径总长与 4 个节点的弧长（挂载后测量一次）
  const routePathRef = useRef<SVGPathElement | null>(null);
  const [totalLen, setTotalLen] = useState<number | null>(null);
  const nodeLenRef = useRef<number[]>([0, 0, 0, 0]);

  // 小人当前位置（容器百分比；沿路径动画由 getPointAtLength 驱动）
  const [heroPos, setHeroPos] = useState<{ xp: number; yp: number }>(() => ({
    xp: (NODE_X[0] / VB_W) * 100,
    yp: (NODE_Y[0] / VB_H) * 100,
  }));

  const currentIndex = STAGES.findIndex((s) => s.id === activeTab);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;

  // 挂载后：测路径总长 + 二分找 4 个节点 x 对应的弧长
  useEffect(() => {
    const pathEl = routePathRef.current;
    if (!pathEl) return;
    const total = pathEl.getTotalLength();
    setTotalLen(total);

    const lenAtX = (targetX: number) => {
      let lo = 0;
      let hi = total;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (pathEl.getPointAtLength(mid).x < targetX) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    nodeLenRef.current = NODE_X.map(lenAtX);

    // 校正小人初始位置到路径上的准确点
    const p0 = pathEl.getPointAtLength(nodeLenRef.current[safeIndex]);
    setHeroPos({ xp: (p0.x / VB_W) * 100, yp: (p0.y / VB_H) * 100 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // tab 切换：小人沿 SVG 路径从上一节点走到新节点（rAF 插值）
  useEffect(() => {
    if (safeIndex === prevIndex) return;
    const pathEl = routePathRef.current;
    if (!pathEl || totalLen === null) {
      // 路径未就绪时直接落位
      setPrevIndex(safeIndex);
      return;
    }

    const fromLen = nodeLenRef.current[prevIndex];
    const toLen = nodeLenRef.current[safeIndex];
    setFacingDirection(toLen >= fromLen ? 'right' : 'left');
    setIsWalking(true);
    setSpeechBubbleText(null);

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / WALK_DURATION);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const len = fromLen + (toLen - fromLen) * eased;
      const pt = pathEl.getPointAtLength(len);
      setHeroPos({ xp: (pt.x / VB_W) * 100, yp: (pt.y / VB_H) * 100 });
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
  }, [safeIndex, totalLen]);

  const handleSelectTab = (tab: NavigationTab) => {
    soundManager.playNavClick();
    if (tab === activeTab) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    onNavigateTab(tab);
  };

  // 已走进度：红色实线画到当前节点（dashoffset 过渡与小人工时一致）
  const walkedLen = totalLen === null ? 0 : nodeLenRef.current[safeIndex];

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 select-none">
      <div className="relative w-full max-w-xl sm:max-w-2xl lg:max-w-3xl mx-auto">
        {/* ====================================================
            波浪羊皮纸导航栏背景（上缘自带深棕描边与虚线缝线）
           ==================================================== */}
        <img
          src="/images/nav-bar.webp"
          alt=""
          draggable={false}
          className="w-full h-auto block pointer-events-none select-none drop-shadow-[0_-4px_16px_rgba(44,30,20,0.14)]"
        />

        {/* ====================================================
            行军路线 SVG：虚线为全程缝线，红色实线为已走进度，
            二者都沿图片顶缘轮廓绘制（preserveAspectRatio=none 与
            背景图同步拉伸）
           ==================================================== */}
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
          aria-hidden="true"
        >
          <path
            d={ROUTE_D}
            fill="none"
            stroke="#8C6D4F"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray="11 9"
            opacity={0.55}
          />
          <path
            ref={routePathRef}
            d={ROUTE_D}
            fill="none"
            stroke="#C52B2B"
            strokeWidth={5}
            strokeLinecap="round"
            style={
              totalLen === null
                ? { strokeDasharray: 0, strokeDashoffset: 0 }
                : {
                    strokeDasharray: totalLen,
                    strokeDashoffset: totalLen - walkedLen,
                    transition: 'stroke-dashoffset 650ms ease-out',
                    filter: 'drop-shadow(0 1px 1px rgba(140,29,29,0.35))',
                  }
            }
          />
          {/* 中央装饰爱心：素材在缝线 V 谷挂了一颗棕色爱心（中心约 617,104），
              原位叠一颗红色爱心盖住它，与里程碑爱心同色系 */}
          <path
            d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
            transform="translate(598 85) scale(1.6)"
            fill="#C52B2B"
            stroke="#8C1D1D"
            strokeWidth={1.4}
            style={{ filter: 'drop-shadow(0 1px 1px rgba(140,29,29,0.4))' }}
          />
        </svg>

        {/* 4 个爱心里程碑节点（y 跟随路径在对应 x 处的高度） */}
        {STAGES.map((s, nodeIdx) => {
          const isCompleted = nodeIdx <= safeIndex;
          const isReachable = totalLen !== null;
          return (
            <div
              key={s.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none z-10 transition-all duration-300"
              style={{
                left: `${(NODE_X[nodeIdx] / VB_W) * 100}%`,
                top: `${(NODE_Y[nodeIdx] / VB_H) * 100}%`,
              }}
            >
              <Heart
                size={14}
                className={`transition-all duration-300 ${
                  isCompleted && isReachable
                    ? 'fill-[#C52B2B] text-[#8C1D1D] drop-shadow-2xs scale-110'
                    : 'text-[#8C6D4F] fill-white/80 opacity-60'
                }`}
              />
            </div>
          );
        })}

        {/* 最右侧：靠墙伙伴小人 + NEXT 提示牌（路径终点右侧的纸面坡下） */}
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

        {/* 行走中的像素小人：位置沿 SVG 路径插值，脚底贴线 */}
        <div
          className="absolute -translate-x-1/2 -translate-y-full z-30 pointer-events-none"
          style={{
            left: `${heroPos.xp}%`,
            top: `${heroPos.yp}%`,
          }}
        >
          <AdventureHeroSprite
            isWalking={isWalking}
            facingDirection={facingDirection}
            speechBubbleText={speechBubbleText}
            size={26}
          />
        </div>

        {/* ====================================================
            4 格核心跳转按键（覆盖在纸面下半部）
            兵团驻地 | 巨树餐厅 | 兵长茶会 | 联络
           ==================================================== */}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-3 sm:px-4 pt-1 pb-[7%] sm:pb-[5%]">
          {STAGES.map((s, idx) => {
            const isActive = safeIndex === idx;
            return (
              <React.Fragment key={s.id}>
                <button
                  type="button"
                  onClick={() => handleSelectTab(s.id)}
                  className={`flex-1 flex flex-col items-center justify-center py-1 px-1 relative transition-all cursor-pointer whitespace-nowrap rounded-lg min-h-[40px] ${
                    isActive
                      ? 'text-[#1E4334]'
                      : 'text-[#5D4733] hover:text-[#1E4334]'
                  }`}
                >
                  {/* 道具槽图标 */}
                  <div className="w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center relative mb-0.5">
                    <UiSprite
                      name={s.sprite}
                      width={isActive ? 22 : 20}
                      role="img"
                      label={s.stageName}
                      className={`pointer-events-none drop-shadow-2xs transition-all ${
                        isActive ? 'scale-110' : 'opacity-85'
                      }`}
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

      {/* 安全区垫条：颜色取自导航栏纸面底缘 */}
      <div
        className="w-full max-w-xl mx-auto bg-[#F7DDAF]"
        style={{ height: 'max(env(safe-area-inset-bottom, 0px), 6px)' }}
      />
    </footer>
  );
};
