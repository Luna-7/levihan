import React, { useState, useRef, useEffect } from 'react';
import { CardPatternOverlay } from './CardPatternOverlay';
import { soundManager } from '../utils/audio';
import { UiSprite } from './UiSprite';
import { UI_SPRITES } from './uiSprite.generated';

const CHIBI_QUOTES = [
  '利威尔: 茶会桌子没擦干净，重新打扫！☕',
  '艾伦: 塔塔开！同人茶会也要全力以赴！⚔️',
  '三笠: 兵长茶会的点心，艾伦多吃一点。🧣',
  '阿尔敏: 这里的讨论区氛围好温馨啊！📖',
  '萨沙: 茶会供茶有烤红薯和烘焙小面包吗？干饭！🍠',
  '韩吉: 哇啊！大家快看，是调查兵团特供同人茶歇！🔬',
  '让: 喂喂，滑索上悬挂着可别晃得太厉害啊！',
  '阿尼: ...静静喝杯红茶就好。',
  '莱纳: 不愧是兵长的茶会，纪律与美德并存！',
  '贝尔托特: 大家的对白和接龙都好有趣啊...',
];

/**
 * 滑索小队：一整条「钢轨 + 10 个悬挂小人」的美术，钢轨左右都通到画布边缘，
 * 所以多份首尾相接后钢轨连续、接缝不可见（人物之间的空隙宽度与接缝处一致）。
 * 钢轨已经画在美术里，因此不再需要额外用 CSS 画一根缆绳。
 */
const STRIP = UI_SPRITES['zipline-strip'];
const STRIP_ASPECT = STRIP.width / STRIP.height;

/**
 * 平铺份数。每份宽度 = 展示区高度 × 比例，
 * 移动端约 474px、桌面约 593px，6 份足够覆盖到约 2965px 宽的视口（再多一份做循环缓冲）。
 * 改动这里不会影响动画：位移量是按一份的宽度算的。
 */
const COPY_COUNT = 6;

interface Props {
  onShowToast?: (msg: string) => void;
}

export const TeaPartyInteractiveZipline: React.FC<Props> = ({ onShowToast }) => {
  const [isPaused, setIsPaused] = useState(false);
  const [isFast, setIsFast] = useState(false);
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const [clickCount, setClickCount] = useState(0);

  // 拖拽手势状态
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // 展示区的真实高度：整条滑索按它等比缩放，人物高度就等于 header 高度（不被缩小）
  const [stageHeight, setStageHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setStageHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const copyWidth = stageHeight > 0 ? stageHeight * STRIP_ASPECT : 0;

  const handleChibiClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    soundManager.playWoodTap();
    const nextIdx = (clickCount + 1) % CHIBI_QUOTES.length;
    setClickCount(nextIdx);
    const quote = CHIBI_QUOTES[nextIdx];
    if (onShowToast) {
      onShowToast(`✨ ${quote}`);
    }
  };

  // 触摸 / 鼠标拖拽处理
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setStartX(e.clientX - dragOffset);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setDragOffset(e.clientX - startX);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      setIsDragging(true);
      setStartX(e.touches[0].clientX - dragOffset);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length === 0) return;
    setDragOffset(e.touches[0].clientX - startX);
  };

  return (
    // 纵深感：上亮下暗的纵向渐变 + 内嵌阴影，把卡片做成一条有厚度的横梁；
    // 透明度在上次 25 的基础上再降 40%（→ 15）
    <div
      className="w-full shrink-0 relative overflow-hidden select-none bg-gradient-to-b from-[#F2E5CB]/15 via-[#E3D4B9]/15 to-[#D2BA94]/30 border-b-2 border-[#B89874] shadow-[inset_0_8px_16px_rgba(48,32,20,0.20),inset_0_-4px_10px_rgba(255,255,255,0.30),0_14px_28px_rgba(48,32,20,0.16)]"
      style={{ perspective: '640px' }}
    >
      <CardPatternOverlay opacity={0.08} mode="multiply" />

      {/* 交互滑索横带：整宽无缝循环 + 悬停/点击/拖拽互动 */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseUp}
        className="relative w-full h-16 sm:h-20 overflow-hidden cursor-grab active:cursor-grabbing group"
        style={{ transform: 'rotateX(5deg)', transformOrigin: '50% 0%' }}
      >
        {/* 动态向左循环平移（一份一份地接） */}
        <div
          className={`flex items-start w-max h-full pointer-events-auto transition-transform duration-100 ${
            isPaused || isDragging
              ? ''
              : isFast
              ? 'animate-zipline-loop-fast'
              : 'animate-zipline-loop'
          } group-hover:[animation-play-state:paused]`}
          style={
            {
              // 循环位移量 = 恰好一份的宽度，交给 CSS keyframes 读取
              '--zipline-shift': `${-copyWidth}px`,
              transform: isDragging || dragOffset !== 0 ? `translateX(${dragOffset}px)` : undefined,
            } as React.CSSProperties
          }
          onClick={handleChibiClick}
        >
          {/* 内层单独承担上下摆动：外层已经在动 translateX，
              同一个元素上两条 transform 动画会互相覆盖。
              drop-shadow 让人物在卡片上投下影子，加强纵深 */}
          <div className="flex items-start w-max h-full animate-zipline-bob drop-shadow-[0_9px_7px_rgba(48,32,20,0.32)]">
            {copyWidth > 0 &&
              Array.from({ length: COPY_COUNT }, (_, index) => (
                <UiSprite key={index} name="zipline-strip" width={copyWidth} role="presentation" />
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};
