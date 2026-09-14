import React, { useState, useEffect, useRef } from 'react';
import { GroupNovel } from '../types/doujinArchive';
import { cosService } from '../services/cosClient';
import { soundManager } from '../utils/audio';

interface Props {
  novel: GroupNovel;
  onClose: () => void;
}

const FONT_SIZES = [15, 17, 19];
const FONT_SIZE_KEY = 'lh_novel_font_idx';

/** 在线小说 · 全屏沉浸式文本阅读器（轻量纯文本，段落按空行切分） */
export const NovelReader: React.FC<Props> = ({ novel, onClose }) => {
  const [fontIdx, setFontIdx] = useState<number>(() => {
    const saved = parseInt(localStorage.getItem(FONT_SIZE_KEY) || '', 10);
    return saved >= 0 && saved < FONT_SIZES.length ? saved : 1;
  });
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 按需加载正文（novels/{id}.txt）
  useEffect(() => {
    let alive = true;
    setBody(null);
    setFailed(false);
    setProgress(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    fetch(cosService.getNovelBodyUrl(novel.id), { cache: 'default' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => {
        if (alive) setBody(t);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [novel.id]);

  // Esc 关闭 + 锁定背景滚动
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
  };

  const changeFont = (idx: number) => {
    soundManager.playBlip();
    setFontIdx(idx);
    localStorage.setItem(FONT_SIZE_KEY, String(idx));
  };

  // 空行分段（连续空白视为一个分隔），并去掉每段首尾空白
  const paragraphs = (body ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return (
    <div className="fixed inset-0 z-[90] bg-[#F6F1E3] flex flex-col select-text" role="dialog" aria-modal="true">
      {/* 顶部栏：返回 / 标题 / 作者 / 字号 */}
      <div className="sticky top-0 z-10 px-3 py-2 bg-[#FAF5E8]/95 border-b border-[#1E4334] backdrop-blur-xs flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => {
              soundManager.playBlip();
              onClose();
            }}
            className="px-2.5 py-1 bg-[#1E4334] text-[#F9E79F] font-pixel text-xs rounded-xs hover:bg-[#2B5E4A] cursor-pointer transition-all shrink-0 shadow-xs"
          >
            ← 返回
          </button>
          <div className="min-w-0">
            <h2 className="font-pixel text-xs sm:text-sm font-bold text-[#1E3A2B] truncate">{novel.title}</h2>
            <p className="text-[10px] font-retro-jp text-[#7A6958] truncate">
              {novel.author} · 共 {novel.chars || 0} 字
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0" title="字号">
          {FONT_SIZES.map((size, idx) => (
            <button
              key={size}
              onClick={() => changeFont(idx)}
              className={`px-2 py-1 font-retro-jp text-xs rounded-xs border cursor-pointer transition-all ${
                fontIdx === idx
                  ? 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334] font-bold'
                  : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5]'
              }`}
            >
              {['小', '中', '大'][idx]}
            </button>
          ))}
        </div>
      </div>

      {/* 阅读进度条 */}
      <div className="h-0.5 bg-[#E4D9C3] shrink-0">
        <div className="h-full bg-[#1E4334] transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>

      {/* 正文滚动区 */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        <div className="max-w-[42rem] mx-auto px-4 py-5 space-y-4">
          {novel.warning && (
            <div className="flex items-start gap-1.5 bg-[#FDF0E3] border border-[#E8B04B] rounded-xs px-2 py-1.5">
              <span className="shrink-0 text-[11px] leading-none mt-px">⚠</span>
              <span className="text-[10px] font-retro-jp text-[#8A5A12] break-words leading-snug">{novel.warning}</span>
            </div>
          )}

          {novel.authorNote && (
            <div className="border-l-3 border-[#C29641] bg-[#FAF5E8] rounded-r-xs p-2.5">
              <span className="font-retro-jp text-[11px] font-bold text-[#8C6B38]">作者说：</span>
              <span className="font-retro-jp text-[11px] text-[#5B4636] break-words leading-relaxed">{novel.authorNote}</span>
            </div>
          )}

          {failed && (
            <div className="p-8 text-center bg-[#FFFEEF] border border-dashed border-[#D5C9AF] rounded-md text-xs font-retro-jp text-[#8C7A68]">
              正文加载失败，请返回后重试。
            </div>
          )}

          {!failed && body === null && (
            <div className="p-8 text-center bg-[#FFFEEF] border border-dashed border-[#D5C9AF] rounded-md text-xs font-retro-jp text-[#8C7A68]">
              正在加载正文…
            </div>
          )}

          {body !== null && !failed && (
            <>
              {paragraphs.map((p, i) => (
                <p
                  key={i}
                  className="font-retro-jp text-[#3E342B]"
                  style={{ fontSize: FONT_SIZES[fontIdx], lineHeight: 1.9, textIndent: '2em' }}
                >
                  {p}
                </p>
              ))}
              <div className="pt-6 pb-10 text-center font-retro-jp text-[11px] text-[#8C7A68]">
                —— 全文完 · 共 {novel.chars || 0} 字 ——
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
