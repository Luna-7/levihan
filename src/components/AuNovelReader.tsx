import React, { useState } from 'react';
import { AU_NOVEL_STORIES } from '../data/auNovelData';
import { soundManager } from '../utils/audio';

interface AuNovelReaderProps {
  onShowToast: (msg: string) => void;
}

type FontSize = 'sm' | 'md' | 'lg';

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
  // 阅读参数：字号 ('sm' | 'md' | 'lg') 与夜间模式
  const [fontSize, setFontSize] = useState<FontSize>('sm');
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

  // 段落字号缩放样式
  const getParagraphTextSize = () => {
    switch (fontSize) {
      case 'sm':
        return 'text-[10px] sm:text-[11px] leading-relaxed';
      case 'md':
        return 'text-[11px] sm:text-xs leading-relaxed';
      case 'lg':
        return 'text-xs sm:text-[13px] leading-relaxed';
    }
  };

  return (
    <div
      id="au-novel-reader-root"
      className={`relative w-full select-text transition-colors duration-200 ${
        isNightMode ? 'text-[#DCD5C6]' : 'text-[#3E342B]'
      }`}
    >
      {/* 🛠️ 悬浮工具栏 (字号调整 & 夜间模式切换) */}
      <div
        id="au-floating-toolbar"
        className={`fixed bottom-5 right-4 sm:bottom-6 sm:right-6 z-40 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border shadow-lg transition-all backdrop-blur-md ${
          isNightMode
            ? 'bg-[#181D1A]/90 border-[#384E3F] text-[#EDE7D9]'
            : 'bg-[#FFFEEF]/95 border-[#1E4334] text-[#1E4334]'
        }`}
        style={{ boxShadow: isNightMode ? '0 8px 24px rgba(0,0,0,0.6)' : '0 8px 24px rgba(30,67,52,0.18)' }}
      >
        {/* 字号选择：小 / 中 / 大 */}
        <div className="flex items-center border-r pr-1.5 mr-0.5 border-dashed border-current/25">
          <span className="text-[9px] font-pixel opacity-70 mr-1 hidden xs:inline">字号</span>
          <div className="flex items-center gap-0.5">
            <button
              id="font-size-sm-btn"
              onClick={() => {
                soundManager.playBlip();
                setFontSize('sm');
                onShowToast('字号：小');
              }}
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-pixel transition-all cursor-pointer ${
                fontSize === 'sm'
                  ? isNightMode
                    ? 'bg-[#384E3F] text-[#F9E79F] font-bold'
                    : 'bg-[#1E4334] text-[#F9E79F] font-bold'
                  : 'hover:bg-current/10 opacity-70'
              }`}
              title="小字号"
            >
              小
            </button>
            <button
              id="font-size-md-btn"
              onClick={() => {
                soundManager.playBlip();
                setFontSize('md');
                onShowToast('字号：中');
              }}
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-pixel transition-all cursor-pointer ${
                fontSize === 'md'
                  ? isNightMode
                    ? 'bg-[#384E3F] text-[#F9E79F] font-bold'
                    : 'bg-[#1E4334] text-[#F9E79F] font-bold'
                  : 'hover:bg-current/10 opacity-70'
              }`}
              title="中字号"
            >
              中
            </button>
            <button
              id="font-size-lg-btn"
              onClick={() => {
                soundManager.playBlip();
                setFontSize('lg');
                onShowToast('字号：大');
              }}
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-pixel transition-all cursor-pointer ${
                fontSize === 'lg'
                  ? isNightMode
                    ? 'bg-[#384E3F] text-[#F9E79F] font-bold'
                    : 'bg-[#1E4334] text-[#F9E79F] font-bold'
                  : 'hover:bg-current/10 opacity-70'
              }`}
              title="大字号"
            >
              大
            </button>
          </div>
        </div>

        {/* 夜间模式切换 */}
        <button
          id="night-mode-toggle-btn"
          onClick={() => {
            soundManager.playBlip();
            setIsNightMode(!isNightMode);
            onShowToast(!isNightMode ? '已切换至夜间深色阅读模式 🌙' : '已切换至日间羊皮纸模式 ☀️');
          }}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-pixel transition-all cursor-pointer ${
            isNightMode
              ? 'bg-[#2A352D] hover:bg-[#344238] text-[#F9E79F]'
              : 'bg-[#EAE2CE] hover:bg-[#DDD3BB] text-[#1E4334]'
          }`}
          title={isNightMode ? '切换至日间模式' : '切换至夜间模式'}
        >
          <span>{isNightMode ? '🌙 夜间' : '☀️ 日间'}</span>
        </button>

        {/* 置顶按钮 */}
        <button
          onClick={() => {
            soundManager.playBlip();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="px-1.5 py-0.5 rounded-full text-[10px] font-pixel hover:bg-current/10 opacity-70 cursor-pointer"
          title="回到顶部"
        >
          ↑
        </button>
      </div>

      {/* 主阅读容器 */}
      <div
        className={`relative w-full max-w-4xl mx-auto rounded-xl p-3 sm:p-5 md:p-6 transition-colors duration-200 border-2 sm:border-3 ${
          isNightMode
            ? 'bg-[#151916] border-[#2A3A2F] shadow-xl'
            : 'bg-[#FAF5E8] border-[#1E4334] shadow-md'
        }`}
      >
        {/* 内层虚线框 */}
        <div
          className={`absolute inset-2 border border-dashed rounded-lg pointer-events-none ${
            isNightMode ? 'border-[#33473A]/60' : 'border-[#D4B26F]'
          }`}
        />

        {/* 顶部标题：简约大气 */}
        <div className="relative text-center mb-3 pt-0.5">
          <h1
            className={`font-pixel text-base sm:text-lg md:text-xl tracking-wide font-bold ${
              isNightMode ? 'text-[#F9E79F]' : 'text-[#1E4334]'
            }`}
          >
            AU 官方小说短篇集
          </h1>
        </div>

        {/* 📄 百度网盘纯英文版跳转卡片：重新设计，仅仅出现“AU官方小说英文版 ↗”，点击直接跳转 */}
        <div
          id="au-english-docx-card"
          onClick={handleOpenEnglishDoc}
          className={`relative mb-3.5 px-3 py-2 rounded-md border cursor-pointer transition-all hover:scale-[1.004] active:scale-[0.995] flex items-center justify-center gap-1.5 group select-none ${
            isNightMode
              ? 'bg-[#1B231E] border-[#384E3F] hover:border-[#F9E79F] text-[#F9E79F]'
              : 'bg-[#FFFEEF] border-[#1E4334] hover:border-[#B7791F] text-[#1E4334]'
          }`}
          title="点击直接跳转至百度网盘（提取码: 9fpv）"
        >
          <span className="font-pixel text-[11px] sm:text-xs font-bold tracking-wide flex items-center gap-1.5">
            <span>AU官方小说英文版</span>
            <span className="text-xs group-hover:translate-x-0.5 transition-transform">↗</span>
          </span>
        </div>

        {/* 简约操作栏：目录索引与全部展开/收起 */}
        <div className="relative flex items-center justify-between gap-2 mb-3 pb-1.5 border-b border-dashed border-current/20 font-retro-jp text-[11px]">
          <div className="flex items-center gap-2">
            <button
              id="au-toc-toggle-btn"
              onClick={() => {
                soundManager.playBlip();
                setShowToc(!showToc);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm border font-pixel text-[10px] sm:text-[11px] cursor-pointer transition-all ${
                showToc
                  ? isNightMode
                    ? 'bg-[#384E3F] text-[#F9E79F] border-[#384E3F]'
                    : 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334]'
                  : isNightMode
                  ? 'bg-[#212823] text-[#D4CBC0] border-[#384A3D] hover:bg-[#28322B]'
                  : 'bg-[#FAF5E8] text-[#5B4636] border-[#C5B495] hover:bg-white'
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
              className={`px-2 py-0.5 rounded-sm border font-pixel text-[10px] cursor-pointer transition-all ${
                isNightMode
                  ? 'bg-[#212823] hover:bg-[#2B352E] text-[#D4CBC0] border-[#384A3D]'
                  : 'bg-[#FAF5E8] hover:bg-white text-[#5B4636] border-[#C5B495]'
              }`}
            >
              全部展开
            </button>
            <button
              id="au-collapse-all-btn"
              onClick={handleCollapseAll}
              className={`px-2 py-0.5 rounded-sm border font-pixel text-[10px] cursor-pointer transition-all ${
                isNightMode
                  ? 'bg-[#212823] hover:bg-[#2B352E] text-[#D4CBC0] border-[#384A3D]'
                  : 'bg-[#FAF5E8] hover:bg-white text-[#5B4636] border-[#C5B495]'
              }`}
            >
              全部收起
            </button>
          </div>
        </div>

        {/* 篇目目录抽屉：按要求 button 设为多行，完整显示各篇中文名称 */}
        {showToc && (
          <div
            className={`relative mb-4 p-3 rounded-lg border shadow-xs transition-colors ${
              isNightMode
                ? 'bg-[#1B221E] border-[#384E3F]'
                : 'bg-[#FFFEEF] border-[#1E4334]'
            }`}
          >
            <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-dashed border-current/20">
              <h3
                className={`font-pixel text-[11px] font-bold flex items-center gap-1.5 ${
                  isNightMode ? 'text-[#F9E79F]' : 'text-[#1E4334]'
                }`}
              >
                <span>📚 篇目快速索引目录</span>
              </h3>
              <button
                onClick={() => setShowToc(false)}
                className="text-[10px] opacity-70 hover:opacity-100 cursor-pointer"
              >
                ✕ 收起
              </button>
            </div>

            {/* 多列网格，每个 button 设置多行，完整列出中文名 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 max-h-72 overflow-y-auto pr-1">
              {AU_NOVEL_STORIES.map((story) => {
                const cleanTitle = formatCleanChineseTitle(story.titleZh);
                return (
                  <button
                    key={story.id}
                    onClick={() => handleJumpToChapter(story.id)}
                    className={`w-full text-left py-1.5 px-2 rounded-xs border-b border-dashed border-current/15 text-[10px] sm:text-[11px] font-retro-jp leading-snug transition-colors flex items-start gap-1.5 cursor-pointer whitespace-normal break-words ${
                      isNightMode
                        ? 'text-[#C9C1B2] hover:text-[#F9E79F] hover:bg-[#252E28]'
                        : 'text-[#4A3E31] hover:text-[#1E4334] hover:bg-[#F3EAD5]'
                    }`}
                  >
                    <span className="font-pixel text-[9px] text-[#B7791F] shrink-0 font-bold mt-0.5">
                      #{story.num.toString().padStart(2, '0')}
                    </span>
                    <span className="break-words flex-1 leading-snug">{cleanTitle}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 章节卡片列表：字体缩小，button 设为多行并完全列出中文名，随设备动态自适应 */}
        <div className="relative flex flex-col gap-2">
          {AU_NOVEL_STORIES.map((story) => {
            const isOpen = openIds.has(story.id);
            const cleanTitle = formatCleanChineseTitle(story.titleZh);
            const paragraphs = story.paragraphsZh;

            return (
              <div
                key={story.id}
                id={story.id}
                className={`rounded-md overflow-hidden transition-all border scroll-mt-4 ${
                  isOpen
                    ? isNightMode
                      ? 'bg-[#19201C] border-[#384E3F] shadow-xs'
                      : 'bg-[#FFFEEF] border-[#1E4334] shadow-xs'
                    : isNightMode
                    ? 'bg-[#1F2621] border-[#2D3830] hover:border-[#384E3F]'
                    : 'bg-[#FAF5E8] border-[#C5B495] hover:border-[#1E4334]'
                }`}
              >
                {/* 章节折叠头部 Button：多行显示、无省略号、完全列出中文名称 */}
                <button
                  onClick={() => handleToggleCard(story.id)}
                  className={`w-full flex items-start justify-between text-left p-2 sm:p-2.5 transition-colors cursor-pointer border-0 ${
                    isOpen
                      ? isNightMode
                        ? 'bg-[#27342B] text-[#F9E79F]'
                        : 'bg-[#1E4334] text-[#F9E79F]'
                      : isNightMode
                      ? 'bg-[#222A24] text-[#DDD6C8] hover:bg-[#29332C]'
                      : 'bg-[#F5EDE0] text-[#3E342B] hover:bg-[#EFE4D2]'
                  }`}
                >
                  <div className="flex items-start gap-1.5 min-w-0 pr-2 flex-1">
                    <span
                      className={`font-pixel text-[9px] px-1.5 py-0.5 rounded-xs shrink-0 font-bold mt-0.5 ${
                        isOpen
                          ? isNightMode
                            ? 'bg-[#F9E79F] text-[#1E2520]'
                            : 'bg-[#F9E79F] text-[#1E4334]'
                          : isNightMode
                          ? 'bg-[#314135] text-[#D8E6DC]'
                          : 'bg-[#1E4334] text-[#F9E79F]'
                      }`}
                    >
                      #{story.num.toString().padStart(2, '0')}
                    </span>
                    <h3 className="font-pixel text-[10.5px] sm:text-[11.5px] font-bold tracking-normal break-words whitespace-normal leading-snug flex-1">
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

                {/* 章节正文：字体缩小、完全展示、根据设备与字号动态调整 */}
                {isOpen && (
                  <div
                    className={`p-2.5 sm:p-3.5 md:p-4 border-t border-dashed transition-colors space-y-2 ${
                      isNightMode
                        ? 'bg-[#181E1B] border-[#2C3B30] text-[#D3CAC0]'
                        : 'bg-[#FFFEEF] border-[#D5C9AF] text-[#3E342B]'
                    }`}
                  >
                    <div className={`font-retro-jp break-words select-text ${getParagraphTextSize()}`}>
                      {paragraphs.map((para, pIdx) => (
                        <p
                          key={pIdx}
                          className="mb-1.5 sm:mb-2 text-justify select-text"
                          style={{ textIndent: '1.75em' }}
                        >
                          {para}
                        </p>
                      ))}
                    </div>

                    {/* 底部微型操作：复制 & 上/下篇 */}
                    <div className="pt-1.5 border-t border-dashed border-current/15 flex items-center justify-between text-[10px] font-retro-jp opacity-75">
                      <button
                        onClick={(e) => handleCopyStory(e, story.num, cleanTitle, paragraphs)}
                        className="hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <span>📋 复制本篇</span>
                      </button>

                      <div className="flex items-center gap-2.5">
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

        {/* 简约 Footer */}
        <div className="relative mt-4 pt-2 border-t border-dashed border-current/20 text-center font-retro-jp text-[10px] opacity-60 flex items-center justify-between">
          <span>进击的巨人 AU 官方短篇小说</span>
          <button
            onClick={() => {
              soundManager.playBlip();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="underline font-pixel text-[9px] cursor-pointer hover:opacity-100"
          >
            ↑ 回到顶部
          </button>
        </div>
      </div>
    </div>
  );
};
