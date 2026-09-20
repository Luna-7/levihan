import React from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed top-2 left-1/2 transform -translate-x-1/2 z-50 bg-[#8E3320] text-[#FAF5E8] border-2 border-[#EAA83B] px-3.5 py-1.5 rounded-full shadow-lg font-retro-jp text-xs flex items-center gap-2 animate-pulse">
      <span className="w-2 h-2 rounded-full bg-[#FAF5E8]" />
      <span>离线模式 · 正在使用本地缓存数据</span>
    </div>
  );
};
