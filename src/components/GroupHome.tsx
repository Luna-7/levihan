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
    <div className="space-y-3.5 text-[#2C241D]">
      {/* 1. QQ GROUPS & RECRUITMENT & VERIFICATION */}
      <section className="bg-[#FFFEEF] border-2 border-[#1E4334] rounded-md p-3.5 sm:p-4 shadow-xs space-y-3">
        {/* 4 QQ Groups Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {GROUP_INFO.qqGroups.map((group) => {
            const isCopied = !!copiedMap[group.number];
            return (
              <div
                key={group.id}
                onClick={() => handleCopyText(group.name, group.number)}
                className="bg-[#FAF5E8] border border-[#C5B495] hover:border-[#1E4334] rounded-xs p-2.5 cursor-pointer transition-all hover:shadow-xs group text-center"
              >
                <div className="text-xs font-pixel text-[#8C7A68]">
                  {group.name}
                </div>
                <div className="font-pixel text-sm text-[#1E4334] font-bold tracking-wider my-0.5 group-hover:text-[#B7791F]">
                  {group.number}
                </div>
                <div className="text-[10px] font-retro-jp text-[#8C7A68]">
                  {isCopied ? '已复制 ✓' : '复制群号'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Recruitment Group */}
        <div className="bg-[#FAF0E6] border border-[#D35400] rounded-xs p-2.5 flex items-center justify-between gap-2 text-xs font-retro-jp">
          <div className="text-[#7E5109]">
            <span className="font-bold text-[#D35400] font-pixel mr-1">招募群: 979246377</span>
            <span>(汉化 / 资源整理 / 群管理)</span>
          </div>

          <button
            onClick={() => handleCopyText('招聘群群号', '979246377')}
            className="px-2.5 py-0.5 bg-[#D35400] hover:bg-[#BA4A00] text-[#FFFEEF] font-pixel text-xs rounded-xs border border-[#A04000] cursor-pointer transition-all shrink-0"
          >
            {copiedMap['979246377'] ? '已复制' : '复制'}
          </button>
        </div>

        {/* Verification Requirement */}
        <div className="p-2.5 bg-[#FEF9E7] border border-[#F1C40F] rounded-xs text-xs font-retro-jp text-[#7D6608] leading-relaxed">
          <span className="font-bold text-[#B7950B] font-pixel mr-1">入群验证:</span>
          “{GROUP_INFO.verificationRequirement}”
        </div>
      </section>

      {/* 2. CORE MANIFESTO & REDLINES */}
      <section className="bg-[#FAF5E8] border-2 border-[#1E4334] rounded-md p-3.5 sm:p-4 shadow-xs space-y-3">
        {/* Manifesto Body */}
        <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-xs p-3.5 font-retro-jp text-xs sm:text-sm text-[#3D3025] leading-relaxed space-y-2.5">
          <p className="font-bold text-[#1E4334]">
            本群以 <span className="text-[#27AE60]">💚</span><span className="text-[#8E44AD]">💜</span> 利威尔 × 韩吉 为唯一不可动摇的创作与讨论核心。
          </p>

          <div className="space-y-1 text-[#4A3B2C]">
            <p className="font-bold text-[#5B4636]">在这里，你可以——</p>
            <p>● <b>干饭：</b>分享利韩粮仓，互相投喂同人图文；</p>
            <p>● <b>唠嗑：</b>聊原作剧情、角色解读、日常碎碎念；</p>
            <p>● <b>躺平：</b>享受一个和平、温暖、互不冒犯的磕CP乌托邦。</p>
          </div>

          <p className="text-[#1E4334]">
            群不关注外部社区的纷争与风向，不参与任何跨圈对立，不将外部恩怨带入本群。<b>这里只属于利韩，只属于同好之间的善意。</b>
          </p>

          <p className="text-[#5D4E41]">
            本群不接受任何以私人价值观进行的道德绑架，没有人应该被“磕CP就该怎样”或“利韩群应该怎样”的个人喜好审判与定义，遇到不喜欢的话题、人，可暂时潜水或群内屏蔽特定人。
          </p>

          <p className="font-bold text-[#B7791F]">
            你喜欢你的，我热爱我的，彼此尊重即是最好的同好关系。
          </p>

          <p className="text-[11px] text-[#8C7A68] italic pt-1 border-t border-dashed border-[#EAE2CE]">
            加入本社群即视为认可上述定位。如与个人预期存在较大差异，可自行选择退出。
          </p>
        </div>

        {/* Redlines */}
        <div className="bg-[#FFF5F5] border border-[#E6B0AA] rounded-xs p-3 space-y-1.5 font-retro-jp text-xs">
          <div className="font-pixel text-xs font-bold text-[#C0392B] flex items-center gap-1">
            <span>🚫</span>
            <span>速读版群规则 · 红线（碰即处理）：</span>
          </div>

          <ul className="text-[#900C3F] space-y-1 pl-1">
            <li>● 讨论利、韩与其他任何角色的CP搭配、水仙及相关内容；</li>
            <li>● 逆位 R18 禁止（含性转/百合等明确逆位内容）；</li>
            <li>● 把外部社区的纷争、反黑、恩怨带进群内；</li>
            <li>● 群内汉化资源外传、盗印转卖。</li>
          </ul>
        </div>
      </section>

      {/* 3. QUICK NAVIGATION TILES */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <button
          onClick={onNavigateToResources}
          className="bg-[#FFFEEF] border border-[#1E4334] hover:border-[#EAA83B] rounded-md p-3 cursor-pointer transition-all hover:shadow-xs group flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2 font-pixel text-xs sm:text-sm font-bold text-[#1E4334] group-hover:text-[#B7791F]">
            <span>📚</span>
            <span>公共资源库</span>
          </div>
          <span className="font-pixel text-xs text-[#1E4334] group-hover:translate-x-1 transition-transform">
            进入 ➔
          </span>
        </button>

        <button
          onClick={onNavigateToDoujin}
          className="bg-[#FFFEEF] border border-[#5B3F8A] hover:border-[#9B59B6] rounded-md p-3 cursor-pointer transition-all hover:shadow-xs group flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2 font-pixel text-xs sm:text-sm font-bold text-[#5B3F8A] group-hover:text-[#7D3C98]">
            <span>🔒</span>
            <span>同人本专区</span>
          </div>
          <span className="font-pixel text-xs text-[#5B3F8A] group-hover:translate-x-1 transition-transform">
            进入 ➔
          </span>
        </button>
      </div>
    </div>
  );
};
