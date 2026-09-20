import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Feather, BookOpen } from 'lucide-react';
import { RecommendItem, GroupNovel } from '../types/doujinArchive';
import { soundManager } from '../utils/audio';
import { NovelReader } from './NovelReader';
import { AuthorWithLink } from '../utils/authorLink';
import { newestNovelsFirst, newestRecsFirst } from '../utils/workSort';
import { submitToInbox } from '../utils/submissionInbox';
import { CardPatternOverlay } from './CardPatternOverlay';

interface Props {
  searchQuery: string;
  recs: RecommendItem[];
  novels: GroupNovel[];
  onShowToast: (msg: string) => void;
  initialSeg?: string;
  initialReadingNovel?: GroupNovel | null;
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
export const NovelModule: React.FC<Props> = ({
  searchQuery,
  recs,
  novels,
  onShowToast,
  initialSeg,
  initialReadingNovel,
}) => {
  const [seg, setSeg] = useState<string>(initialSeg || '全部'); // 全部 | 在线小说 | 站外推荐
  const [genre, setGenre] = useState<string>('全部');
  const [openRec, setOpenRec] = useState<RecommendItem | null>(null);
  const [reading, setReading] = useState<GroupNovel | null>(initialReadingNovel || null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadKind, setUploadKind] = useState<'novel' | 'recommend'>('novel');
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadAuthor, setUploadAuthor] = useState('');
  const [uploadEmail, setUploadEmail] = useState('');
  const [uploadAuthorUrl, setUploadAuthorUrl] = useState('');
  const [uploadBody, setUploadBody] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploadFileName, setUploadFileName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [recTitle, setRecTitle] = useState('');
  const [recLink, setRecLink] = useState('');
  const [recAuthor, setRecAuthor] = useState('');
  const [recReason, setRecReason] = useState('');
  const [recCategory, setRecCategory] = useState('原作向');

  useEffect(() => {
    if (initialSeg) {
      setSeg(initialSeg);
    }
  }, [initialSeg]);

  useEffect(() => {
    if (initialReadingNovel) {
      setReading(initialReadingNovel);
    }
  }, [initialReadingNovel]);

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
    soundManager.playEnvelopeOpen();
    setOpenRec(rec);
  };

  const handleJump = (rec: RecommendItem) => {
    if (!rec.url) return;
    soundManager.playWarpJump();
    // 弹窗保持打开：用户看完可能回来继续复制名称
    window.open(rec.url, '_blank', 'noopener,noreferrer');
  };

  const handleCopyTitle = async (rec: RecommendItem) => {
    const ok = await copyToClipboard(rec.title);
    if (ok) {
      soundManager.playCopySuccess();
      onShowToast(`已复制标题《${rec.title.slice(0, 18)}${rec.title.length > 18 ? '…' : ''}》📋`);
      setOpenRec(null); // 复制成功后自动关弹窗
    } else {
      onShowToast('复制失败，请长按标题手动复制');
    }
  };

  const handleNovelFile = async (file?: File) => {
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name)) {
      onShowToast('目前仅支持 UTF-8 的 .txt 或 .md 文件');
      return;
    }
    if (file.size > 1024 * 1024) {
      onShowToast('小说文件不能超过 1MB');
      return;
    }
    try {
      const content = await file.text();
      setUploadBody(content);
      setUploadFileName(file.name);
      if (!uploadTitle) setUploadTitle(file.name.replace(/\.(txt|md)$/i, ''));
      onShowToast(`已读取《${file.name}》`);
    } catch {
      onShowToast('无法读取文件，请确认它是 UTF-8 文本');
    }
  };

  const handleNovelSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (uploadKind === 'recommend') {
      if (!recTitle.trim() || !recLink.trim()) { onShowToast('请填写推荐名称和外链'); return; }
      setIsUploading(true);
      try {
        await submitToInbox('submitRecommend', { title: recTitle.trim(), link: recLink.trim(), author: recAuthor.trim(), reason: recReason.trim(), category: recCategory });
        setShowUpload(false); setRecTitle(''); setRecLink(''); setRecReason('');
        onShowToast('推荐已提交，审核通过后会进入站外推荐');
      } catch (error) { onShowToast(error instanceof Error ? error.message : '推荐提交失败'); }
      finally { setIsUploading(false); }
      return;
    }
    if (!uploadTitle.trim() || !uploadAuthor.trim() || !uploadEmail.trim() || !uploadBody.trim()) {
      onShowToast('请填写标题、作者、邮箱和小说正文');
      return;
    }
    setIsUploading(true);
    try {
      await submitToInbox('submitNovel', {
        title: uploadTitle.trim(),
        author: uploadAuthor.trim(),
        email: uploadEmail.trim(),
        authorUrl: uploadAuthorUrl.trim(),
        body: uploadBody.trim(),
        notes: uploadNotes.trim(),
      });
      setShowUpload(false);
      setUploadTitle('');
      setUploadAuthor('');
      setUploadEmail('');
      setUploadAuthorUrl('');
      setUploadBody('');
      setUploadNotes('');
      setUploadFileName('');
      onShowToast('小说已提交，审核通过后会进入在线粮仓 📚');
    } catch (error) {
      onShowToast(error instanceof Error ? error.message : '小说提交失败，请稍后重试');
    } finally {
      setIsUploading(false);
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
        ? 'bg-[#1E4334] text-white border-[#1E4334] font-bold shadow-xs'
        : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5]'
    }`;

  const tagChipCls =
    'text-[9px] font-retro-jp px-1.5 py-0.2 rounded-xs border bg-[#F4EEDF] text-[#7A6958] border-[#DECFA9]';

  return (
    <div className="space-y-3">
      {/* 模块筛选条：段切换 + 题材（无粗糙边框，半透明毛玻璃） */}
      <div className="bg-[#FFFEEF]/80 backdrop-blur-md rounded-xl p-2.5 space-y-2 relative overflow-hidden shadow-2xs">
        <CardPatternOverlay opacity={0.12} mode="multiply" />
        <div className="relative z-10 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-retro-jp">
          <span className="text-[10px] font-pixel text-[#8C7A68] mr-1">段:</span>
          {['全部', '在线小说', '站外推荐'].map((s) => (
            <button
              key={s}
              onClick={() => {
                soundManager.playFilterClick();
                setSeg(s);
              }}
              onMouseEnter={() => soundManager.playCardHover()}
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
                soundManager.playFilterClick();
                setGenre(g);
              }}
              onMouseEnter={() => soundManager.playCardHover()}
              className={chipCls(genre === g)}
            >
              {g}
            </button>
          ))}
        </div>
        </div>
      </div>

      {/* 第一段：在线小说与接龙合订本（2列瀑布流） */}
      {showNovels && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 bg-[#1E4334]/90 backdrop-blur-md border border-[#1E4334]/70 rounded-lg px-3 py-1.5 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-[#F9E79F] animate-pulse" />
              <h3 className="font-pixel text-xs font-bold text-white tracking-wide">
                在线小说 & 合订本 · 共 {filteredNovels.length} 篇
              </h3>
            </div>
          </div>
          {filteredNovels.length === 0 ? (
            <div className="p-6 text-center bg-[#FFFEEF]/75 backdrop-blur-xs border border-dashed border-[#D5C9AF] rounded-xl text-xs font-retro-jp text-[#8C7A68]">
              还没有在线小说，敬请期待～
            </div>
          ) : (
            <div className="columns-2 gap-3.5 sm:gap-4.5 w-full">
              {filteredNovels.map((novel) => {
                const isRelay = Boolean(novel.isRelayCompiled);
                return (
                  <div
                    key={novel.id}
                    onClick={() => {
                      soundManager.playCardClick();
                      soundManager.playPageTurn();
                      setReading(novel);
                      onShowToast(`正在打开《${novel.title}》📖`);
                    }}
                    onMouseEnter={() => soundManager.playCardHover()}
                    className="mb-3.5 sm:mb-4.5 break-inside-avoid relative overflow-hidden bg-[#FFFEEF]/85 backdrop-blur-md border border-[#D5C9AF]/70 hover:border-[#8C6B38] rounded-xl p-3.5 sm:p-4 flex flex-col justify-between transition-all hover:shadow-lg hover:bg-[#FFFEEF]/95 group select-none cursor-pointer space-y-3 w-full"
                    title={isRelay ? "点击在线阅读接龙合订本" : "点击在线阅读小说"}
                  >
                    <CardPatternOverlay opacity={0.10} mode="multiply" />
                    <div className="relative z-10 flex flex-col flex-1 justify-between space-y-3">
                      {/* 顶部标题与分类徽章 */}
                      <div className="flex items-start justify-between gap-1.5 pb-2 border-b border-dashed border-[#E0D5BE]">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`font-pixel text-[10px] sm:text-xs px-2.5 py-0.5 rounded-full font-bold whitespace-nowrap shadow-2xs ${
                                isRelay
                                  ? 'bg-[#B45309] text-white'
                                  : 'bg-[#1E4334] text-white'
                              }`}
                            >
                              {isRelay ? '故事接龙合订本' : '在线小说'}
                            </span>
                            <span className="text-xs font-retro-jp text-[#8C7A68] whitespace-nowrap">
                              {fmtChars(novel.chars || 0)}字
                            </span>
                          </div>
                          <h3 className="font-pixel text-base sm:text-lg font-bold text-[#2C2016] group-hover:text-[#B7791F] mt-1.5 break-words leading-snug transition-colors">
                            {novel.title}
                          </h3>
                        </div>
                      </div>

                      {/* 关键信息区：执笔 */}
                      <div className="bg-[#FAF5E8]/60 backdrop-blur-xs border border-[#EBE3D0]/70 rounded-lg p-3 my-auto space-y-2.5 text-xs sm:text-[13px] font-retro-jp">
                        {/* 执笔 */}
                        <div className="space-y-1">
                          <div className="font-bold text-[#8C6B38] text-[11px] sm:text-xs">
                            ✍️ 执笔：
                          </div>
                          <div className="font-bold text-[#3E342B] break-words pl-1">
                            {isRelay && novel.relayAuthors && novel.relayAuthors.length > 1
                              ? `${novel.author} (${novel.relayAuthors.length}位调查兵接力)`
                              : (
                                <AuthorWithLink
                                  author={novel.author}
                                  customUrl={novel.authorUrl}
                                  defaultColorClass="text-[#3E342B]"
                                  orangeColorClass="text-[#D35400]"
                                />
                              )}
                          </div>
                        </div>

                        {/* 如果有自定义起笔设定（非通用背景），清晰列出 */}
                        {novel.prompt && !novel.prompt.includes('突发暴雨') && (
                          <>
                            <div className="h-px bg-[#E0D5BE]/60" />
                            <div className="space-y-1">
                              <div className="font-bold text-[#8C5D23] text-[11px] sm:text-xs">
                                ✍️ 起笔设定：
                              </div>
                              <div className="text-[#5B4636] leading-relaxed break-words text-xs pl-1">
                                {novel.prompt}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 第二段：站外推荐（2列瀑布流） */}
      {showRecs && recs.length > 0 && (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 bg-[#1E4334]/90 backdrop-blur-md border border-[#1E4334]/70 rounded-lg px-3 py-1.5 shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-[#F9E79F] animate-pulse" />
            <h3 className="font-pixel text-xs font-bold text-white tracking-wide">
              站外推荐 · 共 {filteredRecs.length} 篇
            </h3>
          </div>
          {filteredRecs.length === 0 ? (
            <div className="p-6 text-center bg-[#FFFEEF] border border-dashed border-[#D5C9AF] rounded-md text-xs font-retro-jp text-[#8C7A68]">
              没有符合筛选的推荐，可以换个题材试试～
            </div>
          ) : (
            <div className="columns-2 gap-3 sm:gap-4 w-full">
              {filteredRecs.map((rec) => {
                const reason = reasonText(rec);
                const site = siteName(rec.url);
                return (
                  <div
                    key={rec.id}
                    className="mb-3 sm:mb-4 break-inside-avoid group cursor-pointer select-none"
                    title="点击选择打开方式"
                    onMouseEnter={() => soundManager.playCardHover()}
                    onClick={() => {
                      soundManager.playCardClick();
                      openRecModal(rec);
                    }}
                  >
                    <div className="relative overflow-hidden bg-[#FFFEEF]/85 backdrop-blur-md border border-[#D5C9AF]/70 hover:border-[#8C6B38] hover:shadow-lg rounded-xl p-3 sm:p-3.5 space-y-2 transition-all">
                      <CardPatternOverlay opacity={0.10} mode="multiply" />
                      <div className="relative z-10 space-y-2">
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

                      <h4 className="font-pixel text-xs sm:text-[13px] font-bold text-[#2C2016] group-hover:text-[#B7791F] break-words leading-snug transition-colors line-clamp-2">
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
            className="relative overflow-hidden bg-[#FFFEEF] border-2 border-[#1E4334] rounded-lg w-full max-w-md p-4 space-y-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <CardPatternOverlay opacity={0.12} mode="multiply" />
            <div className="relative z-10 space-y-3">
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
                    ? 'bg-[#1E4334] text-white hover:bg-[#2B5E4A] cursor-pointer shadow-xs font-bold'
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
        </div>
      )}

      {/* 在线阅读器 */}
      {reading && <NovelReader novel={reading} onClose={() => setReading(null)} />}

      {showUpload && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/65 flex items-center justify-center p-3" onMouseDown={(e) => e.target === e.currentTarget && setShowUpload(false)}>
          <form onSubmit={handleNovelSubmit} className="relative overflow-hidden w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-[#FFFEEF] border-2 border-[#1E4334] rounded-lg p-4 sm:p-5 space-y-3 font-retro-jp text-[#2C241D] shadow-2xl">
            <CardPatternOverlay opacity={0.12} mode="multiply" />
            <div className="relative flex items-center justify-between gap-3 border-b border-[#D5C9AF] pb-2">
              <div>
                <h3 className="font-pixel text-sm font-bold text-[#1E4334]">上传小说 / 推荐</h3>
                <p className="text-[10px] text-[#7A6958] mt-1">投稿将进入待审收件箱，通过后公开展示。</p>
              </div>
              <button type="button" onClick={() => setShowUpload(false)} className="text-lg text-[#5B4636] cursor-pointer" aria-label="关闭上传窗口">×</button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setUploadKind('novel')} className={`py-2 border font-bold text-xs ${uploadKind === 'novel' ? 'bg-[#1E4334] text-[#F9E79F]' : 'bg-white text-[#5B4636]'}`}>上传小说</button>
              <button type="button" onClick={() => setUploadKind('recommend')} className={`py-2 border font-bold text-xs ${uploadKind === 'recommend' ? 'bg-[#1E4334] text-[#F9E79F]' : 'bg-white text-[#5B4636]'}`}>推荐外链</button>
            </div>

            {uploadKind === 'novel' ? <><div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs font-bold">标题<input value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} maxLength={80} required className="mt-1 w-full p-2 bg-white border border-[#BFA985] outline-none focus:border-[#1E4334]" /></label>
              <label className="text-xs font-bold">作者<input value={uploadAuthor} onChange={(e) => setUploadAuthor(e.target.value)} maxLength={40} required className="mt-1 w-full p-2 bg-white border border-[#BFA985] outline-none focus:border-[#1E4334]" /></label>
              <label className="text-xs font-bold">联系邮箱<input type="email" value={uploadEmail} onChange={(e) => setUploadEmail(e.target.value)} required className="mt-1 w-full p-2 bg-white border border-[#BFA985] outline-none focus:border-[#1E4334]" /></label>
              <label className="text-xs font-bold">作者主页（选填）<input type="url" value={uploadAuthorUrl} onChange={(e) => setUploadAuthorUrl(e.target.value)} className="mt-1 w-full p-2 bg-white border border-[#BFA985] outline-none focus:border-[#1E4334]" /></label>
            </div>

            <label className="block p-3 border border-dashed border-[#1E4334] bg-[#F3EAD5] text-center cursor-pointer hover:bg-[#E8E0CB]">
              <span className="block font-bold text-xs">选择 .txt / .md 文件（最大 1MB）</span>
              <span className="block text-[10px] text-[#7A6958] mt-1">{uploadFileName || '也可以直接在下方粘贴正文'}</span>
              <input type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={(e) => void handleNovelFile(e.target.files?.[0])} />
            </label>

            <label className="block text-xs font-bold">小说正文<textarea value={uploadBody} onChange={(e) => setUploadBody(e.target.value)} rows={10} required className="mt-1 w-full p-2 bg-white border border-[#BFA985] outline-none focus:border-[#1E4334] resize-y leading-relaxed" /></label>
            <label className="block text-xs font-bold">给审核员的备注（选填）<textarea value={uploadNotes} onChange={(e) => setUploadNotes(e.target.value)} rows={2} maxLength={2000} className="mt-1 w-full p-2 bg-white border border-[#BFA985] outline-none focus:border-[#1E4334] resize-y" /></label>

            </> : <div className="space-y-2">
              <label className="block text-xs font-bold">作品名称<input value={recTitle} onChange={(e) => setRecTitle(e.target.value)} required className="mt-1 w-full p-2 bg-white border border-[#BFA985]" /></label>
              <label className="block text-xs font-bold">外链<input type="url" value={recLink} onChange={(e) => setRecLink(e.target.value)} required className="mt-1 w-full p-2 bg-white border border-[#BFA985]" /></label>
              <div className="grid grid-cols-2 gap-2"><label className="block text-xs font-bold">推荐人<input value={recAuthor} onChange={(e) => setRecAuthor(e.target.value)} className="mt-1 w-full p-2 bg-white border border-[#BFA985]" /></label><label className="block text-xs font-bold">分类<select value={recCategory} onChange={(e) => setRecCategory(e.target.value)} className="mt-1 w-full p-2 bg-white border border-[#BFA985]"><option>原作向</option><option>现代AU</option><option>短篇</option><option>其他</option></select></label></div>
              <label className="block text-xs font-bold">推荐理由<textarea value={recReason} onChange={(e) => setRecReason(e.target.value)} rows={4} className="mt-1 w-full p-2 bg-white border border-[#BFA985]" /></label>
            </div>}

            <button type="submit" disabled={isUploading} className="w-full py-2.5 bg-[#1E4334] text-[#F9E79F] border border-[#153025] font-pixel text-xs font-bold cursor-pointer disabled:opacity-50">
              {isUploading ? '提交中…' : uploadKind === 'novel' ? '提交小说稿件' : '提交推荐审核'}
            </button>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
};
