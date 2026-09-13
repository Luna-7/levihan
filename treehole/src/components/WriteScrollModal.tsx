import React, { useState } from 'react';
import { X, Send, Sparkles, Feather } from 'lucide-react';
import { ScrollCategory, ScrollItem } from '../types';
import { CATEGORY_NAMES } from '../data/initialScrolls';
import { sound } from '../utils/audio';

interface WriteScrollModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (newScroll: ScrollItem) => void;
}

export const WriteScrollModal: React.FC<WriteScrollModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [content, setContent] = useState('');
  const [author, setAuthor] = useState('');
  const [category, setCategory] = useState<ScrollCategory>('whisper');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || isSubmitting) return;

    setIsSubmitting(true);
    sound.playCast();

    setTimeout(() => {
      const newScroll: ScrollItem = {
        id: 'scroll-user-' + Date.now(),
        content: content.trim(),
        author: author.trim() || '巨木森林同行者',
        category,
        timestamp: Date.now(),
        likes: 0,
        fireflies: 1,
        isMine: true,
      };

      onSubmit(newScroll);
      setIsSubmitting(false);
      setContent('');
      onClose();
    }, 850);
  };

  return (
    <div
      id="write-scroll-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        id="write-scroll-wrapper"
        className={`relative w-full max-w-sm transition-all duration-700 ease-in-out ${
          isSubmitting
            ? 'scale-10 rotate-12 opacity-0 translate-y-32 blur-xs'
            : 'scale-100 rotate-0 opacity-100 translate-y-0'
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

        {/* Scroll Parchment Body */}
        <div
          id="write-scroll-parchment"
          className="relative bg-[#fcfaf2] text-[#2c2b26] border-x-4 border-y-2 border-[#cfc4a3] shadow-2xl p-4 sm:p-5 rounded-sm font-pixel"
          style={{
            backgroundImage:
              'radial-gradient(#e5dbbe 1px, transparent 1px), radial-gradient(#f1ebd5 1px, #fcfaf2 1px)',
            backgroundSize: '20px 20px',
            backgroundPosition: '0 0, 10px 10px',
          }}
        >
          {/* Close button */}
          <button
            id="close-write-scroll-btn"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 absolute top-2.5 right-2.5 text-[#5c5443] hover:text-[#1c382b] hover:bg-[#eae3ce] rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Title Header */}
          <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-dashed border-[#dcd2b8]">
            <Feather className="w-4 h-4 text-[#1e3f30]" />
            <h3 className="text-xs sm:text-sm font-bold tracking-wider text-[#1e3f30]">
              书写巨树卷轴
            </h3>
            <span className="text-[10px] text-[#6b624f] ml-auto">
              巨木森林 · 入夜封存
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Category Selector Chips */}
            <div>
              <label className="block text-[11px] font-bold text-[#353229] mb-1.5">
                卷轴标记：
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(CATEGORY_NAMES) as ScrollCategory[]).map((cat) => {
                  const info = CATEGORY_NAMES[cat];
                  const isSelected = category === cat;
                  return (
                    <button
                      type="button"
                      key={cat}
                      onClick={() => {
                        sound.playClick();
                        setCategory(cat);
                      }}
                      className={`text-[11px] px-2.5 py-1 rounded-md border-2 transition-all cursor-pointer font-bold ${
                        isSelected
                          ? 'bg-[#1e3f30] text-[#fbf0d0] border-[#12281d] shadow-[0_2px_0_#0c1a13]'
                          : 'bg-[#f6f2e4] text-[#4d473a] border-[#d5cbab] shadow-[0_2px_0_#b8ac8c] hover:bg-[#eae3ce]'
                      }`}
                    >
                      <span className="mr-1">{info.icon}</span>
                      {info.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scroll Content Textarea */}
            <div>
              <label className="block text-[11px] font-bold text-[#353229] mb-1">
                写下你想投进树洞的话：
              </label>
              <textarea
                id="scroll-content-input"
                rows={4}
                maxLength={200}
                required
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="在这片宁静的巨木森林里，写下你的心愿、疲惫或给同伴的轻声问候..."
                className="w-full p-2.5 text-xs text-[#22251e] placeholder-[#807764] bg-[#f8f5eb] border-2 border-[#cfc4a3] rounded-md shadow-inner focus:outline-none focus:border-[#1e3f30] resize-none leading-relaxed"
              />
              <div className="flex justify-between text-[10px] text-[#6b624f] mt-0.5 px-1">
                <span>古树会守口如瓶</span>
                <span>{content.length}/200</span>
              </div>
            </div>

            {/* Author / Alias */}
            <div>
              <label className="block text-[11px] font-bold text-[#353229] mb-1">
                落款署名（选填）：
              </label>
              <input
                id="scroll-author-input"
                type="text"
                maxLength={16}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="例如：墙内同好、佩特拉的松果、调查兵团新兵..."
                className="w-full p-2 text-xs text-[#22251e] placeholder-[#807764] bg-[#f8f5eb] border-2 border-[#cfc4a3] rounded-md focus:outline-none focus:border-[#1e3f30]"
              />
            </div>

            {/* Submit Button - Styled with screenshot button aesthetic */}
            <div className="pt-1.5">
              <button
                type="submit"
                id="submit-scroll-btn"
                disabled={!content.trim() || isSubmitting}
                className={`w-full py-2.5 px-4 rounded-md border-2 font-pixel text-xs font-bold tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  !content.trim() || isSubmitting
                    ? 'bg-[#a39a82] text-[#e6e0ce] border-[#8c826b] cursor-not-allowed opacity-75'
                    : 'bg-[#1e3f30] text-[#fbf0d0] border-[#12281d] shadow-[0_3px_0_#0c1a13] hover:bg-[#254c3a] active:translate-y-0.5 active:shadow-none'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <Sparkles className="w-3.5 h-3.5 animate-spin text-[#86efac]" />
                    <span>卷轴卷起，沉入树洞深处...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5 text-[#86efac]" />
                    <span>投放到巨树树洞里</span>
                  </>
                )}
              </button>
            </div>
          </form>
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
