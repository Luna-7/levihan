import React, { useState, useEffect } from 'react';
import { soundManager } from '../utils/audio';
import { UiSprite } from './UiSprite';

export const BackToTopButton: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [isCommentEditorFocused, setIsCommentEditorFocused] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const containers = [
        document.getElementById('view-main'),
        document.getElementById('resources-scroll-container'),
        document.getElementById('forum-scroll-container'),
        document.getElementById('general-stage-scroll-container'),
      ];

      let hasScrolledPast300 = false;
      for (const c of containers) {
        if (c && c.scrollTop > 300) {
          hasScrolledPast300 = true;
          break;
        }
      }

      if (window.scrollY > 300) {
        hasScrolledPast300 = true;
      }

      setIsVisible(hasScrolledPast300);
    };

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        handleScroll();
      });
    };
    const updateEditorFocus = () => {
      setIsCommentEditorFocused(Boolean(
        document.activeElement?.closest('[data-hide-back-to-top-on-focus]'),
      ));
    };
    const onFocusOut = () => requestAnimationFrame(updateEditorFocus);
    // 捕获内部滚动容器的 scroll，每帧最多读一次位置。
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('focusin', updateEditorFocus);
    document.addEventListener('focusout', onFocusOut);
    handleScroll();

    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('focusin', updateEditorFocus);
      document.removeEventListener('focusout', onFocusOut);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const scrollToTop = () => {
    soundManager.playSoftSwoosh();

    const containers = [
      document.getElementById('view-main'),
      document.getElementById('resources-scroll-container'),
      document.getElementById('forum-scroll-container'),
      document.getElementById('general-stage-scroll-container'),
    ];

    containers.forEach((c) => {
      if (c) {
        c.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!isVisible || isCommentEditorFocused) return null;

  return (
    <button
      onClick={scrollToTop}
      onMouseEnter={() => soundManager.playCardHover()}
      aria-label="回到页面顶部"
      title="回到顶部"
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-2 sm:right-4 z-50 flex items-center justify-center border-0 bg-transparent shadow-none transition-transform duration-200 ease-out hover:scale-105 active:scale-95 cursor-pointer select-none animate-in fade-in zoom-in duration-200 motion-reduce:animate-none motion-reduce:transition-none"
    >
      <UiSprite name="back-to-top" width={52} role="img" label="回到顶部" className="drop-shadow-lg" />
    </button>
  );
};
