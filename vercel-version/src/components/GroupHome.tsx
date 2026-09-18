import React from 'react';
import { WoodenAnnouncementBoard } from './WoodenAnnouncementBoard';

interface Props {
  onNavigateToResources: () => void;
  onNavigateToDoujin: () => void;
  onShowToast: (msg: string) => void;
}

export const GroupHome: React.FC<Props> = ({
  onShowToast,
}) => {
  return (
    <div className="space-y-4 text-[#2C241D]">
      {/* 1. 兵团驻地专属置顶公告板 (长方形原木挂板，同时显示3条信息，上翻滚动) */}
      <WoodenAnnouncementBoard onShowToast={onShowToast} />

      {/* 2. 兵团驻地开屏宣传文案 (像素原木风卡片，细微深棕色像素点纹理与1px深色阴影) */}
      <section
        id="opening-section"
        className="pixel-wood-card p-4 xs:p-6 sm:p-7 rounded-none select-none relative overflow-hidden"
      >
        {/* 羊皮纸边缘内复古压线 */}
        <div className="border border-dashed border-[#8C6C47]/60 p-4 sm:p-6 text-center font-retro-jp bg-[#FAF4E5]/80">
          <h2 className="font-pixel text-base sm:text-base md:text-lg text-[#1E4334] font-bold tracking-wide">
            💚💜 # Levi × Hans 💚💜
          </h2>

          <div className="mt-4 space-y-2 text-[15px] sm:text-sm md:text-base text-[#4A3828] leading-[1.75]">
            <p>这里没什么特别的。</p>
            <p>就是喜欢利威尔和韩吉，</p>
            <p>所以放一些喜欢的东西，</p>
            <p>聊一点喜欢的话题，</p>
            <p>一起吃点粮。</p>
          </div>

          <p className="mt-4 font-bold text-base sm:text-base text-[#B7791F]">
            仅此而已。
          </p>

          <p className="mt-1 font-bold text-[13px] sm:text-xs text-[#1E4334] tracking-wide leading-relaxed">
            Only Levi × Hans.
            <br />
            Only for those who love them.
          </p>

          <div className="mt-4 pt-3 border-t border-dashed border-[#8C6C47]/50 flex justify-end">
            <a
              href="/cp-community-survey-report.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm sm:text-xs text-[#1E4334] font-bold hover:underline flex items-center gap-1"
            >
              <span>📊</span> CP社群调查分析报告 ➔
            </a>
          </div>
        </div>
      </section>

    </div>
  );
};
