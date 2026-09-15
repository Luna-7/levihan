import React, { useState, useEffect, useMemo } from 'react';
import { RecommendItem, GroupNovel } from '../types/doujinArchive';
import { soundManager } from '../utils/audio';
import { NovelReader } from './NovelReader';
import { AuthorWithLink } from '../utils/authorLink';
import { newestNovelsFirst, newestRecsFirst } from '../utils/workSort';

interface Props {
  searchQuery: string;
  recs: RecommendItem[];
  novels: GroupNovel[];
  onShowToast: (msg: string) => void;
}

/** 从链接域名解析网站名（不做标签，放卡片最右侧） */
const siteName = (url: string): string => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith('archiveofourown.org')) return 'AO3';
    if (host.endsWith('lofter.com')) return 'LOFTER';
    if (host.endsWith('weibo.com')) return '微博';
    return host.replace(/^www\./, '').toUpperCase();
  } catch {
    return '';
  }
};

/** 字数缩写：12345 → 1.2万；8600 → 8.6千 */
const fmtChars = (n: number): string => {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + ' 千';
  return String(n);
};

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
};

/**
 * 小说本模块：段切换（全部 / 在线小说 / 站外推荐）+ 题材筛选（含评级，单排扁平）
 * 第一段 在线小说 = 竖版卡片瀑布流；第二段 站外推荐 = 横向信息卡瀑布流
 */
export const NovelModule: React.FC<Props> = ({ searchQuery, recs, novels, onShowToast }) => {
  const [seg, setSeg] = useState<string>('全部'); // 全部 | 在线小说 | 站外推荐
  const [genre, setGenre] = useState<string>('全部');
  const [openRec, setOpenRec] = useState<RecommendItem | null>(null);
  const [reading, setReading] = useState<GroupNovel | null>(null);

  // 题材 = 数据里 (type ∪ rating) 去重，不写死（R / 清水 与现PA / 原作同级）
  const genreList = useMemo(
    () => Array.from(new Set(recs.flatMap((r) => [r.type, r.rating]).filter(Boolean))),
    [recs]
  );

  const q = searchQuery.trim().toLowerCase();

  const filteredNovels = useMemo(
    () =>
      newestNovelsFirst(novels.filter((n) => {
        const matchSearch =
          !q ||
          n.title.toLowerCase().includes(q) ||
          n.author.toLowerCase().includes(q) ||
          (n.authorNote && n.authorNote.toLowerCase().includes(q)) ||
          (n.tags || []).some((t) => t.toLowerCase().includes(q));
        return matchSearch;
      })),
    [novels, q]
  );

  const filteredRecs = useMemo(
    () =>
      newestRecsFirst(recs.filter((r) => {
        const matchGenre = genre === '全部' || r.type === genre || r.rating === genre;
        const matchSearch =
          !q ||
          r.title.toLowerCase().includes(q) ||
          r.type.toLowerCase().includes(q) ||
          r.rating.toLowerCase().includes(q) ||
          (r.recommender && r.recommender.toLowerCase().includes(q)) ||
          (r.reason && r.reason.toLowerCase().includes(q));
        return matchGenre && matchSearch;
      })),
    [recs, genre, q]
  );

  // 弹窗：Esc 关闭 + 锁背景滚动
  useEffect(() => {
    if (!openRec) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenRec(null);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [openRec]);

  const showNovels = seg === '全部' || seg === '在线小说';
  const showRecs = seg === '全部' || seg === '站外推荐';
  const genreDisabled = seg === '在线小说';

  const openRecModal = (rec: RecommendItem) => {
    soundManager.playBlip();
    setOpenRec(rec);
  };

  const handleJump = (rec: RecommendItem) => {
    if (!rec.url) return;
    soundManager.playBlip();
    // 弹窗保持打开：用户看完可能回来继续复制名称
    window.open(rec.url, '_blank', 'noopener,noreferrer');
  };

  const handleCopyTitle = async (rec: RecommendItem) => {
    const ok = await copyToClipboard(rec.title);
    if (ok) {
      onShowToast(`已复制标题《${rec.title.slice(0, 18)}${rec.title.length > 18 ? '…' : ''}》📋`);
      setOpenRec(null); // 复制成功后自动关弹窗
    } else {
      onShowToast('复制失败，请长按标题手动复制');
    }
  };

  // 推荐理由文本：@推荐人 说：…（只有推荐人 / 只有理由时分别降级）
  const reasonText = (r: RecommendItem): string | null => {
    if (r.recommender && r.reason) return `@${r.recommender} 说：${r.reason}`;
    if (r.recommender) return `@${r.recommender} 说：`;
    if (r.reason) return `说：${r.reason}`;
    return null;
  };

  const chipCls = (active: boolean) =>
    `px-2 py-0.5 rounded-xs border transition-all cursor-pointer text-[11px] font-retro-jp ${
      active
        ? 'bg-[#B7791F] text-[#FFFEEF] border-[#B7791F] font-bold'
        : 'bg-[#FAF5E8] text-[#7A6958] border-[#E0D5BE] hover:bg-white'
    }`;

  const segCls = (active: boolean) =>
    `px-2 py-0.5 rounded-xs border transition-all cursor-pointer text-[11px] font-retro-jp ${
      active
        ? 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334] font-bold shadow-xs'
        : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5]'
    }`;

  const tagChipCls =
    'text-[9px] font-retro-jp px-1.5 py-0.2 rounded-xs border bg-[#F4EEDF] text-[#7A6958] border-[#DECFA9]';

  return (
    <div className="space-y-3">
      {/* 模块筛选条：段切换 + 题材（含评级，扁平单排） */}
      <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-md p-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-retro-jp">
          <span className="text-[10px] font-pixel text-[#8C7A68] mr-1">段:</span>
          {['全部', '在线小说', '站外推荐'].map((s) => (
            <button
              key={s}
              onClick={() => {
                soundManager.playBlip();
                setSeg(s);
              }}
              className={segCls(seg === s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div
          className={`flex flex-wrap items-center gap-1 pt-1 border-t border-dashed border-[#E0D5BE] text-xs font-retro-jp ${
            genreDisabled ? 'opacity-40 pointer-events-none' : ''
          }`}
          title={genreDisabled ? '题材筛选仅作用于站外推荐' : undefined}
        >
          <span className="text-[10px] font-pixel text-[#8C7A68] mr-1">题材:</span>
          {['全部', ...genreList].map((g) => (
            <button
              key={g}
              onClick={() => {
                soundManager.playBlip();
                setGenre(g);
              }}
              className={chipCls(genre === g)}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* 第一段：在线小说（竖版卡片瀑布流，手机 2 列） */}
      {showNovels && (
        <div className="space-y-2">
          <h3 className="font-pixel text-xs font-bold text-[#1E3A2B]">在线小说 · 共 {filteredNovels.length} 篇</h3>
          {filteredNovels.length === 0 ? (
            <div className="p-6 text-center bg-[#FFFEEF] border border-dashed border-[#D5C9AF] rounded-md text-xs font-retro-jp text-[#8C7A68]">
              还没有在线小说，敬请期待～
            </div>
          ) : (
            <div className="columns-2 md:columns-3 lg:columns-4 gap-2 sm:gap-3">
              {filteredNovels.map((novel) => (
                <div
                  key={novel.id}
                  className="mb-2 sm:mb-3 break-inside-avoid group cursor-pointer select-none"
                  title="点击在线阅读"
                  onClick={() => {
                    soundManager.playBlip();
                    setReading(novel);
                    onShowToast(`正在打开《${novel.title}》📖`);
                  }}
                >
                  <div className="bg-[#FFFEEF] border border-[#D5C9AF] hover:border-[#1E4334] hover:shadow-md rounded-md p-3 space-y-2 transition-all">
                    {/* 徽章行：在线 + 字数 */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-pixel text-[9px] px-1.5 py-0.2 bg-[#1E4334] text-[#F9E79F] rounded-xs font-bold">
                        在线
                      </span>
                      <span className="text-[10px] font-retro-jp text-[#8C7A68]">{fmtChars(novel.chars || 0)}字</span>
                    </div>

                    <h4 className="font-pixel text-xs sm:text-[13px] font-bold text-[#1E3A2B] group-hover:text-[#B7791F] break-words leading-snug transition-colors">
                      {novel.title}
                    </h4>

                    {/* 字段块：作者 / 字数 / 更新 */}
                    <div className="bg-[#FAF5E8] border border-[#EBE3D0] rounded-xs p-2 space-y-1 text-[11px] font-retro-jp">
                      <div className="flex items-start gap-1">
                        <span className="font-bold text-[#8C6B38] shrink-0 w-10 text-right">作者:</span>
                        <span className="text-[#3E342B] font-bold flex-1 break-words"><AuthorWithLink author={novel.author} customUrl={novel.authorUrl} /></span>
                      </div>
                      <div className="flex items-start gap-1">
                        <span className="font-bold text-[#7A6958] shrink-0 w-10 text-right">字数:</span>
                        <span className="text-[#5B4636] flex-1">{fmtChars(novel.chars || 0)}</span>
                      </div>
                      {novel.updatedAt && (
                        <div className="flex items-start gap-1">
                          <span className="font-bold text-[#7A6958] shrink-0 w-10 text-right">更新:</span>
                          <span className="text-[#5B4636] flex-1">{novel.updatedAt.slice(0, 10)}</span>
                        </div>
                      )}
                    </div>

                    {/* 标签行：空则整行不渲染 */}
                    {!!(novel.tags && novel.tags.length) && (
                      <div className="flex flex-wrap gap-1">
                        {novel.tags.map((tag, i) => (
                          <span key={i} className={tagChipCls}>
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 内容预警：未填写不渲染 */}
                    {novel.warning && (
                      <div className="flex items-start gap-1.5 bg-[#FDF0E3] border border-[#E8B04B] rounded-xs px-2 py-1.5">
                        <span className="shrink-0 text-[11px] leading-none mt-px">⚠</span>
                        <span className="text-[10px] font-retro-jp text-[#8A5A12] break-words leading-snug">{novel.warning}</span>
                      </div>
                    )}

                    {/* 作者说的话：未填写不渲染 */}
                    {novel.authorNote && (
                      <div className="border-l-3 border-[#C29641] bg-[#FAF5E8] rounded-r-xs p-2">
                        <span className="font-retro-jp text-[10px] font-bold text-[#8C6B38]">作者说：</span>
                        <span className="font-retro-jp text-[10px] text-[#5B4636] break-words leading-snug line-clamp-3">
                          {novel.authorNote}
                        </span>
                      </div>
                    )}

                    {/* 底栏 */}
                    <div className="pt-2 border-t border-dashed border-[#E0D5BE] flex items-center justify-between text-[10px] font-retro-jp text-[#8C7A68]">
                      <span>共 {fmtChars(novel.chars || 0)} 字</span>
                      <span className="text-[#1E4334] font-pixel text-[10px] group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                        <span>在线阅读</span>
                        <span>→</span>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 第二段：站外推荐（横向信息卡瀑布流，手机 1 列） */}
      {showRecs && recs.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-pixel text-xs font-bold text-[#1E3A2B]">站外推荐 · 共 {filteredRecs.length} 篇</h3>
          {filteredRecs.length === 0 ? (
            <div className="p-6 text-center bg-[#FFFEEF] border border-dashed border-[#D5C9AF] rounded-md text-xs font-retro-jp text-[#8C7A68]">
              没有符合筛选的推荐，可以换个题材试试～
            </div>
          ) : (
            <div className="columns-1 sm:columns-2 gap-2 sm:gap-3">
              {filteredRecs.map((rec) => {
                const reason = reasonText(rec);
                const site = siteName(rec.url);
                return (
                  <div
                    key={rec.id}
                    className="mb-2 sm:mb-3 break-inside-avoid group cursor-pointer select-none"
                    title="点击选择打开方式"
                    onClick={() => openRecModal(rec)}
                  >
                    <div className="bg-[#FFFEEF] border border-[#D5C9AF] hover:border-[#1E4334] hover:shadow-md rounded-md p-3 space-y-2 transition-all">
                      {/* 顶部行：题材/评级标签（同级同款） + 网站名（最右，非标签） */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap gap-1">
                          <span className={tagChipCls}>#{rec.type}</span>
                          <span className={tagChipCls}>#{rec.rating}</span>
                        </div>
                        {site && (
                          <span className="text-[11px] font-retro-jp text-[#8C7A68] shrink-0">{site} ↗</span>
                        )}
                      </div>

                      <h4 className="font-pixel text-xs sm:text-[13px] font-bold text-[#1E3A2B] group-hover:text-[#B7791F] break-words leading-snug transition-colors line-clamp-2">
                        {rec.title}
                      </h4>

                      {/* 理由块：@推荐人 说：…；都没有则不渲染 */}
                      {reason && (
                        <div className="bg-[#FAF5E8] border border-[#EBE3D0] rounded-xs p-2">
                          <span className="font-retro-jp text-[11px] text-[#7A6958] break-words leading-snug line-clamp-3">
                            {reason}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 打开方式弹窗 */}
      {openRec && (
        <div
          className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpenRec(null)}
        >
          <div
            className="bg-[#FFFEEF] border-2 border-[#1E4334] rounded-lg w-full max-w-md p-4 space-y-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="font-pixel text-xs font-bold text-[#1E4334]">打开方式</span>
              <button
                onClick={() => setOpenRec(null)}
                className="text-[#8C7A68] hover:text-[#1E4334] px-1 cursor-pointer text-sm"
                title="关闭"
              >
                ✕
              </button>
            </div>

            <h4 className="font-pixel text-sm font-bold text-[#1E3A2B] break-words leading-snug">{openRec.title}</h4>

            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1">
                <span className={tagChipCls}>#{openRec.type}</span>
                <span className={tagChipCls}>#{openRec.rating}</span>
              </div>
              {siteName(openRec.url) && (
                <span className="text-[11px] font-retro-jp text-[#8C7A68]">{siteName(openRec.url)}</span>
              )}
            </div>

            {reasonText(openRec) && (
              <div className="bg-[#FAF5E8] border border-[#EBE3D0] rounded-xs p-2.5">
                <span className="font-retro-jp text-[11px] text-[#5B4636] break-words leading-relaxed">
                  {reasonText(openRec)}
                </span>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => handleJump(openRec)}
                disabled={!openRec.url}
                className={`flex-1 px-3 py-2.5 rounded-xs font-pixel text-xs transition-all ${
                  openRec.url
                    ? 'bg-[#1E4334] text-[#F9E79F] hover:bg-[#2B5E4A] cursor-pointer shadow-xs'
                    : 'bg-[#EFE8D6] text-[#B4A68F] cursor-not-allowed'
                }`}
              >
                ↗ 直接跳转
              </button>
              <button
                onClick={() => handleCopyTitle(openRec)}
                className="flex-1 px-3 py-2.5 rounded-xs font-pixel text-xs bg-[#FFFEEF] text-[#1E4334] border border-[#D5C9AF] hover:border-[#1E4334] cursor-pointer transition-all"
              >
                ⧉ 复制名称
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 在线阅读器 */}
      {reading && <NovelReader novel={reading} onClose={() => setReading(null)} />}
    </div>
  );
};
