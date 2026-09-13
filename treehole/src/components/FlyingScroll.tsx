import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

interface FlyingScrollProps {
  onComplete: () => void;
}

export const FlyingScroll: React.FC<FlyingScrollProps> = ({ onComplete }) => {
  const [showArrivalPulse, setShowArrivalPulse] = useState(false);

  useEffect(() => {
    // Scroll takes 680ms to arrive at center
    const arrivalTimer = setTimeout(() => {
      setShowArrivalPulse(true);
    }, 620);

    const finishTimer = setTimeout(() => {
      onComplete();
    }, 780);

    return () => {
      clearTimeout(arrivalTimer);
      clearTimeout(finishTimer);
    };
  }, [onComplete]);

  return (
    <div
      id="flying-scroll-overlay"
      className="absolute inset-0 z-40 pointer-events-none overflow-hidden select-none"
    >
      {/* 1. Hollow Light Burst: Flash at the entrance of the tree hollow */}
      <div className="absolute left-[63%] top-[56%] -translate-x-1/2 -translate-y-1/2 pointer-events-none">
        <div className="w-16 h-20 rounded-full bg-gradient-to-r from-amber-400/40 via-emerald-400/50 to-amber-300/30 blur-md animate-hollow-burst" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-amber-300 animate-spin" />
        </div>
      </div>

      {/* 2. The Physical Flying Rolled Scroll */}
      <div className="absolute animate-flying-scroll flex flex-col items-center justify-center z-30">
        {/* Outer magical glow aura */}
        <div className="absolute -inset-3 rounded-full bg-gradient-to-r from-amber-300/30 via-emerald-300/25 to-yellow-200/35 blur-xs animate-pulse" />

        {/* Rolled Scroll Body */}
        <div className="relative w-16 h-10 flex flex-col items-center justify-between filter drop-shadow-lg">
          {/* Top Wooden Roller Spindle */}
          <div className="w-18 -mx-1 h-2 rounded-full bg-gradient-to-r from-[#142e22] via-[#2f5e45] to-[#142e22] border border-[#0d1e16] flex items-center justify-between px-0.5 shadow-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-[#fde047] border border-[#854d0e]" />
            <div className="w-6 h-0.5 bg-[#86efac]/50 rounded-full" />
            <div className="w-1.5 h-1.5 rounded-full bg-[#fde047] border border-[#854d0e]" />
          </div>

          {/* Rolled Parchment Cylinder */}
          <div className="w-14 flex-1 my-0.5 rounded-xs bg-gradient-to-b from-[#f8f5eb] via-[#ece5ce] to-[#f4eedb] border-x-2 border-[#cfc4a3] flex items-center justify-center relative shadow-inner">
            {/* Parchment texture paper lines */}
            <div className="absolute inset-x-1 top-1 h-[1px] bg-[#dfd6be]" />
            <div className="absolute inset-x-1 bottom-1 h-[1px] bg-[#dfd6be]" />

            {/* Crimson & Gold Survey Corps Ribbon Seal */}
            <div className="h-full w-3 bg-[#b91c1c] border-x border-[#991b1b] flex items-center justify-center shadow-xs">
              <div className="w-2 h-2 rounded-full bg-[#fde047] border border-[#78350f] flex items-center justify-center text-[7px] text-[#78350f] font-bold">
                ★
              </div>
            </div>
          </div>

          {/* Bottom Wooden Roller Spindle */}
          <div className="w-18 -mx-1 h-2 rounded-full bg-gradient-to-r from-[#142e22] via-[#2f5e45] to-[#142e22] border border-[#0d1e16] flex items-center justify-between px-0.5 shadow-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-[#fde047] border border-[#854d0e]" />
            <div className="w-6 h-0.5 bg-[#86efac]/50 rounded-full" />
            <div className="w-1.5 h-1.5 rounded-full bg-[#fde047] border border-[#854d0e]" />
          </div>
        </div>

        {/* Trailing Sparkle Pixels */}
        <div className="absolute -bottom-2 -left-2 w-1.5 h-1.5 rounded-full bg-amber-300 animate-ping opacity-75" />
        <div className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-emerald-300 animate-pulse opacity-80" />
      </div>

      {/* 3. Arrival Flash at Screen Center when scroll reaches destination */}
      {showArrivalPulse && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-40">
          <div className="w-24 h-24 rounded-full border-2 border-amber-300/80 bg-amber-300/20 animate-arrival-pulse" />
        </div>
      )}
    </div>
  );
};
