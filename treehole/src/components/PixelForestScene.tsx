import React, { useEffect, useRef, useState } from 'react';
import { TRAVELER_DIALOGUES } from '../data/initialScrolls';
import { sound } from '../utils/audio';

interface PixelForestProps {
  onTapHollow: () => void;
  onOpenWrite?: () => void;
  isPicking?: boolean;
  children?: React.ReactNode;
}

const STORAGE_CUSTOM_BG = 'aot_custom_forest_bg';

export const PixelForestScene: React.FC<PixelForestProps> = ({
  onTapHollow,
  isPicking = false,
  children,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [bgSrc] = useState<string>(() => {
    // 作为 iframe 子应用，默认背景须挂在 base（/treehole/）之下，否则会请求到主站根目录 404
    return localStorage.getItem(STORAGE_CUSTOM_BG) || import.meta.env.BASE_URL + 'default_forest_bg.jpg';
  });
  const [characterQuote, setCharacterQuote] = useState<string | null>(null);
  const [hollowGlow, setHollowGlow] = useState(false);
  const [isHollowHovered, setIsHollowHovered] = useState(false);

  // Background image ref for canvas rendering
  const bgImgRef = useRef<HTMLImageElement | null>(null);

  // Dialog auto dismiss
  useEffect(() => {
    if (characterQuote) {
      const timer = setTimeout(() => {
        setCharacterQuote(null);
      }, 5500);
      return () => clearTimeout(timer);
    }
  }, [characterQuote]);

  // Handle character interaction
  const handleTapTravelers = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    sound.playClick();
    const randomDialogue =
      TRAVELER_DIALOGUES[Math.floor(Math.random() * TRAVELER_DIALOGUES.length)];
    setCharacterQuote(randomDialogue);
  };

  const handleTapTreeHollow = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setHollowGlow(true);
    setTimeout(() => setHollowGlow(false), 1200);
    onTapHollow();
  };

  // Preload background image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = bgSrc;
    img.onload = () => {
      bgImgRef.current = img;
    };
  }, [bgSrc]);

  // Main Canvas Animation Loop - Portrait Mobile Phone Aspect Ratio (9:16)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Portrait 9:16 mobile internal pixel resolution
    const W = 360;
    const H = 640;
    canvas.width = W;
    canvas.height = H;

    let animId: number;
    let frameCount = 0;

    // Ambient floating fireflies
    const fireflies: Array<{ x: number; y: number; vx: number; vy: number; size: number }> = [];
    for (let i = 0; i < 20; i++) {
      fireflies.push({
        x: Math.random() * W,
        y: Math.random() * (H * 0.75) + H * 0.15,
        vx: (Math.random() - 0.5) * 0.35,
        vy: -0.15 - Math.random() * 0.25,
        size: Math.random() > 0.65 ? 2 : 1,
      });
    }

    const render = () => {
      frameCount++;
      ctx.imageSmoothingEnabled = false;

      // 1. Draw Background Image (Portrait 9:16 Pixel Art)
      if (bgImgRef.current && bgImgRef.current.complete) {
        ctx.drawImage(bgImgRef.current, 0, 0, W, H);
      } else {
        // Fallback night sky gradient while loading
        const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
        skyGrad.addColorStop(0, '#0c102a');
        skyGrad.addColorStop(0.5, '#171c42');
        skyGrad.addColorStop(1, '#232b56');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, W, H);
      }

      // 2. Animated Ambient Campfire Light (Levi & Hange campfire at bottom-left: x: 21.5%, y: 67%)
      const fireX = W * 0.215;
      const fireY = H * 0.67;
      const fireFlicker = Math.sin(frameCount * 0.15) * 4 + Math.cos(frameCount * 0.28) * 3;
      const fireRadius = 56 + fireFlicker;

      const fireGlow = ctx.createRadialGradient(fireX, fireY, 6, fireX, fireY, fireRadius);
      fireGlow.addColorStop(0, 'rgba(254, 215, 170, 0.34)');
      fireGlow.addColorStop(0.42, 'rgba(249, 115, 22, 0.18)');
      fireGlow.addColorStop(1, 'rgba(249, 115, 22, 0)');
      ctx.fillStyle = fireGlow;
      ctx.beginPath();
      ctx.arc(fireX, fireY, fireRadius, 0, Math.PI * 2);
      ctx.fill();

      // Campfire flame pixel particles
      if (frameCount % 3 === 0) {
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(fireX - 2 + (Math.random() - 0.5) * 7, fireY - 6 - Math.random() * 9, 2, 2);
      }
      if (frameCount % 4 === 0) {
        ctx.fillStyle = '#f97316';
        ctx.fillRect(fireX - 3 + (Math.random() - 0.5) * 8, fireY - 4 - Math.random() * 11, 2, 2);
      }

      // 3. Tree Hollow Inner Ambient Glow (Right side giant tree trunk: x: 74%, y: 52%)
      const hollowX = W * 0.74;
      const hollowY = H * 0.52;
      const pulse = (Math.sin(frameCount * 0.05) + 1) * 0.5;
      const isGlowing = hollowGlow || isHollowHovered || isPicking;
      const glowAlpha = isGlowing ? 0.45 : 0.1 + pulse * 0.08;

      const hollowGlowGrad = ctx.createRadialGradient(
        hollowX,
        hollowY,
        2,
        hollowX,
        hollowY,
        isGlowing ? 36 : 22
      );
      hollowGlowGrad.addColorStop(0, `rgba(253, 224, 71, ${glowAlpha})`);
      hollowGlowGrad.addColorStop(0.6, `rgba(217, 119, 6, ${glowAlpha * 0.4})`);
      hollowGlowGrad.addColorStop(1, 'rgba(217, 119, 6, 0)');
      ctx.fillStyle = hollowGlowGrad;
      ctx.beginPath();
      ctx.arc(hollowX, hollowY, isGlowing ? 36 : 22, 0, Math.PI * 2);
      ctx.fill();

      // 4. Subtle Twinkling Stars in Upper Sky
      const twinkle1 = Math.sin(frameCount * 0.08) > 0.4;
      const twinkle2 = Math.cos(frameCount * 0.06) > 0.3;
      ctx.fillStyle = twinkle1 ? '#fef08a' : '#93c5fd';
      ctx.fillRect(W * 0.32, H * 0.09, 2, 2);
      ctx.fillRect(W * 0.78, H * 0.12, 2, 2);
      ctx.fillStyle = twinkle2 ? '#fef9c3' : '#a5b4fc';
      ctx.fillRect(W * 0.15, H * 0.15, 2, 2);
      ctx.fillRect(W * 0.88, H * 0.08, 2, 2);

      // 5. Floating Fireflies (萤火虫)
      fireflies.forEach((f) => {
        f.x += f.vx;
        f.y += f.vy;
        if (f.y < H * 0.12) {
          f.y = H * 0.88;
          f.x = Math.random() * W;
        }
        if (f.x < 0) f.x = W;
        if (f.x > W) f.x = 0;

        const fAlpha = (Math.sin(frameCount * 0.08 + f.x) + 1) * 0.5 * 0.75 + 0.25;
        ctx.fillStyle = `rgba(250, 204, 21, ${fAlpha})`;
        ctx.fillRect(Math.floor(f.x), Math.floor(f.y), f.size, f.size);
      });

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [bgSrc, hollowGlow, isHollowHovered, isPicking]);

  return (
    <div
      id="pixel-forest-container"
      className="relative w-full aspect-[9/16] max-h-[72vh] mx-auto select-none rounded-xl overflow-hidden border-2 border-[#1a2f24] bg-[#0c102a] shadow-inner"
    >
      {/* Retro Pixel Canvas - Portrait mobile 9:16 */}
      <canvas
        id="pixel-forest-canvas"
        ref={canvasRef}
        className="w-full h-full object-cover block [image-rendering:pixelated]"
      />

      {/* Subtle CRT scanline texture */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_65%,rgba(5,7,18,0.5)_100%)]" />

      {/* Interactive Touch Target & Retro Pixel Button: Tree Hollow on the Giant Tree (Right Side) */}
      <div className="absolute top-[48%] right-[3%] sm:right-[5%] z-20 flex flex-col items-center select-none pointer-events-auto">
        <button
          id="touch-tree-hollow"
          onClick={handleTapTreeHollow}
          onMouseEnter={() => setIsHollowHovered(true)}
          onMouseLeave={() => setIsHollowHovered(false)}
          aria-label="探寻树洞"
          className="btn-pixel-tree-hollow animate-pixel-step-bob group focus:outline-none"
        >
          {/* 8-bit Blinking Pixel Cursor */}
          <span className="text-[10px] text-[#fde047] animate-pixel-blink select-none leading-none">▶</span>

          {/* Retro Pixel Label with classic JRPG text shadow */}
          <span className="text-[12px] font-pixel font-bold tracking-wider text-[#fef08a] group-hover:text-white [text-shadow:1px_1px_0_#070d09,-1px_0_0_#070d09,0_1px_0_#070d09,0_-1px_0_#070d09] whitespace-nowrap leading-none">
            探寻树洞
          </span>

          {/* Retro Pixel Scroll Icon */}
          <span className="text-[11px] leading-none select-none">📜</span>
        </button>

        {/* 8-bit Stepped Pixel Pointer Arrow pointing toward the tree hollow */}
        <div className="w-0 h-0 border-x-[5px] border-x-transparent border-t-[6px] border-t-[#b89151] animate-retro-arrow mt-1 drop-shadow-[0_2px_0_#070d09] pointer-events-none" />
      </div>

      {/* Extended Touch Hitbox for Mobile: Easy tapping anywhere on the tree trunk hollow */}
      <div
        onClick={handleTapTreeHollow}
        onMouseEnter={() => setIsHollowHovered(true)}
        onMouseLeave={() => setIsHollowHovered(false)}
        className="absolute top-[42%] right-[1%] w-[38%] h-[28%] z-15 cursor-pointer"
        aria-hidden="true"
      />

      {/* Interactive Touch Target: Levi & Hange by campfire (Bottom-Left in 9:16 mobile scene) */}
      <button
        id="touch-travelers"
        onClick={handleTapTravelers}
        aria-label="与利韩对话"
        className="absolute top-[60%] left-[6%] w-[38%] h-[22%] rounded-xl z-20 cursor-pointer transition-all duration-200 group focus:outline-none"
      >
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-90 transition-all duration-200 whitespace-nowrap px-2 py-0.5 rounded bg-[#162a20]/90 border border-[#85986c] text-[#f7f2e4] text-[10px] font-pixel shadow pointer-events-none">
          <span>靠近篝火休息</span>
        </div>
      </button>

      {/* Dialogue Speech Bubble Popup */}
      {characterQuote && (
        <div
          id="character-dialogue-box"
          onClick={() => setCharacterQuote(null)}
          className="absolute bottom-3 left-2.5 right-2.5 z-30 p-3 rounded-lg bg-[#182b21]/95 border-2 border-[#5c7a65] shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-200 cursor-pointer"
        >
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded bg-[#2a4535] border border-amber-400/50 flex-shrink-0 flex items-center justify-center text-sm">
              🍵
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-pixel text-amber-300 font-bold">
                  巨木森林 · 篝火旁
                </span>
                <span className="text-[9px] text-slate-300 font-pixel">点击关闭</span>
              </div>
              <p className="text-[12px] leading-relaxed text-[#f4eedb] font-pixel">
                {characterQuote}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Overlay Elements (such as the Flying Scroll Animation) */}
      {children}
    </div>
  );
};
