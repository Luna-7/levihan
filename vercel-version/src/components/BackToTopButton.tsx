import React, { useState, useEffect } from 'react';
import { soundManager } from '../utils/audio';
import { UiSprite } from './UiSprite';

export const BackToTopButton: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 360) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    soundManager.playBlip();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!isVisible) return null;

  return (
    <button
      onClick={scrollToTop}
      aria-label="回到页面顶部"
      title="回到顶部"
      className="fixed right-3 bottom-20 sm:bottom-6 z-30 bg-transparent border-0 shadow-none flex items-center justify-center active:scale-90 transition-transform cursor-pointer select-none"
    >
      <UiSprite name="back-to-top" width={58} role="img" label="回到顶部" className="drop-shadow-lg" />
    </button>
  );
};
