import React, { useState, useEffect } from 'react';
import { soundManager } from '../utils/audio';

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
      className="fixed right-3 bottom-20 sm:bottom-6 z-30 w-10 h-10 rounded-full bg-[#1E4334] text-[#F9E79F] border-2 border-[#EAA83B] shadow-xl flex items-center justify-center font-pixel text-xs active:scale-90 transition-transform cursor-pointer select-none"
    >
      ▲
    </button>
  );
};
