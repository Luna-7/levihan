import React, { useState, useEffect } from 'react';
import { X, Heart, Sparkles, RefreshCw, ArrowLeft } from 'lucide-react';
import { ScrollItem } from '../types';
import { CATEGORY_NAMES } from '../data/initialScrolls';
import { sound } from '../utils/audio';

interface ReadScrollModalProps {
  scroll: ScrollItem | null;
  isOpen: boolean;
  onClose: () => void;
  onPickAnother: () => void;
  onLike: (id: string) => void;
  onGiftFirefly: (id: string) => void;
}

export const ReadScrollModal: React.FC<ReadScrollModalProps> = ({
  scroll,
  isOpen,
  onClose,
  onPickAnother,
  onLike,
  onGiftFirefly,
}) => {
  const [hasLiked, setHasLiked] = useState(false);
  const [hasGifted, setHasGifted] = useState(false);
  const [animatingClose, setAnimatingClose] = useState(false);

  useEffect(() => {
    setHasLiked(false);
    setHasGifted(false);
  }, [scroll?.id]);

  if (!isOpen || !scroll) return null;

  const catInfo = CATEGORY_NAMES[scroll.category] || CATEGORY_NAMES.whisper;

  // Format timestamp
  const formatTime = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (mins < 5) return '刚刚自树洞飘出';
    if (mins < 60) return `${mins}分钟前的深夜`;
    if (hours < 24) return `${hours}小时前的巨木森林`;
    if (days === 1) return '昨夜壁外调查';
    return `${days}天前留存的心语`;
  };

  const handleLikeClick = () => {
    if (hasLiked) return;
    setHasLiked(true);
    sound.playResonance();
    onLike(scroll.id);
  };

  const handleFireflyClick = () => {
    if (hasGifted) return;
    setHasGifted(true);
    sound.playResonance();
    onGiftFirefly(scroll.id);
  };

  const handleClose = () => {
    setAnimatingClose(true);
    setTimeout(() => {
      setAnimatingClose(false);
      onClose();
    }, 280);
  };

  return (
    <div
      id="read-scroll-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        id="read-scroll-container"
        className={`relative w-full max-w-sm transition-all duration-300 ease-out ${
          animatingClose
            ? 'scale-90 opacity-0 -translate-y-8'
            : 'scale-100 opacity-100 translate-y-0'
        }`}
      >
        {/* Top Scroll Wooden Roller Rod */}
        <div className="flex items-center justify-between px-2 -mb-2 z-10 relative">
          <div className="w-5 h-5 rounded-full bg-[#1b3a2b] border-2 border-[#0f241a] shadow-md flex items-center justify-center text-[9px] text-[#a7f3d0] font-bold">
            ◆
          </div>
          <div className="flex-1 h-3.5 mx-1 rounded-sm bg-gradient-to-b from-[#254d39] via-[#417a5d] to-[#1a382a] border border-[#0f241a] shadow-md flex items-center justify-center">
            <div className="w-16 h-1 bg-[#86efac]/40 rounded-full" />
          </div>
          <div className="w-5 h-5 rounded-full bg-[#1b3a2b] border-2 border-[#0f241a] shadow-md flex items-center justify-center text-[9px] text-[#a7f3d0] font-bold">
            ◆
          </div>
        </div>

        {/* Parchment Content - Styled with reference aesthetic */}
        <div
          id="read-scroll-parchment"
          className="relative bg-[#fcfaf2] text-[#2c2b26] border-x-4 border-y-2 border-[#cfc4a3] shadow-2xl p-4 sm:p-5 rounded-sm font-pixel"
          style={{
            backgroundImage:
              'radial-gradient(#e5dbbe 1px, transparent 1px), radial-gradient(#f1ebd5 1px, #fcfaf2 1px)',
            backgroundSize: '20px 20px',
            backgroundPosition: '0 0, 10px 10px',
          }}
        >
          {/* Top Status & Close button */}
          <div className="flex items-center justify-between mb-3 pb-2 border-b-2 border-dashed border-[#dcd2b8]">
            <div className="flex items-center gap-1.5">
              <span className={`px-2 py-0.5 rounded text-[10px] border ${catInfo.tagBg}`}>
                {catInfo.icon} {catInfo.label}
              </span>
              <span className="text-[10px] text-[#6b624f]">
                {formatTime(scroll.timestamp)}
              </span>
            </div>

            <button
              id="close-read-scroll-btn"
              onClick={handleClose}
              className="p-1 text-[#5c5443] hover:text-[#1c382b] hover:bg-[#eae3ce] rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scroll Content Body */}
          <div className="my-3.5 min-h-[90px] p-3.5 rounded bg-[#f6f2e4] border-2 border-[#d9ceb0] shadow-inner">
            <p className="text-xs sm:text-[13px] leading-relaxed text-[#23261f] whitespace-pre-wrap select-text font-pixel tracking-wide">
              {scroll.content}
            </p>
          </div>

          {/* Author Signature */}
          <div className="flex items-center justify-between text-[11px] text-[#4d473a] mb-3 pb-2 border-b border-[#ded5be]">
            <div className="flex items-center gap-1">
              <span>✍ 寄自：</span>
              <span className="font-bold text-[#1f3f30]">
                {scroll.author || '巨木森林同行者'}
              </span>
              {scroll.isMine && (
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#e8f5ed] border border-[#7bb393] text-[#1c4e33] ml-1">
                  你写下的
                </span>
              )}
            </div>
            <div className="w-6 h-6 rounded-md bg-[#1b3a2b] border border-[#0f241a] text-[#86efac] text-[10px] flex items-center justify-center font-bold shadow-xs">
              翼
            </div>
          </div>

          {/* Interactive Reactions */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              id="resonate-scroll-btn"
              onClick={handleLikeClick}
              className={`py-2 px-2 rounded-md border-2 font-pixel text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                hasLiked
                  ? 'bg-[#fee2e2] border-[#f87171] text-[#b91c1c] shadow-inner'
                  : 'bg-[#fefcf6] border-[#cfc4a3] shadow-[0_2px_0_#b8ac8c] text-[#334737] hover:bg-[#f5efde] active:translate-y-0.5 active:shadow-none'
              }`}
            >
              <Heart
                className={`w-3.5 h-3.5 ${
                  hasLiked ? 'fill-[#ef4444] text-[#ef4444]' : 'text-[#2b4c38]'
                }`}
              />
              <span>献出心脏 ({scroll.likes + (hasLiked ? 1 : 0)})</span>
            </button>

            <button
              id="gift-firefly-btn"
              onClick={handleFireflyClick}
              className={`py-2 px-2 rounded-md border-2 font-pixel text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                hasGifted
                  ? 'bg-[#fef3c7] border-[#f59e0b] text-[#92400e] shadow-inner'
                  : 'bg-[#fefcf6] border-[#cfc4a3] shadow-[0_2px_0_#b8ac8c] text-[#334737] hover:bg-[#f5efde] active:translate-y-0.5 active:shadow-none'
              }`}
            >
              <Sparkles
                className={`w-3.5 h-3.5 ${
                  hasGifted ? 'fill-[#f59e0b] text-[#f59e0b]' : 'text-[#849a6e]'
                }`}
              />
              <span>赠一碗热汤 ({scroll.fireflies + (hasGifted ? 1 : 0)})</span>
            </button>
          </div>

          {/* Action Row - Styled matching reference buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              id="close-back-hollow-btn"
              onClick={handleClose}
              className="py-2 px-3 rounded-md border-2 border-[#cfc4a3] shadow-[0_2px_0_#b8ac8c] bg-[#f4eedb] text-[#423d31] text-[11px] font-pixel hover:bg-[#ece4ce] active:translate-y-0.5 active:shadow-none transition-all cursor-pointer flex items-center justify-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>放回树洞</span>
            </button>

            <button
              id="pick-another-scroll-btn"
              onClick={() => {
                sound.playClick();
                setHasLiked(false);
                setHasGifted(false);
                onPickAnother();
              }}
              className="flex-1 py-2 px-3 rounded-md border-2 border-[#12281d] shadow-[0_3px_0_#0c1a13] bg-[#1e3f30] text-[#fbf0d0] text-[11px] font-pixel font-bold flex items-center justify-center gap-1.5 hover:bg-[#254c3a] active:translate-y-0.5 active:shadow-none transition-all cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#86efac]" />
              <span>再拾取一个卷轴</span>
            </button>
          </div>
        </div>

        {/* Bottom Scroll Wooden Roller Rod */}
        <div className="flex items-center justify-between px-2 -mt-2 z-10 relative">
          <div className="w-5 h-5 rounded-full bg-[#1b3a2b] border-2 border-[#0f241a] shadow-md flex items-center justify-center text-[9px] text-[#a7f3d0] font-bold">
            ◆
          </div>
          <div className="flex-1 h-3.5 mx-1 rounded-sm bg-gradient-to-b from-[#254d39] via-[#417a5d] to-[#1a382a] border border-[#0f241a] shadow-md flex items-center justify-center">
            <div className="w-16 h-1 bg-[#86efac]/40 rounded-full" />
          </div>
          <div className="w-5 h-5 rounded-full bg-[#1b3a2b] border-2 border-[#0f241a] shadow-md flex items-center justify-center text-[9px] text-[#a7f3d0] font-bold">
            ◆
          </div>
        </div>
      </div>
    </div>
  );
};
