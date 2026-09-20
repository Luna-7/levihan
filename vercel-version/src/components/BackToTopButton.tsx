import React, { useState, useEffect } from 'react';
import { soundManager } from '../utils/audio';
import { UiSprite } from './UiSprite';

export const BackToTopButton: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const containers = [
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

    // Use capture phase so that inner containers' scroll events bubble up to window
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    
    // Initial check
    handleScroll();

    // Check periodically in case layout changes or renders complete without trigger
    const interval = setInterval(handleScroll, 400);

    return () => {
      window.removeEventListener('scroll', handleScroll, { capture: true });
      clearInterval(interval);
    };
  }, []);

  const scrollToTop = () => {
    soundManager.playSoftSwoosh();

    const containers = [
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

  if (!isVisible) return null;

  return (
    <button
      onClick={scrollToTop}
      onMouseEnter={() => soundManager.playCardHover()}
      aria-label="回到页面顶部"
      title="回到顶部"
      className="fixed right-2 sm:right-4 top-1/2 -translate-y-1/2 z-50 bg-transparent border-0 shadow-none flex items-center justify-center active:scale-90 hover:scale-105 transition-all cursor-pointer select-none animate-in fade-in zoom-in duration-200"
    >
      <UiSprite name="back-to-top" width={52} role="img" label="回到顶部" className="drop-shadow-lg" />
    </button>
  );
};
