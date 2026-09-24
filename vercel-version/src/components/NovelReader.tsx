import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { GroupNovel } from '../types/doujinArchive';
import { cosService } from '../services/cosClient';
import { soundManager } from '../utils/audio';
import { AuthorWithLink } from '../utils/authorLink';
import { getAccessToken } from '../utils/cloudbaseToken';
import { ADMIN_UPLOAD_ENDPOINT, fetchBackend } from '../utils/cloudbaseEndpoint';
import { NovelComments } from './NovelComments';

interface Props {
  novel: GroupNovel;
  onClose: () => void;
}

const FONT_SIZES = [16, 18, 20, 23];
const FONT_LABELS = ['小', '中', '大', '特大'];
const FONT_SIZE_KEY = 'lh_novel_font_idx';

/** 在线小说 · 全屏沉浸式文本阅读器（轻量纯文本，段落按空行切分） */
export const NovelReader: React.FC<Props> = ({ novel, onClose }) => {
  const [fontIdx, setFontIdx] = useState<number>(() => {
    const saved = parseInt(localStorage.getItem(FONT_SIZE_KEY) || '', 10);
    return saved >= 0 && saved < FONT_SIZES.length ? saved : 1;
  });
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  const [failedReason, setFailedReason] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);

  // 按需加载正文（本地编译内容直接使用；加密篇拉密文解密；否则请求 novels/{id}.txt）
  useEffect(() => {
    let alive = true;
    setFailed(false);
    setFailedReason('');
    setProgress(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    if (novel.bodyContent) {
      setBody(novel.bodyContent);
      return;
    }

    setBody(null);

    /** 加密篇：经登录鉴权由服务端解密后下发明文，密钥不下发前端 */
    if (novel.encrypted) {
      void (async () => {
        try {
          const token = await getAccessToken();
          if (!token) {
            if (alive) {
              setFailed(true);
              setFailedReason('本篇为加密内容，请先登录账号后再阅读。');
            }
            return;
          }
          const resp = await fetchBackend(ADMIN_UPLOAD_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: 'novelBody', id: novel.id }),
          });
          const result = await resp.json().catch(() => null) as { ok?: boolean; body?: string; error?: string } | null;
          if (!resp.ok || !result?.ok || typeof result.body !== 'string') {
            throw new Error(result?.error || `HTTP ${resp.status}`);
          }
          if (alive) setBody(result.body);
        } catch {
          if (alive) {
            setFailed(true);
            setFailedReason('内容加载失败，请确认已登录后重试。');
          }
        }
      })();
      return () => {
        alive = false;
      };
    }

    fetch(cosService.getNovelBodyUrl(novel.id), { cache: 'default' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => {
        if (alive) setBody(t);
      })
      .catch(() => {
        if (alive) {
          setFailed(true);
          setFailedReason('正文加载失败，请返回后重试。');
        }
      });
    return () => {
      alive = false;
    };
  }, [novel.id, novel.bodyContent, novel.encrypted]);

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
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
    });
  };

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const changeFont = (idx: number) => {
    soundManager.playBlip();
    setFontIdx(idx);
    localStorage.setItem(FONT_SIZE_KEY, String(idx));
  };

  // 空行分段（连续空白视为一个分隔），并去掉每段首尾空白
  const paragraphs = (body ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const reader = (
    <div className="fixed inset-0 z-[90] bg-[#F6F1E3] flex flex-col select-text" role="dialog" aria-modal="true">
      {/* 顶部栏：返回 / 标题 / 作者 / 字号（适配 iOS / Android PWA 顶部安全区，完全不透明底色防止文字穿透） */}
      <div
        className="sticky top-0 z-20 px-3.5 bg-[#FAF5E8] border-b border-[#1E4334]/30 shadow-xs flex items-center justify-between gap-2.5 shrink-0"
        style={{
          paddingTop: 'max(10px, env(safe-area-inset-top, 0px))',
          paddingBottom: '10px',
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => {
              soundManager.playWoodTap();
              onClose();
            }}
            className="px-3 py-1.5 min-h-[34px] bg-[#1E4334] text-[#F9E79F] font-pixel text-xs sm:text-sm rounded-md hover:bg-[#2B5E4A] cursor-pointer transition-all shrink-0 shadow-xs flex items-center justify-center active:scale-95"
          >
            ← 返回
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="font-pixel text-sm sm:text-base font-bold text-[#1E3A2B] truncate">{novel.title}</h2>
            <p className="text-xs font-retro-jp text-[#7A6958] truncate mt-0.5">
              <AuthorWithLink author={novel.author} customUrl={novel.authorUrl} defaultColorClass="text-[#7A6958]" /> · 共 {novel.chars || 0} 字
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0" title="调节字号">
          {FONT_SIZES.map((size, idx) => (
            <button
              key={size}
              type="button"
              onClick={() => changeFont(idx)}
              className={`px-2.5 py-1 min-h-[32px] font-retro-jp text-xs sm:text-sm rounded-md border cursor-pointer transition-all flex items-center justify-center ${
                fontIdx === idx
                  ? 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334] font-bold shadow-2xs'
                  : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5]'
              }`}
            >
              {FONT_LABELS[idx]}
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
        <div
          className="max-w-[44rem] mx-auto px-4 sm:px-6 py-6 space-y-5"
          style={{ paddingBottom: 'max(48px, env(safe-area-inset-bottom, 0px))' }}
        >
          {/* 接龙合订本专属头衔与创作者全名单 */}
          {novel.isRelayCompiled && (
            <div className="bg-[#F8EFE0] border-2 border-[#C99C53] rounded-md p-4 space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between gap-2 border-b border-[#DFC593] pb-2">
                <span className="font-pixel text-xs sm:text-sm text-[#7A4F1D] font-bold">
                  🪶 故事接龙合订本 · 共 {novel.relayStepsCount || 1} 棒连缀
                </span>
                <span className="text-xs font-retro-jp text-[#8C6B38]">
                  {novel.chars || 0} 字
                </span>
              </div>
              <div className="space-y-1.5">
                <span className="font-retro-jp text-xs font-bold text-[#7A4F1D]">接力执笔同好：</span>
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {(novel.relayAuthors || [novel.author]).map((authorName, aIdx) => (
                    <span
                      key={aIdx}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xs bg-[#FAF5E8] border border-[#DFC593] text-[#3B2818] font-retro-jp text-xs font-bold"
                    >
                      <span className="text-[#7A4F1D]">#{aIdx + 1}</span>
                      <span>{authorName}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {novel.warning && (
            <div className="flex items-start gap-2 bg-[#FDF0E3] border border-[#E8B04B] rounded-xs px-3 py-2">
              <span className="shrink-0 text-sm leading-none mt-0.5">⚠</span>
              <span className="text-xs sm:text-[13px] font-retro-jp text-[#8A5A12] break-words leading-relaxed">{novel.warning}</span>
            </div>
          )}

          {novel.authorNote && !novel.isRelayCompiled && (
            <div className="border-l-3 border-[#C29641] bg-[#FAF5E8] rounded-r-xs p-3">
              <span className="font-retro-jp text-xs sm:text-[13px] font-bold text-[#8C6B38]">作者说：</span>
              <span className="font-retro-jp text-xs sm:text-[13px] text-[#5B4636] break-words leading-relaxed">{novel.authorNote}</span>
            </div>
          )}

          {failed && (
            <div className="p-8 text-center bg-[#FFFEEF] border border-dashed border-[#D5C9AF] rounded-md text-sm font-retro-jp text-[#8C7A68]">
              {failedReason || '正文加载失败，请返回后重试。'}
            </div>
          )}

          {!failed && body === null && (
            <div className="p-8 text-center bg-[#FFFEEF] border border-dashed border-[#D5C9AF] rounded-md text-sm font-retro-jp text-[#8C7A68]">
              正在加载正文…
            </div>
          )}

          {body !== null && !failed && (
            <>
              {paragraphs.map((p, i) => {
                const isHeading = p.startsWith('【') || p.startsWith('─');
                return (
                  <p
                    key={i}
                    className={`font-retro-jp whitespace-pre-wrap break-words ${isHeading ? 'text-[#5F3B17] font-bold text-base sm:text-lg' : 'text-[#3E342B]'}`}
                    style={{ fontSize: FONT_SIZES[fontIdx], lineHeight: 2.05, textIndent: isHeading ? 0 : '2em' }}
                  >
                    {p}
                  </p>
                );
              })}
              <div className="pt-8 pb-4 text-center font-retro-jp text-xs sm:text-sm text-[#8C7A68]">
                —— 全文完 · 共 {novel.chars || 0} 字 ——
              </div>
            </>
          )}

          {/* 评论区：正文加载失败也照样展示，不挡读后讨论 */}
          <NovelComments novelId={novel.id} novelAuthorUid={novel.uid} />
          <div className="pb-16" />
        </div>
      </div>
    </div>
  );

  // App 主体使用横向 transform 切页；fixed 若留在该树内会以变换父级为坐标系，
  // 在移动端表现为四倍宽内容被视口裁切。Portal 到 body 后才是真正的全屏阅读器。
  return typeof document !== 'undefined' ? createPortal(reader, document.body) : reader;
};
