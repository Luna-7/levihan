import React, { useState } from 'react';
import { ResourceLink } from '../types';
import { RESOURCE_LINKS } from '../data/initialData';
import { soundManager } from '../utils/audio';
import { AuNovelReader } from './AuNovelReader';
import { CardPatternOverlay } from './CardPatternOverlay';
import { GoodsShowcase } from './GoodsShowcase';

interface Props {
  onCopyCode: (code: string) => void;
  onShowToast: (msg: string) => void;
  onGoToDoujin?: () => void;
}

export const ResourceHub: React.FC<Props> = ({
  onShowToast,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('动漫原片');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 「周边橱窗」只陈列图片（清单在 COS 的 goods/manifest.json），不走网盘链接那套
  const allCategories = ['动漫原片', '漫画与手稿', '二创剪辑/素材', '官方AU小说', '周边橱窗'];

  const handleAutoJump = (url: string, code?: string) => {
    if (code) {
      soundManager.playCopySuccess();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(
          () => onShowToast(`已自动复制提取码【${code}】并为你跳转网盘！📋`),
          () => onShowToast(`提取码为：${code}`)
        );
      } else {
        onShowToast(`提取码为：${code}`);
      }
    } else {
      soundManager.playWarpJump();
      onShowToast('正在为您打开网盘... ↗');
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const animeLinks = RESOURCE_LINKS.filter((r) => r.category === 'anime');
  const creativeLinks = RESOURCE_LINKS.filter((r) => r.category === 'creative');
  const mangaLinks = RESOURCE_LINKS.filter((r) => r.category === 'manga' || r.category === 'link');

  // 根据选中的分类过滤
  const currentCategoryLinks = (() => {
    switch (selectedCategory) {
      case '动漫原片':
        return animeLinks;
      case '漫画与手稿':
        return mangaLinks;
      case '二创剪辑/素材':
        return creativeLinks;
      default:
        return [];
    }
  })();

  const filteredLinks = currentCategoryLinks.filter((item) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      item.title.toLowerCase().includes(q) ||
      (item.description && item.description.toLowerCase().includes(q)) ||
      item.platform.toLowerCase().includes(q)
    );
  });

  const renderResourceGrid = (links: ResourceLink[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 w-full">
      {links.map((item) => (
        <div
          key={item.id}
          onClick={() => handleAutoJump(item.url, item.code)}
          onMouseEnter={() => soundManager.playCardHover()}
          className="relative overflow-hidden bg-[#FFFEEF] border-2 border-[#D5C9AF] hover:border-[#1E4334] rounded-md p-3.5 sm:p-4 flex flex-col justify-between transition-all hover:shadow-md group select-none cursor-pointer space-y-2.5 w-full"
          style={{ contain: 'layout style paint' }}
          title="点击即可自动复制提取码并打开网盘"
        >
          <CardPatternOverlay opacity={0.10} mode="multiply" />
          <div className="relative z-10 space-y-2">
            {/* Top Badges */}
            <div className="flex items-center justify-between gap-1.5 flex-wrap">
              <span
                className={`text-[10px] sm:text-xs px-2 py-0.5 rounded-xs font-pixel font-bold border whitespace-nowrap ${
                  item.platform === '百度网盘'
                    ? 'bg-[#EBF5FB] text-[#1A5276] border-[#2980B9]'
                    : item.platform === '夸克网盘'
                    ? 'bg-[#FEF9E7] text-[#7D6608] border-[#B7950B]'
                    : 'bg-[#FADBD8] text-[#78281F] border-[#C0392B]'
                }`}
              >
                {item.platform}
              </span>

              {item.code ? (
                <span className="font-pixel text-[10px] sm:text-xs text-[#7D6608] bg-[#FEF9E7] border border-[#B7950B] px-2 py-0.5 rounded-xs font-bold flex items-center gap-1 whitespace-nowrap">
                  <span>📋 提取码</span>
                  <span>{item.code}</span>
                </span>
              ) : (
                <span className="font-pixel text-[10px] sm:text-xs text-[#1E8449] bg-[#E8F8F5] border border-[#27AE60] px-2 py-0.5 rounded-xs font-bold whitespace-nowrap">
                  免提取码
                </span>
              )}
            </div>

            {/* Title */}
            <h3 className="font-pixel text-sm sm:text-base font-bold text-[#1E3A2B] group-hover:text-[#B7791F] leading-snug break-words transition-colors">
              {item.title}
            </h3>

            {/* Description */}
            {item.description && (
              <p className="text-xs font-retro-jp text-[#7A6958] leading-relaxed line-clamp-2">
                {item.description}
              </p>
            )}
          </div>

          {/* Action Hint */}
          <div className="pt-2 border-t border-dashed border-[#E0D5BE] flex items-center justify-between text-xs font-retro-jp text-[#8C7A68] group-hover:text-[#1E4334] whitespace-nowrap">
            <span className="flex items-center gap-1.5">
              <span>🚀</span>
              <span>点击直达网盘</span>
            </span>
            <span className="font-pixel text-xs group-hover:translate-x-0.5 transition-transform font-bold text-[#1E4334]">
              ↗
            </span>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div id="official-resources-root" className="space-y-3 text-[#2C241D] select-text">
      {/* 官方文献馆提示语 */}
      <div className="p-2 px-3 bg-[#EAF2EE] border-l-3 border-[#1E4334] rounded-r-xs font-retro-jp text-[11px] text-[#1E4334] flex items-center">
        <div>
          <span className="font-bold">📚 官方资料馆：</span>
          收录《进击的巨人》官方原片、原画分镜手稿、设定公式书、二创音画剪辑母盘与官方授权AU小说；另有「周边橱窗」陈列周边 PNG 原图。
        </div>
      </div>

      {/* 筛选与搜索栏 (与土豆粮仓保持完全一致的样式) */}
      <div className="relative overflow-hidden bg-[#FFFEEF] border border-[#D5C9AF] rounded-md p-2.5 sm:p-3 space-y-2">
        <CardPatternOverlay opacity={0.12} mode="multiply" />
        {/* 分类按钮栏 (多行跟随设备动态切换) */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-pixel text-[#8C7A68] mr-1 shrink-0 whitespace-nowrap">分类:</span>
          {allCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                soundManager.playFilterClick();
                setSelectedCategory(cat);
              }}
              onMouseEnter={() => soundManager.playCardHover()}
              className={`px-3 py-1.5 rounded-xs border transition-all cursor-pointer text-xs sm:text-sm shrink-0 whitespace-nowrap select-none active:scale-95 ${
                selectedCategory === cat
                  ? 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334] font-bold shadow-xs'
                  : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5] active:bg-[#EAE2CE]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* 搜索框 (官方AU小说自带阅读器内置目录、周边橱窗自带搜索，其余分类提供搜索) */}
        {selectedCategory !== '官方AU小说' && selectedCategory !== '周边橱窗' && (
          <div className="flex items-center gap-1.5 pt-1 border-t border-dashed border-[#E0D5BE]">
            <input
              type="text"
              placeholder="快速检索标题、格式、内容描述或网盘平台..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="px-2.5 py-1.5 text-xs sm:text-sm font-retro-jp bg-[#FAF5E8] border border-[#BFA985] rounded-xs w-full focus:outline-none focus:border-[#1E4334]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-xs sm:text-sm text-[#8C7A68] hover:text-[#1E4334] px-1 cursor-pointer whitespace-nowrap shrink-0"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* 🖼 周边橱窗：图片区块（懒加载缩略图 + 一键下载原图，图片本体放在 COS 不进包） */}
      {selectedCategory === '周边橱窗' ? (
        <div className="mb-6">
          <GoodsShowcase onShowToast={onShowToast} />
        </div>
      ) : selectedCategory === '官方AU小说' ? (
        /* 📜 官方AU小说专区 */
        <div className="mb-6">
          <AuNovelReader onShowToast={onShowToast} />
        </div>
      ) : (
        <div>
          {filteredLinks.length > 0 ? (
            renderResourceGrid(filteredLinks)
          ) : (
            <div className="p-8 text-center bg-[#FFFEEF] border border-dashed border-[#D5C9AF] rounded-md text-xs font-retro-jp text-[#8C7A68]">
              未找到匹配的官方资料，您可以清空搜索词重试～
            </div>
          )}
        </div>
      )}
    </div>
  );
};
