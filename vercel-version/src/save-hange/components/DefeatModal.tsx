import React from 'react';

interface DefeatModalProps {
  onRestart: () => void;
}

export const DefeatModal: React.FC<DefeatModalProps> = ({ onRestart }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-md bg-[#241313] border-4 border-[#180a0a] rounded-2xl shadow-[0_0_50px_rgba(239,68,68,0.3)] p-6 text-center text-[#fef2f2]">
        {/* Glow Accent */}
        <div className="w-16 h-1 bg-red-500 mx-auto mb-4 rounded-full" />

        <h2 className="text-2xl sm:text-3xl font-black tracking-wider text-red-500 uppercase mb-1 font-mono">
          任务失败
        </h2>
        <p className="text-xs sm:text-sm font-bold tracking-wide text-stone-300 mb-6">
          时间耗尽，地鸣超大型巨人群已踏平该区域。
        </p>

        {/* Action Button */}
        <button
          id="defeat-restart-btn"
          onClick={onRestart}
          className="w-full py-3 px-6 bg-red-600 hover:bg-red-500 text-white font-black text-sm tracking-widest uppercase rounded-lg transition-all duration-150 shadow-[0_4px_15px_rgba(220,38,38,0.5)] active:translate-y-0.5 cursor-pointer"
        >
          重新挑战 (RETRY)
        </button>
      </div>
    </div>
  );
};
