/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Volume2,
  VolumeX,
  Scroll,
  Compass,
  Feather,
  Info,
  X,
  Clock,
  Heart,
} from 'lucide-react';
import { ScrollItem } from './types';
import { INITIAL_SCROLLS, CATEGORY_NAMES } from './data/initialScrolls';
import { PixelForestScene } from './components/PixelForestScene';
import { WriteScrollModal } from './components/WriteScrollModal';
import { ReadScrollModal } from './components/ReadScrollModal';
import { FlyingScroll } from './components/FlyingScroll';
import { sound } from './utils/audio';

const STORAGE_KEY_SCROLLS = 'aot_levi_hange_scrolls_v2';
const STORAGE_KEY_MY = 'aot_levi_hange_my_v2';

export default function App() {
  // State for all scrolls in the tree hollow
  const [scrolls, setScrolls] = useState<ScrollItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SCROLLS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {}
    return INITIAL_SCROLLS;
  });

  // State for scrolls created by current user
  const [myScrolls, setMyScrolls] = useState<ScrollItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_MY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {}
    return [];
  });

  // Modals & Active Scroll
  const [isWriteOpen, setIsWriteOpen] = useState(false);
  const [isMyListOpen, setIsMyListOpen] = useState(false);
  const [activeReadScroll, setActiveReadScroll] = useState<ScrollItem | null>(null);
  const [isFlyingScroll, setIsFlyingScroll] = useState(false);
  const [pendingScroll, setPendingScroll] = useState<ScrollItem | null>(null);
  const [audioActive, setAudioActive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Sync to local storage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SCROLLS, JSON.stringify(scrolls));
    } catch {}
  }, [scrolls]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_MY, JSON.stringify(myScrolls));
    } catch {}
  }, [myScrolls]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast(null);
    }, 2800);
  }, []);

  // Audio Toggle
  const handleToggleAudio = () => {
    const active = sound.toggleMute();
    setAudioActive(active);
    showToast(active ? '已开启巨木森林背景音 📢' : '已静音');
  };

  // Submit new scroll into tree hollow
  const handleWriteSubmit = (newScroll: ScrollItem) => {
    setScrolls((prev) => [newScroll, ...prev]);
    setMyScrolls((prev) => [newScroll, ...prev]);
    showToast('卷轴已投入巨树树洞 ✨');
  };

  // Pick up / Delve into tree hollow (第一阶段核心功能：点击拾取，带物理飞行位移动画)
  const handleDelveHollow = useCallback(() => {
    if (isFlyingScroll) return;

    if (scrolls.length === 0) {
      showToast('树洞空空如也，先写一张放进去吧');
      return;
    }

    // Pick a random scroll (preferring one not currently open)
    const available = scrolls.filter((s) => s.id !== activeReadScroll?.id);
    const chosen =
      available.length > 0
        ? available[Math.floor(Math.random() * available.length)]
        : scrolls[0];

    // Close currently opened scroll modal first if any
    setActiveReadScroll(null);
    setPendingScroll(chosen);
    setIsFlyingScroll(true);

    // Audio feedback: scroll whooshes out of the tree cavity
    sound.playRetrieve();
  }, [isFlyingScroll, scrolls, activeReadScroll, showToast]);

  // When flying animation completes and reaches screen center:
  const handleFlightComplete = useCallback(() => {
    setIsFlyingScroll(false);
    sound.playUnroll();
    if (pendingScroll) {
      setActiveReadScroll(pendingScroll);
      setPendingScroll(null);
    }
  }, [pendingScroll]);

  // Like resonance handler (献出心脏)
  const handleLike = (id: string) => {
    setScrolls((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, likes: item.likes + 1 } : item
      )
    );
    setMyScrolls((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, likes: item.likes + 1 } : item
      )
    );
    showToast('为这份心语献出了心脏 ❤️');
  };

  // Gift firefly handler (赠一碗热汤)
  const handleGiftFirefly = (id: string) => {
    setScrolls((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, fireflies: item.fireflies + 1 } : item
      )
    );
    setMyScrolls((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, fireflies: item.fireflies + 1 } : item
      )
    );
    showToast('送出了一碗暖胃的热汤 🍲');
  };

  return (
    <div className="min-h-dvh bg-[#070913] text-[#e2e8f0] flex flex-col items-center justify-between p-2 sm:p-4 font-pixel select-none">
      {/* Mobile Screen Container */}
      <main className="w-full max-w-md flex-1 flex flex-col justify-between mx-auto relative bg-[#0b0e20] border-2 sm:border-4 border-[#1c382b] rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden">
        
        {/* Top Header Card - Styled faithfully to reference screenshot "利韩土豆仓" */}
        <header className="p-3 bg-[#193a2b] border-b-2 border-[#12281e] shadow-[0_3px_0_#0c1a13] flex items-center justify-between z-10">
          <div className="flex items-center gap-2.5">
            {/* Potato Icon matching reference screenshot */}
            <div className="w-9 h-9 rounded-lg bg-[#274c39] border border-[#3e6b52] flex items-center justify-center text-xl shadow-inner">
              🥔
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-xs sm:text-sm font-bold tracking-wide text-[#fbf0d0]">
                  利韩树洞 · 巨木森林
                </h1>
                <span className="text-[9px] px-1 py-0.2 rounded bg-[#0f241a] text-[#86efac] border border-[#23533a]">
                  同好
                </span>
              </div>
              <div className="text-[9px] text-[#789d88] mt-0.5">
                同好交流 & 心语卷轴驿站
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Ambient Sound Button (Styled like the retro horn/speaker 📢 in screenshot) */}
            <button
              id="toggle-audio-btn"
              onClick={handleToggleAudio}
              title={audioActive ? '静音' : '开启背景音'}
              className={`p-2 rounded-md border-2 transition-all cursor-pointer ${
                audioActive
                  ? 'bg-[#29553f] border-[#86efac] text-[#86efac] shadow-[0_2px_0_#0c1a13]'
                  : 'bg-[#152e22] border-[#294c3a] text-[#789d88] hover:text-[#fbf0d0]'
              }`}
            >
              {audioActive ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <VolumeX className="w-4 h-4" />
              )}
            </button>
          </div>
        </header>

        {/* Center Scene: Pixel Forest with Tree Stump and Levi/Hange Video Animation */}
        <div className="flex-1 flex flex-col justify-center p-2 relative">
          <PixelForestScene
            onTapHollow={handleDelveHollow}
            onOpenWrite={() => setIsWriteOpen(true)}
            isPicking={isFlyingScroll}
          >
            {/* Flying Scroll Animation: Moves from tree hollow to screen center */}
            {isFlyingScroll && (
              <FlyingScroll onComplete={handleFlightComplete} />
            )}
          </PixelForestScene>
        </div>

        {/* Bottom Interaction Buttons - Styled faithfully to reference screenshot */}
        <footer className="p-3 bg-[#101915] border-t-2 border-[#1c382b] flex flex-col gap-2.5 z-10">
          {/* Main Action Buttons Row */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Button 1: 投递卷轴 (Survey Corps Green Button matching screenshot '兵团驻地' style) */}
            <button
              id="write-scroll-action-btn"
              onClick={() => {
                sound.playClick();
                setIsWriteOpen(true);
              }}
              className="py-2.5 px-3 rounded-md border-2 border-[#12281d] shadow-[0_3px_0_#0c1a13] bg-[#1e3f30] text-[#fbf0d0] hover:bg-[#254c3a] active:translate-y-0.5 active:shadow-none transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span className="text-sm">📜</span>
              <div className="text-left">
                <div className="text-xs font-bold leading-none">投递卷轴</div>
                <div className="text-[9px] text-[#a7f3d0] leading-none mt-1">
                  写下投进树洞
                </div>
              </div>
            </button>

            {/* Button 2: 点击拾取 (Parchment Cream Button matching screenshot '资源外链' style) */}
            <button
              id="delve-scroll-action-btn"
              onClick={handleDelveHollow}
              disabled={isFlyingScroll}
              className={`py-2.5 px-3 rounded-md border-2 border-[#cfc4a3] shadow-[0_3px_0_#b8ac8c] bg-[#fefcf6] text-[#2c3d30] transition-all flex items-center justify-center gap-2 cursor-pointer ${
                isFlyingScroll
                  ? 'opacity-80 scale-[0.98] ring-2 ring-[#86efac]/50'
                  : 'hover:bg-[#f6f0dd] active:translate-y-0.5 active:shadow-none'
              }`}
            >
              <span className={`text-sm ${isFlyingScroll ? 'animate-bounce' : ''}`}>
                ⚔️
              </span>
              <div className="text-left">
                <div className="text-xs font-bold leading-none">
                  {isFlyingScroll ? '拾取中...' : '点击拾取'}
                </div>
                <div className="text-[9px] text-[#556b5c] leading-none mt-1">
                  {isFlyingScroll ? '卷轴飞出中' : '探寻同伴心事'}
                </div>
              </div>
            </button>
          </div>

          {/* Secondary Sub-Row: My Sent Scrolls & Tip */}
          <div className="flex items-center justify-between px-1">
            <button
              id="open-my-scrolls-btn"
              onClick={() => {
                sound.playClick();
                setIsMyListOpen(true);
              }}
              className="text-[10px] text-[#a7f3d0] hover:text-[#fbf0d0] flex items-center gap-1 cursor-pointer transition-colors"
            >
              <Scroll className="w-3 h-3 text-[#86efac]" />
              <span>查看我投递的卷轴 ({myScrolls.length})</span>
            </button>

            <span className="text-[10px] text-[#6e8577] flex items-center gap-1">
              <Info className="w-2.5 h-2.5 text-[#86efac]" />
              点击树洞或利韩小人亦可互动
            </span>
          </div>
        </footer>

        {/* Toast Notice */}
        {toast && (
          <div
            id="app-toast-notice"
            className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-3.5 py-1.5 rounded-md bg-[#162a20]/95 border-2 border-[#86efac] text-[#fbf0d0] text-xs font-pixel shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200 pointer-events-none"
          >
            {toast}
          </div>
        )}
      </main>

      {/* Writing Modal */}
      <WriteScrollModal
        isOpen={isWriteOpen}
        onClose={() => setIsWriteOpen(false)}
        onSubmit={handleWriteSubmit}
      />

      {/* Reading Modal (第一阶段核心：点击拾取后查看，无多余收藏负担) */}
      <ReadScrollModal
        scroll={activeReadScroll}
        isOpen={!!activeReadScroll}
        onClose={() => setActiveReadScroll(null)}
        onPickAnother={handleDelveHollow}
        onLike={handleLike}
        onGiftFirefly={handleGiftFirefly}
      />

      {/* My Scrolls Modal (Lightweight history of scrolls written by user) */}
      {isMyListOpen && (
        <div
          id="my-scrolls-modal-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200"
        >
          <div className="w-full max-w-sm max-h-[80vh] flex flex-col bg-[#162a20] text-[#fbf0d0] border-2 border-[#385c49] rounded-xl shadow-2xl overflow-hidden font-pixel">
            <div className="p-3 bg-[#112419] border-b-2 border-[#274636] flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Scroll className="w-4 h-4 text-[#86efac]" />
                <span className="text-xs font-bold text-[#fbf0d0]">
                  我投递进树洞的卷轴 ({myScrolls.length})
                </span>
              </div>
              <button
                onClick={() => setIsMyListOpen(false)}
                className="p-1 text-[#a7f3d0] hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {myScrolls.length === 0 ? (
                <div className="text-center py-10 text-[#769b84] text-xs">
                  <p className="mb-2 text-2xl">📜</p>
                  <p>你还没有向树洞投过卷轴。</p>
                  <p className="text-[10px] text-[#557864] mt-1">
                    点击“投递卷轴”，把想对利韩或巨木森林说的话放进去吧。
                  </p>
                </div>
              ) : (
                myScrolls.map((item) => {
                  const catInfo =
                    CATEGORY_NAMES[item.category] || CATEGORY_NAMES.whisper;
                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        setIsMyListOpen(false);
                        setActiveReadScroll(item);
                      }}
                      className="p-2.5 rounded-md bg-[#1d3527] hover:bg-[#254533] border-2 border-[#2f553f] transition-all cursor-pointer shadow-sm"
                    >
                      <div className="flex items-center justify-between mb-1.5 text-[10px]">
                        <span className={`px-1.5 py-0.2 rounded border ${catInfo.tagBg}`}>
                          {catInfo.icon} {catInfo.label}
                        </span>
                        <span className="text-[#84a893] flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {new Date(item.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-xs text-[#fbf0d0] line-clamp-2 leading-relaxed mb-2 font-pixel">
                        {item.content}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-[#84a893] border-t border-[#2d503b] pt-1.5">
                        <span>✍ {item.author || '巨木森林同行者'}</span>
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-0.5 text-rose-300">
                            <Heart className="w-2.5 h-2.5 fill-rose-500/60" />
                            {item.likes}
                          </span>
                          <span className="flex items-center gap-0.5 text-amber-300">
                            🍲 {item.fireflies}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-2.5 bg-[#112419] border-t border-[#274636] text-[10px] text-center text-[#789d88]">
              塔塔开！深林漫漫，文字永远散发着热度
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
