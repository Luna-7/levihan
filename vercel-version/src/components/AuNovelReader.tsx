import React, { useState } from 'react';
import { AU_NOVEL_STORIES } from '../data/auNovelData';
import { soundManager } from '../utils/audio';

interface AuNovelReaderProps {
  onShowToast: (msg: string) => void;
}

type FontSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * 格式化章节中文名称：
 * 1. 彻底去除 Vol. XX 编号前缀
 * 2. 彻底去除原有数字序号前缀（如 "1. "）
 * 3. 规范化深夜故事系列标题（如 "深夜故事 · 阿尼·利昂哈特：过去的故事"）
 * 4. 确保完整呈现完整中文名
 */
export const formatCleanChineseTitle = (raw: string): string => {
  let t = raw;
  // 去除开头的序号如 "1. "
  t = t.replace(/^\d+\.\s*/, '');
  // 处理 "深夜故事 Vol. XX — " 形式
  t = t.replace(/深夜故事\s*Vol\.\s*\d+\s*[-–—:]*\s*/i, '深夜故事 · ');
  // 去除剩余任何 "Vol. XX – " 或 "Vol. XX — " 等
  t = t.replace(/Vol\.\s*\d+\s*[-–—:]*\s*/i, '');
  // 去除开头多余的破折号或冒号
  t = t.replace(/^[-–—:]\s*/, '').trim();
  return t;
};

export const AuNovelReader: React.FC<AuNovelReaderProps> = ({ onShowToast }) => {
  // 阅读参数：5档字号 ('xs' | 'sm' | 'md' | 'lg' | 'xl') 与夜间模式
  const [fontSize, setFontSize] = useState<FontSize>('md');
  const [isNightMode, setIsNightMode] = useState<boolean>(false);

  // 展开章节集合（默认展开第一篇）
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(['s1']));

  // 目录抽屉状态
  const [showToc, setShowToc] = useState<boolean>(false);

  const handleToggleCard = (id: string) => {
    soundManager.playBlip();
    const next = new Set<string>(openIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setOpenIds(next);
  };

  const handleExpandAll = () => {
    soundManager.playCoin();
    const all = new Set<string>(AU_NOVEL_STORIES.map((s) => s.id));
    setOpenIds(all);
    onShowToast('已展开全部篇目 📖');
  };

  const handleCollapseAll = () => {
    soundManager.playBlip();
    setOpenIds(new Set());
    onShowToast('已折叠收起全部篇目 📂');
  };

  const handleJumpToChapter = (id: string) => {
    soundManager.playCoin();
    setOpenIds((prev) => new Set(prev).add(id));
    setShowToc(false);
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  const handleCopyStory = (e: React.MouseEvent, storyNum: number, title: string, paragraphs: string[]) => {
    e.stopPropagation();
    soundManager.playCoin();
    const fullText = `${title}\n\n${paragraphs.join('\n\n')}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(fullText).then(
        () => onShowToast(`已复制第 ${storyNum} 篇全文到剪贴板 📋`),
        () => onShowToast('复制失败，请手动选择文本')
      );
    } else {
      onShowToast(`已选择第 ${storyNum} 篇`);
    }
  };

  const handleOpenEnglishDoc = () => {
    soundManager.playCoin();
    const url = 'https://pan.baidu.com/s/1nl_RHbnQVB98W_okM9H1Lw?pwd=9fpv';
    // 自动复制提取码并跳转
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText('9fpv');
      onShowToast('提取码 9fpv 已自动复制，正在打开网盘 🚀');
    } else {
      onShowToast('正在打开网盘，提取码: 9fpv 🚀');
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // 80年代报刊排版：字号 + 宽松行距 leading 增强
  const getParagraphTextSize = () => {
    switch (fontSize) {
      case 'xs':
        return 'text-[12px] sm:text-[13px] leading-[2.1] sm:leading-[2.2] tracking-normal';
      case 'sm':
        return 'text-[13px] sm:text-[14px] leading-[2.15] sm:leading-[2.25] tracking-normal';
      case 'md':
        return 'text-[14.5px] sm:text-[16px] leading-[2.2] sm:leading-[2.35] tracking-wide';
      case 'lg':
        return 'text-[16.5px] sm:text-[18px] leading-[2.3] sm:leading-[2.45] tracking-wide';
      case 'xl':
        return 'text-[18.5px] sm:text-[20px] leading-[2.4] sm:leading-[2.55] tracking-wider';
    }
  };

  return (
    <div
      id="au-novel-reader-root"
      className={`relative w-full select-text transition-colors duration-200 ${
        isNightMode ? 'text-[#DCD5C6]' : 'text-[#3E342B]'
      }`}
    >
      {/* 🛠️ 悬浮工具栏 (80s 报刊风 5 档字号选择 & 夜间模式) */}
      <div
        id="au-floating-toolbar"
        className={`fixed bottom-5 right-4 sm:bottom-6 sm:right-6 z-40 flex items-center gap-1.5 px-3 py-1.5 rounded-none border-2 shadow-[3px_3px_0px_#10241B] transition-all backdrop-blur-md ${
          isNightMode
            ? 'bg-[#181D1A]/95 border-[#384E3F] text-[#EDE7D9]'
            : 'bg-[#FFFDF5]/95 border-[#1E4334] text-[#1E4334]'
        }`}
      >
        {/* 字号选择：微 / 小 / 中 / 大 / 特大 */}
        <div className="flex items-center border-r pr-2 mr-0.5 border-dashed border-current/30">
          <span className="text-[10px] font-pixel opacity-80 mr-1.5 hidden xs:inline">字号</span>
          <div className="flex items-center gap-1">
            {[
              { key: 'xs', label: '微' },
              { key: 'sm', label: '小' },
              { key: 'md', label: '中' },
              { key: 'lg', label: '大' },
              { key: 'xl', label: '特大' },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  soundManager.playBlip();
                  setFontSize(item.key as FontSize);
                  onShowToast(`字号调整为：${item.label}`);
                }}
                className={`px-1.5 py-0.5 rounded-none text-[10px] sm:text-[11px] font-pixel transition-all cursor-pointer border ${
                  fontSize === item.key
                    ? isNightMode
                      ? 'bg-[#384E3F] text-[#F9E79F] border-[#F9E79F] font-bold shadow-[1px_1px_0px_#F9E79F]'
                      : 'bg-[#1E4334] text-[#F9E79F] border-[#10241B] font-bold shadow-[1px_1px_0px_#10241B]'
                    : 'bg-transparent border-transparent hover:border-current/30 opacity-75'
                }`}
                title={`字号：${item.label}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* 夜间模式切换 */}
        <button
          id="night-mode-toggle-btn"
          onClick={() => {
            soundManager.playBlip();
            setIsNightMode(!isNightMode);
            onShowToast(!isNightMode ? '已切换至夜间墨黑报刊模式 🌙' : '已切换至 80s 复古羊皮纸风 📜');
          }}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-none border text-[10px] sm:text-xs font-pixel transition-all cursor-pointer ${
            isNightMode
              ? 'bg-[#2A352D] border-[#384E3F] text-[#F9E79F] hover:bg-[#344238]'
              : 'bg-[#EAE2CE] border-[#1E4334] text-[#1E4334] hover:bg-[#DDD3BB]'
          }`}
          title={isNightMode ? '切换至日间报刊' : '切换至夜间报刊'}
        >
          <span>{isNightMode ? '🌙 夜间' : '📜 报纸'}</span>
        </button>

        {/* 置顶按钮 */}
        <button
          onClick={() => {
            soundManager.playBlip();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="px-1.5 py-0.5 rounded-none text-[10px] font-pixel hover:bg-current/10 opacity-75 cursor-pointer"
          title="回到顶部"
        >
          ▲
        </button>
      </div>

      {/* 沉浸式 80 年代报刊风主阅读区 (狭窄报纸栏目宽度 max-w-2xl，宽裕行距与复古版面) */}
      <div
        className={`relative w-full max-w-2xl mx-auto p-1 sm:p-2 transition-colors duration-200 border-0 shadow-none ${
          isNightMode ? 'bg-transparent text-[#DCD5C6]' : 'bg-transparent text-[#3E342B]'
        }`}
      >
        {/* 📄 百度网盘纯英文版跳转卡片：简约外链条 (平面极简) */}
        <div
          id="au-english-docx-card"
          onClick={handleOpenEnglishDoc}
          className={`relative mb-3.5 px-3 py-2 rounded-none border-2 cursor-pointer transition-all flex items-center justify-center gap-1.5 group select-none shadow-none ${
            isNightMode
              ? 'bg-[#1D2520] border-[#384E3F] hover:border-[#F9E79F] text-[#F9E79F]'
              : 'bg-[#FFFDF5] border-[#1E4334] hover:bg-[#F3EAD5] hover:border-[#B7791F] text-[#1E4334]'
          }`}
          title="点击直接跳转至百度网盘（提取码: 9fpv）"
        >
          <span className="font-pixel text-[11px] sm:text-xs font-bold tracking-wide flex items-center gap-1.5">
            <span>📄 AU官方小说英文版</span>
            <span className="text-xs group-hover:translate-x-0.5 transition-transform">↗</span>
          </span>
        </div>

        {/* 简约操作栏：目录索引与全部展开/收起 */}
        <div className="relative flex items-center justify-between gap-2 mb-3 pb-1.5 border-b-2 border-dashed border-current/25 font-retro-jp text-[11px]">
          <div className="flex items-center gap-2">
            <button
              id="au-toc-toggle-btn"
              onClick={() => {
                soundManager.playBlip();
                setShowToc(!showToc);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none border-2 font-pixel text-[10px] sm:text-[11px] cursor-pointer transition-all shadow-none ${
                showToc
                  ? isNightMode
                    ? 'bg-[#384E3F] text-[#F9E79F] border-[#384E3F]'
                    : 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334]'
                  : isNightMode
                  ? 'bg-[#212823] text-[#D4CBC0] border-[#384A3D] hover:bg-[#28322B]'
                  : 'bg-[#FAF5E8] text-[#5B4636] border-[#1E4334] hover:bg-white'
              }`}
            >
              <span>📖 篇目目录</span>
              <span className="text-[9px]">{showToc ? '▲' : '▼'}</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              id="au-expand-all-btn"
              onClick={handleExpandAll}
              className={`px-2 py-1 rounded-none border-2 font-pixel text-[10px] cursor-pointer transition-all shadow-none ${
                isNightMode
                  ? 'bg-[#212823] hover:bg-[#2B352E] text-[#D4CBC0] border-[#384A3D]'
                  : 'bg-[#FAF5E8] hover:bg-white text-[#5B4636] border-[#1E4334]'
              }`}
            >
              全部展开
            </button>
            <button
              id="au-collapse-all-btn"
              onClick={handleCollapseAll}
              className={`px-2 py-1 rounded-none border-2 font-pixel text-[10px] cursor-pointer transition-all shadow-none ${
                isNightMode
                  ? 'bg-[#212823] hover:bg-[#2B352E] text-[#D4CBC0] border-[#384A3D]'
                  : 'bg-[#FAF5E8] hover:bg-white text-[#5B4636] border-[#1E4334]'
              }`}
            >
              全部收起
            </button>
          </div>
        </div>

        {/* 篇目目录抽屉：按要求 button 设为多行，完整显示各篇中文名称 */}
        {showToc && (
          <div
            className={`relative mb-4 p-3 rounded-none border-2 shadow-none transition-colors ${
              isNightMode
                ? 'bg-[#1B221E] border-[#384E3F]'
                : 'bg-[#FFFDF5] border-[#1E4334]'
            }`}
          >
            <div className="flex items-center justify-between pb-1.5 mb-2 border-b-2 border-dashed border-current/20">
              <h3
                className={`font-pixel text-[11px] font-bold flex items-center gap-1.5 ${
                  isNightMode ? 'text-[#F9E79F]' : 'text-[#1E4334]'
                }`}
              >
                <span>📚 篇目快速索引目录</span>
              </h3>
              <button
                onClick={() => setShowToc(false)}
                className="text-[10px] font-pixel opacity-70 hover:opacity-100 cursor-pointer"
              >
                ✕ 收起
              </button>
            </div>

            {/* 多列网格，每个 button 设置多行，完整列出中文名 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
              {AU_NOVEL_STORIES.map((story) => {
                const cleanTitle = formatCleanChineseTitle(story.titleZh);
                return (
                  <button
                    key={story.id}
                    onClick={() => handleJumpToChapter(story.id)}
                    className={`w-full text-left py-1.5 px-2.5 rounded-none border-2 text-[11px] font-retro-jp leading-snug transition-all flex items-start gap-1.5 cursor-pointer whitespace-normal break-words shadow-none ${
                      isNightMode
                        ? 'border-[#384E3F] text-[#C9C1B2] hover:text-[#F9E79F] hover:bg-[#252E28]'
                        : 'border-[#1E4334] text-[#4A3E31] hover:text-[#1E4334] hover:bg-[#F3EAD5]'
                    }`}
                  >
                    <span className="font-pixel text-[10px] text-[#B7791F] shrink-0 font-bold mt-0.5">
                      #{story.num.toString().padStart(2, '0')}
                    </span>
                    <span className="break-words flex-1 leading-snug">{cleanTitle}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 章节卡片列表：平面卡片风格 (Flat Cards) */}
        <div className="relative flex flex-col gap-3">
          {AU_NOVEL_STORIES.map((story) => {
            const isOpen = openIds.has(story.id);
            const cleanTitle = formatCleanChineseTitle(story.titleZh);
            const paragraphs = story.paragraphsZh;

            return (
              <div
                key={story.id}
                id={story.id}
                className={`rounded-none overflow-hidden transition-all border-2 scroll-mt-4 shadow-none ${
                  isOpen
                    ? isNightMode
                      ? 'bg-[#151C18] border-[#384E3F]'
                      : 'bg-[#F8F4E8] border-[#1E4334]'
                    : isNightMode
                    ? 'bg-[#1F2621] border-[#2D3830] hover:border-[#384E3F]'
                    : 'bg-[#FFFDF5] border-[#1E4334] hover:bg-[#F5EDE0]'
                }`}
              >
                {/* 章节折叠头部 Button */}
                <button
                  onClick={() => handleToggleCard(story.id)}
                  className={`w-full flex items-start justify-between text-left p-2.5 sm:p-3 transition-colors cursor-pointer border-0 select-none ${
                    isOpen
                      ? isNightMode
                        ? 'bg-[#27342B] text-[#F9E79F] border-b-2 border-[#384E3F]'
                        : 'bg-[#1E4334] text-[#F9E79F] border-b-2 border-[#10241B]'
                      : isNightMode
                      ? 'bg-[#222A24] text-[#DDD6C8] hover:bg-[#29332C]'
                      : 'bg-[#F5EDE0] text-[#3E342B] hover:bg-[#EFE4D2]'
                  }`}
                >
                  <div className="flex items-start gap-2 min-w-0 pr-2 flex-1">
                    <span
                      className={`font-pixel text-[10px] px-2 py-0.5 rounded-none shrink-0 font-bold mt-0.5 border ${
                        isOpen
                          ? isNightMode
                            ? 'bg-[#F9E79F] text-[#1E2520] border-[#F9E79F]'
                            : 'bg-[#F9E79F] text-[#1E4334] border-[#10241B]'
                          : isNightMode
                          ? 'bg-[#314135] text-[#D8E6DC] border-[#384E3F]'
                          : 'bg-[#1E4334] text-[#F9E79F] border-[#10241B]'
                      }`}
                    >
                      #{story.num.toString().padStart(2, '0')}
                    </span>
                    <h3 className="font-pixel text-[11px] sm:text-[12.5px] font-bold tracking-normal break-words whitespace-normal leading-snug flex-1">
                      {cleanTitle}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    <span
                      className={`text-[10px] transition-transform duration-200 ${
                        isOpen
                          ? 'rotate-180 text-[#F9E79F]'
                          : isNightMode
                          ? 'text-[#9A9182]'
                          : 'text-[#7A6958]'
                      }`}
                    >
                      ▼
                    </span>
                  </div>
                </button>

                {/* 章节正文：80 年代报刊宽间距排版 */}
                {isOpen && (
                  <div
                    className={`p-3.5 sm:p-5 md:p-6 border-t-2 border-dashed transition-colors space-y-3 ${
                      isNightMode
                        ? 'bg-[#141A17] border-[#2C3B30] text-[#D8D0C5]'
                        : 'bg-[#F8F4E8] border-[#1E4334]/25 text-[#2D241C]'
                    }`}
                  >
                    {/* 报纸章节子标 */ }
                    <div className="flex items-center justify-between pb-2 mb-3 border-b border-double border-current/25 font-pixel text-[10px] opacity-75">
                      <span>✦ GAZETTE ARTICLE NO. {story.num}</span>
                      <span>PAGE {story.num} OF {AU_NOVEL_STORIES.length}</span>
                    </div>

                    <div className={`font-retro-jp break-words select-text ${getParagraphTextSize()}`}>
                      {paragraphs.map((para, pIdx) => (
                        <p
                          key={pIdx}
                          className="mb-3.5 sm:mb-4.5 text-justify select-text tracking-wide"
                          style={{
                            textIndent: '2em',
                          }}
                        >
                          {para}
                        </p>
                      ))}
                    </div>

                    {/* 底部微型操作：复制 & 上/下篇 */}
                    <div className="pt-2 mt-4 border-t-2 border-dashed border-current/20 flex items-center justify-between text-[11px] font-retro-jp opacity-80">
                      <button
                        onClick={(e) => handleCopyStory(e, story.num, cleanTitle, paragraphs)}
                        className="hover:underline flex items-center gap-1 cursor-pointer font-pixel text-[10px]"
                      >
                        <span>📋 复制本篇全文</span>
                      </button>

                      <div className="flex items-center gap-3 font-pixel text-[10px]">
                        {story.num > 1 && (
                          <button
                            onClick={() => handleJumpToChapter(`s${story.num - 1}`)}
                            className="hover:underline cursor-pointer"
                          >
                            ← 上一篇
                          </button>
                        )}
                        {story.num < AU_NOVEL_STORIES.length && (
                          <button
                            onClick={() => handleJumpToChapter(`s${story.num + 1}`)}
                            className="hover:underline cursor-pointer"
                          >
                            下一篇 →
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 80s 报纸尾部 Footer */}
        <div className="relative mt-6 pt-3 border-t-2 border-double border-current/30 text-center font-retro-jp text-[11px] opacity-75 flex items-center justify-between">
          <span className="font-pixel text-[10px]">❖ 进击的巨人 AU 官方短篇小说 · 80S GAZETTE PRINT ❖</span>
          <button
            onClick={() => {
              soundManager.playBlip();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="underline font-pixel text-[10px] cursor-pointer hover:opacity-100"
          >
            ▲ 回到顶部
          </button>
        </div>
      </div>
    </div>
  );
};
