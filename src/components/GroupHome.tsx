import React, { useState } from 'react';
import { GROUP_INFO } from '../data/initialData';
import { soundManager } from '../utils/audio';

interface Props {
  onNavigateToResources: () => void;
  onNavigateToDoujin: () => void;
  onShowToast: (msg: string) => void;
}

export const GroupHome: React.FC<Props> = ({
  onNavigateToResources,
  onNavigateToDoujin,
  onShowToast,
}) => {
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({});
  const [isGroupsExpanded, setIsGroupsExpanded] = useState(false);

  const handleCopyText = (label: string, text: string) => {
    soundManager.playCoin();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          setCopiedMap((prev) => ({ ...prev, [text]: true }));
          onShowToast(`已复制${label}：${text} 📋`);
          setTimeout(() => {
            setCopiedMap((prev) => ({ ...prev, [text]: false }));
          }, 2500);
        },
        () => onShowToast(`${label}：${text}`)
      );
    } else {
      onShowToast(`${label}：${text}`);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 text-[#2C241D]">
      {/* 1. 开屏文案（首页最顶部模块） */}
      <section
        id="opening-section"
        className="bg-[#FAF5E8] border-2 sm:border-[3px] border-[#1E4334] rounded-md p-3 xs:p-4 sm:p-6 md:p-7 shadow-xs"
      >
        <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-xs px-4 py-6 xs:px-5 xs:py-7 sm:px-8 sm:py-9 font-retro-jp text-center">
          <h2 className="font-pixel text-xs xs:text-sm sm:text-base md:text-lg text-[#1E4334] font-bold tracking-wide">
            💚💜 # Levi × Hans 💚💜
          </h2>

          <div className="mt-4 sm:mt-5 space-y-1 text-xs sm:text-sm md:text-base text-[#3D3025] leading-relaxed">
            <p>这里没什么特别的。</p>
            <p>就是喜欢利威尔和韩吉，</p>
            <p>所以放一些喜欢的东西，</p>
            <p>聊一点喜欢的话题，</p>
            <p>一起吃点粮。</p>
          </div>

          <p className="mt-4 sm:mt-5 font-bold text-sm sm:text-base md:text-lg text-[#B7791F]">
            仅此而已。
          </p>

          <p className="mt-1.5 font-bold text-[11px] sm:text-xs md:text-sm text-[#1E4334] tracking-wide leading-relaxed">
            Only Levi × Hans.
            <br />
            Only for those who love them.
          </p>

          <div className="mt-5 pt-3 border-t border-dashed border-[#EAE2CE] flex justify-end">
            <a
              href="/cp-community-survey-report.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs sm:text-sm text-[#1E4334] font-bold hover:underline flex items-center gap-1"
            >
              <span>📊</span> CP社群调查分析报告 ➔
            </a>
          </div>
        </div>
      </section>

      {/* 2. QQ GROUPS & RECRUITMENT & VERIFICATION */}
      <section id="group-info-section" className="bg-[#FFFEEF] border-2 sm:border-[3px] border-[#1E4334] rounded-md p-3 xs:p-4 sm:p-5 md:p-6 shadow-xs space-y-3.5">
        {/* 土豆分群 Collapsible Card Dropdown */}
        <div className="space-y-2">
          <button
            onClick={() => {
              soundManager.playBlip();
              setIsGroupsExpanded(!isGroupsExpanded);
            }}
            className="w-full flex items-center justify-between px-3.5 py-3 bg-[#FAF5E8] hover:bg-[#EAE2CE] border border-[#C5B495] hover:border-[#1E4334] rounded-xs text-[#1E4334] cursor-pointer transition-all shadow-2xs select-none"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">🥔</span>
              <span className="font-pixel text-xs sm:text-sm font-bold tracking-wide">
                土豆分群
              </span>
            </div>
            <span className="font-pixel text-[10px] sm:text-xs text-[#8C7A68]">
              {isGroupsExpanded ? '▲ 收起' : '▼ 展开'}
            </span>
          </button>

          {isGroupsExpanded && (
            <div className="space-y-2.5 p-2.5 bg-[#FAF5E8] border border-[#D5C9AF] rounded-xs">
              <div className="grid grid-cols-1 xs:grid-cols-2 gap-2">
                {GROUP_INFO.qqGroups.map((group) => {
                  const isCopied = !!copiedMap[group.number];
                  return (
                    <div
                      key={group.id}
                      onClick={() => handleCopyText(group.name, group.number)}
                      className="bg-[#FFFEEF] border border-[#C5B495] hover:border-[#1E4334] rounded-xs px-3.5 py-2.5 cursor-pointer transition-colors flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[10px] sm:text-[11px] font-pixel text-[#8C7A68] truncate">
                          {group.name}
                        </div>
                        <div className="font-pixel text-xs sm:text-sm text-[#1E4334] font-bold tracking-wider mt-0.5">
                          {group.number}
                        </div>
                      </div>
                      <span className="font-retro-jp text-[10px] sm:text-xs text-[#B7791F] font-bold shrink-0">
                        {isCopied ? '已复制 ✓' : '📋'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 入群验证放进四个群下拉模块里 */}
              <div className="p-2.5 sm:p-3 bg-[#FEF9E7] border border-[#F1C40F] rounded-xs text-xs sm:text-sm font-retro-jp text-[#7D6608] leading-relaxed flex flex-col xs:flex-row xs:items-center justify-between gap-1.5">
                <div>
                  <span className="font-bold text-[#B7950B] font-pixel mr-1.5 text-xs sm:text-sm">入群验证:</span>
                  “{GROUP_INFO.verificationRequirement}”
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyText('入群验证', GROUP_INFO.verificationRequirement)}
                  className="px-2 py-0.5 bg-[#FAF5E8] hover:bg-[#F9E79F] border border-[#D5C9AF] text-[#B7950B] font-pixel text-[10px] rounded-xs cursor-pointer self-start xs:self-auto shrink-0"
                >
                  {copiedMap[GROUP_INFO.verificationRequirement] ? '已复制验证 ✓' : '复制验证 📋'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 招募群：分为两行，去除复制按钮，点击整张卡片即可复制 */}
        <div
          onClick={() => handleCopyText('招募群群号', '979246377')}
          className="bg-[#FAF0E6] hover:bg-[#FBE8D8] border-2 border-[#D35400] hover:border-[#BA4A00] rounded-xs p-3 sm:p-3.5 cursor-pointer transition-all shadow-2xs flex items-center justify-between gap-3 select-none"
          title="点击卡片即可复制招募群号：979246377"
        >
          <div className="space-y-1 font-retro-jp">
            <div className="font-bold text-[#D35400] font-pixel text-xs sm:text-sm">
              招募群: 979246377
            </div>
            <div className="text-[11px] sm:text-xs text-[#8E5109]">
              ( 汉化 / 资源整理 / 群管理 )
            </div>
          </div>

          <div className="shrink-0 text-right font-pixel text-xs">
            {copiedMap['979246377'] && (
              <span className="text-[#27AE60] bg-[#E8F8F5] px-2 py-1 rounded-xs border border-[#A2D9CE] inline-block font-retro-jp">
                已复制 979246377 ✓
              </span>
            )}
          </div>
        </div>
      </section>

      {/* 3. QUICK NAVIGATION TILES */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <button
          onClick={onNavigateToResources}
          className="bg-[#FFFEEF] border border-[#1E4334] hover:border-[#EAA83B] rounded-md p-3 sm:p-4 cursor-pointer transition-all hover:shadow-xs group flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2 font-pixel text-xs sm:text-sm md:text-base font-bold text-[#1E4334] group-hover:text-[#B7791F]">
            <span>📚</span>
            <span>资源外链</span>
          </div>
          <span className="font-pixel text-xs sm:text-sm text-[#1E4334] group-hover:translate-x-1 transition-transform">
            进入 ➔
          </span>
        </button>

        <button
          onClick={onNavigateToDoujin}
          className="bg-[#FFFEEF] border border-[#5B3F8A] hover:border-[#9B59B6] rounded-md p-3 sm:p-4 cursor-pointer transition-all hover:shadow-xs group flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2 font-pixel text-xs sm:text-sm md:text-base font-bold text-[#5B3F8A] group-hover:text-[#7D3C98]">
            <span>🔒</span>
            <span>土豆粮仓驻地</span>
          </div>
          <span className="font-pixel text-xs sm:text-sm text-[#5B3F8A] group-hover:translate-x-1 transition-transform">
            进入 ➔
          </span>
        </button>
      </div>
    </div>
  );
};
