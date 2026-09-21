import React from 'react';
import { NavigationTab } from '../types';

interface Props {
  activeTab: NavigationTab;
}

export const AdventureWorldBackground: React.FC<Props> = () => (
  <div className="fixed inset-0 w-full h-full pointer-events-none z-0 overflow-hidden select-none bg-[#1A1614]">
    <div
      className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-90 transition-opacity duration-500"
      style={{
        backgroundImage: 'url(/images/levihan-character-wall.webp)',
        backgroundSize: 'cover',
        backgroundPosition: 'center center',
      }}
    />
    <div className="absolute inset-0 bg-black/15 md:backdrop-blur-[1px]" />
    <div className="absolute top-2 left-0 w-full h-48 overflow-hidden opacity-40">
      <span className="absolute top-4 left-[8%] text-[#FFFDF9] text-xs animate-pulse">✦</span>
      <span className="absolute top-12 left-[35%] text-[#F9E79F] text-sm animate-pulse [animation-delay:1.5s]">✧</span>
      <span className="absolute top-6 right-[15%] text-[#FFFDF9] text-xs animate-pulse [animation-delay:.8s]">✦</span>
      <span className="absolute top-20 right-[30%] text-[#F9E79F] text-xs">✧</span>
    </div>
  </div>
);
