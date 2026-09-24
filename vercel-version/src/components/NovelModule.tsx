import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { GroupNovel } from '../types/doujinArchive';
import { soundManager } from '../utils/audio';
import { NovelReader } from './NovelReader';
import { AuthorWithLink } from '../utils/authorLink';
import { newestNovelsFirst } from '../utils/workSort';
import { getAccessToken } from '../utils/cloudbaseToken';
import { useAuthStore } from '../stores/authStore';
import { useAppShellStore } from '../stores/appShellStore';
import { ADMIN_UPLOAD_ENDPOINT, fetchBackend } from '../utils/cloudbaseEndpoint';
import { cosService } from '../services/cosClient';
import { CardPatternOverlay } from './CardPatternOverlay';

/** 懒加载本地 mammoth（仅在选择 .docx 时才拉取 ~636KB 脚本，避免进主包） */
let mammothPromise: Promise<MammothApi> | null = null;
function loadMammoth(): Promise<MammothApi> {
  if (!mammothPromise) {
    mammothPromise = new Promise<MammothApi>((resolve, reject) => {
      const el = document.createElement('script');
      // 前台同源加载（public/vendor/）。不能用 /admin/ 路径：www 域名下 /admin/ 会被 vercel.json 308 到 admin 域名，
      // 跨域 + 路径丢失导致 script 加载失败，前端误报「无法解析该 Word 文档」。
      el.src = `${import.meta.env.BASE_URL}vendor/mammoth.browser.min.js`;
      el.onload = () => {
        const w = window as unknown as { mammoth?: MammothApi };
        if (w.mammoth && typeof w.mammoth.extractRawText === 'function') resolve(w.mammoth);
        else reject(new Error('mammoth 加载失败'));
      };
      el.onerror = () => reject(new Error('mammoth 加载失败'));
      document.head.appendChild(el);
    });
  }
  return mammothPromise;
}

interface MammothApi {
  extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value?: string }>;
}

interface Props {
  searchQuery: string;
  novels: GroupNovel[];
  isLoading?: boolean;
  onShowToast: (msg: string) => void;
  initialReadingNovel?: GroupNovel | null;
}

/** 段切换的三个取值；「同好来稿」= 同好上传的在线小说（非接龙合订本） */
type NovelSeg = '全部' | '合订本' | '同好来稿';
const SEGS: NovelSeg[] = ['全部', '合订本', '同好来稿'];

/** 字数缩写：12345 → 1.2万；8600 → 8.6千 */
const fmtChars = (n: number): string => {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + ' 千';
  return String(n);
};

/**
 * 小说本模块：段切换（全部 / 合订本 / 同好来稿）+ 竖版卡片瀑布流。
 * 站外推荐已迁至「兵长茶会 → 安利墙」，本模块只保留站内可读的正文小说。
 */
export const NovelModule: React.FC<Props> = ({
  searchQuery,
  novels,
  isLoading = false,
  onShowToast,
  initialReadingNovel,
}) => {
  const [seg, setSeg] = useState<NovelSeg>('全部');
  const [reading, setReading] = useState<GroupNovel | null>(initialReadingNovel || null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadAuthor, setUploadAuthor] = useState('');
  const [uploadAuthorUrl, setUploadAuthorUrl] = useState('');
  const [uploadBody, setUploadBody] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadWarnOn, setUploadWarnOn] = useState(false);
  const [uploadWarning, setUploadWarning] = useState('');
  const [uploadSensitive, setUploadSensitive] = useState(false);
  const [uploadFileName, setUploadFileName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  /* 编辑态：null = 新投稿；非空 = 正在改写这一篇（表单预填、提交走 novelUpdate） */
  const [editingNovel, setEditingNovel] = useState<GroupNovel | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  /* 当前登录者 uid：卡片上「编辑」按钮只对 uid 匹配的那几篇显示 */
  const profile = useAuthStore((state) => state.profile);
  const myUid = profile?.uid || null;

  useEffect(() => {
    if (initialReadingNovel) {
      setReading(initialReadingNovel);
    }
  }, [initialReadingNovel]);

  // 上传弹窗打开时：作者名默认填当前登录昵称（可直接改成笔名）
  useEffect(() => {
    if (showUpload && profile?.nickname) {
      setUploadAuthor((current) => current || profile.nickname);
    }
  }, [showUpload, profile?.nickname]);

  const q = searchQuery.trim().toLowerCase();

  const filteredNovels = useMemo(
    () =>
      newestNovelsFirst(novels.filter((n) => {
        const isRelay = Boolean(n.isRelayCompiled);
        const matchSeg =
          seg === '全部' || (seg === '合订本' ? isRelay : !isRelay);
        const matchSearch =
          !q ||
          n.title.toLowerCase().includes(q) ||
          n.author.toLowerCase().includes(q) ||
          (n.authorNote && n.authorNote.toLowerCase().includes(q)) ||
          (n.tags || []).some((t) => t.toLowerCase().includes(q));
        return matchSeg && matchSearch;
      })),
    [novels, seg, q]
  );

  /** 区块标题随段变化；空段也给准确名字，避免「共 0 篇」时看不出缺的是哪一类 */
  const sectionTitle =
    seg === '合订本'
      ? '故事接龙合订本'
      : seg === '同好来稿'
        ? '同好来稿'
        : '合订本 & 同好来稿';

  const emptyText =
    seg === '合订本'
      ? '还没有接龙合订本，去兵长茶会开一棒试试～'
      : seg === '同好来稿'
        ? '还没有同好投稿，欢迎点右上角上传～'
        : '还没有在线小说，敬请期待～';

  const handleNovelFile = async (file?: File) => {
    if (!file) return;
    const isDocx = /\.docx$/i.test(file.name);
    const isText = /\.(txt|md)$/i.test(file.name);
    if (!isText && !isDocx) {
      onShowToast('目前仅支持 UTF-8 的 .txt / .md，或 Word 的 .docx 文件');
      return;
    }
    const sizeCap = isDocx ? 10 * 1024 * 1024 : 1024 * 1024; // docx 允许到 10MB（含内嵌图）
    if (file.size > sizeCap) {
      onShowToast(isDocx ? 'Word 文件不能超过 10MB' : '小说文件不能超过 1MB');
      return;
    }
    try {
      let content = '';
      if (isDocx) {
        // 本地 mammoth 把 docx 转纯文本，图片不落地、只取正文文字
        const arrayBuffer = await file.arrayBuffer();
        const mammoth = await loadMammoth();
        const result = await mammoth.extractRawText({ arrayBuffer });
        content = result.value || '';
        if (!content.trim()) {
          onShowToast('该 Word 文档没有可提取的正文文字');
          return;
        }
      } else {
        content = await file.text();
      }
      setUploadBody(content);
      setUploadFileName(file.name);
      if (!uploadTitle) setUploadTitle(file.name.replace(/\.(txt|md|docx)$/i, ''));
      onShowToast(`已读取《${file.name}》`);
    } catch {
      onShowToast(isDocx ? '无法解析该 Word 文档，请另存为 .txt 或直接粘贴正文' : '无法读取文件，请确认它是 UTF-8 文本');
    }
  };

  /** 拉取正文原文供编辑回填：普通篇直链明文；加密篇经登录鉴权由服务端解密（密钥不下发前端） */
  const fetchNovelBodyForEdit = async (novel: GroupNovel): Promise<string> => {
    if (novel.bodyContent) return novel.bodyContent;
    if (novel.encrypted) {
      const token = await getAccessToken();
      if (!token) throw new Error('请先登录账号后再编辑');
      const resp = await fetchBackend(ADMIN_UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'novelBody', id: novel.id }),
      });
      const result = await resp.json().catch(() => null) as { ok?: boolean; body?: string; error?: string } | null;
      if (!resp.ok || !result?.ok || typeof result.body !== 'string') {
        throw new Error(result?.error || '正文加载失败，无法编辑');
      }
      return result.body;
    }
    const resp = await fetch(cosService.getNovelBodyUrl(novel.id), { cache: 'default' });
    if (!resp.ok) throw new Error(`正文加载失败（HTTP ${resp.status}）`);
    return resp.text();
  };

  /** 点「编辑」：把这篇的所有字段（含正文）回填进上传表单，提交时走 novelUpdate */
  const handleEditNovel = async (novel: GroupNovel) => {
    if (editLoading) return;
    soundManager.playWoodTap();
    setEditLoading(true);
    try {
      const body = await fetchNovelBodyForEdit(novel);
      setEditingNovel(novel);
      setUploadTitle(novel.title || '');
      setUploadAuthor(novel.author || '');
      setUploadAuthorUrl(novel.authorUrl || '');
      setUploadTags((novel.tags || []).join(','));
      setUploadWarnOn(Boolean(novel.warning));
      setUploadWarning(novel.warning || '');
      setUploadSensitive(Boolean(novel.encrypted));
      setUploadNotes(novel.authorNote || '');
      setUploadBody(body);
      setUploadFileName('');
      setShowUpload(true);
    } catch (error) {
      onShowToast(error instanceof Error ? error.message : '正文读取失败，请稍后重试');
    } finally {
      setEditLoading(false);
    }
  };

  /** 关闭/提交完成后清掉编辑态，否则下一次打开上传窗会残留上一篇的预填值 */
  const leaveEditMode = () => {
    setEditingNovel(null);
    setUploadTitle('');
    setUploadAuthor('');
    setUploadAuthorUrl('');
    setUploadBody('');
    setUploadNotes('');
    setUploadTags('');
    setUploadWarnOn(false);
    setUploadWarning('');
    setUploadSensitive(false);
    setUploadFileName('');
  };

  const handleNovelSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!uploadTitle.trim() || !uploadAuthor.trim() || !uploadBody.trim()) {
      onShowToast('请填写标题、作者和正文');
      return;
    }
    if (uploadWarnOn && !uploadWarning.trim()) {
      onShowToast('已勾选内容预警，请填写预警内容');
      return;
    }
    // 免审直发：必须登录，正文提交后立即上架（novelDirectPublish）
    // 普通篇明文上架，敏感篇加密入 vault —— 由「含敏感元素」勾选决定
    const token = await getAccessToken();
    if (!token) {
      onShowToast('请先登录账号再投稿');
      useAppShellStore.getState().openLogin();
      return;
    }
    setIsUploading(true);
    try {
      const response = await fetchBackend(ADMIN_UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: editingNovel ? 'novelUpdate' : 'novelDirectPublish',
          id: editingNovel?.id,
          sensitive: uploadSensitive,
          title: uploadTitle.trim(),
          author: uploadAuthor.trim(),
          authorUrl: uploadAuthorUrl.trim(),
          body: uploadBody.trim(),
          authorNote: uploadNotes.trim(),
          tags: uploadTags.trim(),
          warning: uploadWarnOn ? uploadWarning.trim() : '',
        }),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || '发布失败，请稍后重试');
      setShowUpload(false);
      leaveEditMode();
      useAppShellStore.getState().invalidateNovelIndex();
      onShowToast(
        editingNovel
          ? `已更新《${uploadTitle.trim().slice(0, 18)}》✏️`
          : uploadSensitive
            ? '已加密上架，感谢投稿 📚'
            : '已上架，感谢投稿 📚'
      );
    } catch (error) {
      onShowToast(error instanceof Error ? error.message : '投稿失败，请稍后重试');
    } finally {
      setIsUploading(false);
    }
  };

  const segCls = (active: boolean) =>
    `px-2 py-0.5 rounded-xs border transition-all cursor-pointer text-[11px] font-retro-jp ${
      active
        ? 'bg-[#1E4334] text-white border-[#1E4334] font-bold shadow-xs'
        : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5]'
    }`;

  return (
    <div className="space-y-3">
      {/* 模块筛选条：段切换（无粗糙边框，半透明毛玻璃） */}
      <div className="bg-[#FFFEEF]/80 backdrop-blur-md rounded-xl p-2.5 space-y-2 relative overflow-hidden shadow-2xs">
        <CardPatternOverlay opacity={0.12} mode="multiply" />
        <div className="relative z-10 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-retro-jp">
          <span className="text-[10px] font-pixel text-[#8C7A68] mr-1">分类:</span>
          {SEGS.map((s) => (
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
          <span className="text-[10px] font-retro-jp text-[#A89098] ml-auto">
            站外安利请去 兵长茶会 → 安利墙
          </span>
        </div>
        </div>
      </div>

      {/* 站内正文小说（合订本 / 同好来稿）瀑布流 */}
      <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 bg-[#1E4334]/90 backdrop-blur-md border border-[#1E4334]/70 rounded-lg px-3 py-1.5 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-[#F9E79F] animate-pulse" />
              <h3 className="font-pixel text-xs font-bold text-white tracking-wide">
                {sectionTitle} · 共 {filteredNovels.length} 篇
              </h3>
            </div>
            {/* 上传入口：与后台「小说管理」同款格式投稿 */}
            <button
              type="button"
              onClick={() => { soundManager.playWoodTap(); setShowUpload(true); }}
              className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#B7791F] border border-[#9A6519] text-[#FFFEEF] font-pixel text-[11px] font-bold cursor-pointer transition-colors hover:bg-[#9A6519]"
            >
              ✍️ 上传文
            </button>
          </div>
          {isLoading && filteredNovels.length === 0 ? (
            <div className="columns-2 gap-3.5 sm:gap-4.5 w-full animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="mb-3.5 sm:mb-4.5 break-inside-avoid bg-[#FFFEEF]/70 border border-[#D5C9AF]/60 rounded-xl p-3.5 sm:p-4 space-y-2.5"
                >
                  <div className="flex gap-1.5 items-center">
                    <div className="h-4 w-12 bg-[#D5C9AF]/40 rounded-xs" />
                    <div className="h-4 w-10 bg-[#D5C9AF]/30 rounded-xs" />
                  </div>
                  <div className="h-5 w-4/5 bg-[#D5C9AF]/50 rounded-xs" />
                  <div className="h-3 w-1/2 bg-[#D5C9AF]/30 rounded-xs" />
                  <div className="h-10 w-full bg-[#D5C9AF]/20 rounded-xs" />
                </div>
              ))}
            </div>
          ) : filteredNovels.length === 0 ? (
            <div className="p-6 text-center bg-[#FFFEEF]/75 backdrop-blur-xs border border-dashed border-[#D5C9AF] rounded-xl text-xs font-retro-jp text-[#8C7A68]">
              {emptyText}
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
                    title={isRelay ? '点击在线阅读接龙合订本' : '点击在线阅读小说'}
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
                              {isRelay ? '故事接龙合订本' : '同好来稿'}
                            </span>
                            <span className="text-xs font-retro-jp text-[#8C7A68] whitespace-nowrap">
                              {fmtChars(novel.chars || 0)}字
                            </span>
                            {novel.uid && novel.uid === myUid && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleEditNovel(novel);
                                }}
                                className="ml-auto px-2 py-0.5 rounded-xs border border-[#D5C9AF] bg-[#FAF5E8] text-[10px] font-retro-jp text-[#5B4636] hover:bg-[#1E4334] hover:text-[#F9E79F] hover:border-[#1E4334] cursor-pointer transition-colors shrink-0"
                                title="编辑这篇小说（含正文）"
                              >
                                ✏️ 编辑
                              </button>
                            )}
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

                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      {/* 在线阅读器 */}
      {reading && <NovelReader novel={reading} onClose={() => setReading(null)} />}

      {showUpload && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/65 flex items-center justify-center p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) { setShowUpload(false); leaveEditMode(); } }}>
          <form onSubmit={handleNovelSubmit} className="relative overflow-hidden w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-[#FFFEEF] border-2 border-[#1E4334] rounded-lg p-4 sm:p-5 space-y-3 font-retro-jp text-[#2C241D] shadow-2xl">
            <CardPatternOverlay opacity={0.12} mode="multiply" />
            <div className="relative flex items-center justify-between gap-3 border-b border-[#D5C9AF] pb-2">
              <div>
                <h3 className="font-pixel text-sm font-bold text-[#1E4334]">
                  {editingNovel ? '✏️ 编辑小说' : '上传文'}
                </h3>
                <p className="text-[10px] text-[#7A6958] mt-1">
                  {editingNovel
                    ? `正在修改《${editingNovel.title}》，保存后立即生效。`
                    : '登录后投稿立即上架（默认普通、勾选敏感才加密）。想安利站外作品（B站 / LOFTER / AO3 等）请去「兵长茶会 → 安利墙」。'}
                </p>
              </div>
              <button type="button" onClick={() => { setShowUpload(false); leaveEditMode(); }} className="text-lg text-[#5B4636] cursor-pointer" aria-label="关闭上传窗口">×</button>
            </div>

            {editingNovel && (
              <div className="px-2.5 py-1.5 rounded-xs bg-[#FAF5E8] border border-[#E0D5BE] text-[10px] text-[#7A6958]">
                编辑模式：正文与各字段已回填，改完直接点底部「保存修改」。
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs font-bold">标题<input value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} maxLength={80} required className="mt-1 w-full p-2 bg-white border border-[#BFA985] outline-none focus:border-[#1E4334]" /></label>
              <label className="text-xs font-bold">作者<input value={uploadAuthor} onChange={(e) => setUploadAuthor(e.target.value)} maxLength={40} required className="mt-1 w-full p-2 bg-white border border-[#BFA985] outline-none focus:border-[#1E4334]" /></label>
              <label className="text-xs font-bold">作者主页（选填）<input type="url" value={uploadAuthorUrl} onChange={(e) => setUploadAuthorUrl(e.target.value)} className="mt-1 w-full p-2 bg-white border border-[#BFA985] outline-none focus:border-[#1E4334]" /></label>
            </div>

            <label className="block p-3 border border-dashed border-[#1E4334] bg-[#F3EAD5] text-center cursor-pointer hover:bg-[#E8E0CB]">
              <span className="block font-bold text-xs">选择 .txt / .md / .docx 文件（文本 ≤1MB，Word ≤10MB）</span>
              <span className="block text-[10px] text-[#7A6958] mt-1">{uploadFileName || '也可以直接在下方粘贴正文'}</span>
              <input type="file" accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => void handleNovelFile(e.target.files?.[0])} />
            </label>

            <label className="block text-xs font-bold">标签 <span className="font-normal text-[#7A6958]">英文逗号分隔，如：原作向,R</span><input value={uploadTags} onChange={(e) => setUploadTags(e.target.value)} maxLength={120} placeholder="例如：原作向,R" className="mt-1 w-full p-2 bg-white border border-[#BFA985] outline-none focus:border-[#1E4334]" /></label>

            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                <input type="checkbox" checked={uploadWarnOn} onChange={(e) => setUploadWarnOn(e.target.checked)} className="w-auto accent-[#1E4334]" />
                ⚠ 内容预警 <span className="font-normal text-[#7A6958]">勾选后填写，站点卡片会显示</span>
              </label>
              {uploadWarnOn && (
                <textarea value={uploadWarning} onChange={(e) => setUploadWarning(e.target.value)} rows={2} maxLength={100} className="w-full p-2 bg-white border border-[#BFA985] outline-none focus:border-[#1E4334] resize-y" />
              )}
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                <input type="checkbox" checked={uploadSensitive} onChange={(e) => setUploadSensitive(e.target.checked)} className="w-auto accent-[#1E4334]" />
                🔒 含敏感元素 <span className="font-normal text-[#7A6958]">勾选后正文加密入密库，前端仅存密文</span>
              </label>
            </div>

            <label className="block text-xs font-bold">小说正文<textarea value={uploadBody} onChange={(e) => setUploadBody(e.target.value)} rows={10} required className="mt-1 w-full p-2 bg-white border border-[#BFA985] outline-none focus:border-[#1E4334] resize-y leading-relaxed" /></label>
            <label className="block text-xs font-bold">作者说的话（选填）<span className="font-normal text-[#7A6958]">审核通过后以引用块展示在卡片上</span><textarea value={uploadNotes} onChange={(e) => setUploadNotes(e.target.value)} rows={2} maxLength={2000} className="mt-1 w-full p-2 bg-white border border-[#BFA985] outline-none focus:border-[#1E4334] resize-y" /></label>

            <button type="submit" disabled={isUploading} className="w-full py-2.5 bg-[#1E4334] text-[#F9E79F] border border-[#153025] font-pixel text-xs font-bold cursor-pointer disabled:opacity-50">
              {isUploading
                ? (editingNovel ? '保存中…' : uploadSensitive ? '加密上传中…' : '上传中…')
                : editingNovel
                  ? '💾 保存修改'
                  : (uploadSensitive ? '🔒 加密上架' : '📖 普通上架')}
            </button>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
};
