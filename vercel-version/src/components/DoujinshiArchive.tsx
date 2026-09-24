import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  DOUJIN_ARCHIVE_DATA,
} from '../data/doujinArchiveData';
import { DoujinBookItem, GroupNovel } from '../types/doujinArchive';
import { soundManager } from '../utils/audio';
import { cosService } from '../services/cosClient';
import { NovelModule } from './NovelModule';
import LazyComicPage from './LazyComicPage';
// SecureComicReader 静态引入会把 pdfjs-dist + crypto-js（合计约 570 KB）拖进主包：
// 每个访客都白下载一遍，还会顶破 Workbox 的 2 MiB 预缓存上限导致构建失败。
// 它只在打开「含有敏感元素」的漫画本时才用得到，所以按需加载。
//
// 构建时切除：宣发主站（VITE_COMIC_ENABLED=false）不含漫画本，也就用不到加密阅读器，
// 这里把 lazy import 换成 null，让 rollup 物理上不把 pdfjs-dist / crypto-js 打进主站产物。
const SecureComicReader = import.meta.env.VITE_COMIC_ENABLED === 'false'
  ? null
  : React.lazy(() => import('./SecureComicReader'));
import { AuthorWithLink } from '../utils/authorLink';
import { MangaCommentSection } from './MangaCommentSection';
import { getCommentCountByBookId } from '../data/mangaComments';
import { useAppShellStore } from '../stores/appShellStore';

interface Props {
  onCopyCode?: (code: string) => void;
  onShowToast: (msg: string) => void;
  onGoToResources?: () => void;
  /**
   * 站点模式：
   * - 'main'（默认）：宣发主站，只显示「小说本（合订本）+ 插画集」，不显示漫画本；
   * - 'comic'：私有漫画站，只显示「漫画本」，不显示小说本/插画集。
   * 二者共用同一份组件与数据，但按模式过滤分类，保证主站零漫画、漫画站零合订本。
   */
  mode?: 'main' | 'comic';
}

export const DoujinshiArchive: React.FC<Props> = ({ onShowToast, onGoToResources, mode = 'main' }) => {
  // 归档数据状态（优先加载远端 COS archive.json，兜底使用本地 Excel 录入数据）
  const [books, setBooks] = useState<DoujinBookItem[]>(DOUJIN_ARCHIVE_DATA);
  const [isLoadingArchive, setIsLoadingArchive] = useState<boolean>(false);
  const [, setCommentVersion] = useState<number>(0);

  // 搜索与多维筛选
  const [searchQuery, setSearchQuery] = useState<string>('');
  // 站点模式决定「漫画本」是否可见：
  // - comic 模式（私有漫画站）：恒可见，且不再依赖主站登录态；
  // - main 模式（宣发主站）：恒不可见（漫画本已迁走）。
  const isMangaVisible = mode === 'comic';
  const [selectedCategory, setSelectedCategory] = useState<string>(() =>
    isMangaVisible ? '漫画本' : '小说本'
  );
  const [selectedTag, setSelectedTag] = useState<string>('全部');
  const [selectedAuthor, setSelectedAuthor] = useState<string>('全部');
  // 排序方式：'pages' = 从页数多到页数少（默认），'new' = 从新到旧
  const [sortBy, setSortBy] = useState<'pages' | 'new'>('pages');
  const wasMangaVisible = useRef(isMangaVisible);

  // 当前正在无缝长图阅读的书籍
  const [readingBook, setReadingBook] = useState<DoujinBookItem | null>(null);
  // 加密归档本子：走独立的伪装阅读器，普通长图画廊状态完全不受影响
  const [secureBook, setSecureBook] = useState<DoujinBookItem | null>(null);

  // 动态探测与检测到的内页总数
  const [detectedPages, setDetectedPages] = useState<number | null>(null);
  const [isDetectingPages, setIsDetectingPages] = useState<boolean>(false);

  // 封面加载失败状态
  const [failedCovers, setFailedCovers] = useState<Set<string>>(new Set());

  // 在线小说索引（novels.json，含合订本与同好来稿）；读不到则为空 → 该段不渲染
  const [novels, setNovels] = useState<GroupNovel[]>([]);
  const [requestedNovel, setRequestedNovel] = useState<GroupNovel | null>(null);

  // 统计所有标签（动态汇总当前数据中的所有标签）
  const allCategories = isMangaVisible ? ['漫画本'] : ['小说本', '插画集'];
  const categoryBooks = books.filter((book) => (book.category || '漫画本') === selectedCategory);
  const dynamicTags = Array.from(new Set(categoryBooks.flatMap((b) => b.tags || [])));
  const allTags = ['全部', ...dynamicTags];

  // 统计所有作者（动态汇总当前分类下的 circle，去重并按作品数降序）
  const dynamicAuthors = Array.from(
    categoryBooks
      .reduce((acc, b) => {
        const name = (b.circle || '未知').trim();
        acc.set(name, (acc.get(name) || 0) + 1);
        return acc;
      }, new Map<string, number>())
      .entries()
  )
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
  const allAuthors = ['全部', ...dynamicAuthors];

  useEffect(() => {
    if (isMangaVisible && !wasMangaVisible.current) {
      setSelectedCategory('漫画本');
    } else if (!isMangaVisible) {
      if (selectedCategory === '漫画本') setSelectedCategory('小说本');
      setReadingBook((book) => (book?.category || '漫画本') === '漫画本' ? null : book);
      setSecureBook((book) => (book?.category || '漫画本') === '漫画本' ? null : book);
    }
    wasMangaVisible.current = isMangaVisible;
  }, [isMangaVisible, selectedCategory]);

  // 组件挂载时自动尝试同步 COS 远端归档（在线小说索引并行加载，失败静默降级）
  useEffect(() => {
    handleRefreshArchive(false);
    cosService.loadNovelList().then(setNovels).catch(() => {});
  }, []);

  // 投稿免审直发：小说本新上架后立即刷新索引（novels.json 为 no-cache，重拉即最新）
  const novelIndexVersion = useAppShellStore((state) => state.novelIndexVersion);
  useEffect(() => {
    if (novelIndexVersion === 0) return;
    cosService.loadNovelList().then(setNovels).catch(() => {});
    // 只关注版本信号的跳变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelIndexVersion]);

  // 首页「今日上新」点小说本 → 切到「小说本」分类（由 appShellStore 信号触发）
  const pendingNovelCategory = useAppShellStore((state) => state.pendingNovelCategory);
  const pendingNovelId = useAppShellStore((state) => state.pendingNovelId);
  useEffect(() => {
    if (pendingNovelCategory === 0) return;
    setSelectedCategory('小说本');
    setSelectedTag('全部');
    setSelectedAuthor('全部');
    // 只关注意图信号的跳变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNovelCategory]);

  // 故事接龙的「查看合订本」携带稳定 ID：强制拉取最新索引并直接打开对应阅读器。
  useEffect(() => {
    if (!pendingNovelId) return;
    let cancelled = false;
    setRequestedNovel(null);
    setSelectedCategory('小说本');
    setSelectedTag('全部');
    setSelectedAuthor('全部');
    void cosService.loadNovelList().then((latest) => {
      if (cancelled) return;
      setNovels(latest);
      const target = latest.find((novel) => novel.id === pendingNovelId) || null;
      setRequestedNovel(target);
      if (!target) onShowToast('合订本正在同步，请稍后再试');
      useAppShellStore.getState().clearPendingNovel();
    }).catch(() => {
      if (!cancelled) onShowToast('合订本索引加载失败，请稍后重试');
      useAppShellStore.getState().clearPendingNovel();
    });
    return () => { cancelled = true; };
  }, [pendingNovelId, onShowToast]);

  // 刷新归档数据 (尝试从 COS 获取 archive.json)
  const handleRefreshArchive = async (showToastNotice = true) => {
    setIsLoadingArchive(true);
    try {
      const loaded = await cosService.loadArchiveData();
      if (loaded && loaded.length > 0) {
        setBooks(loaded);
        if (showToastNotice) {
          onShowToast(`已同步 COS 存储桶归档数据，共 ${loaded.length} 部作品 📦`);
        }
      }
    } catch (err) {
      console.warn('Failed to load remote archive:', err);
    } finally {
      setIsLoadingArchive(false);
    }
  };

  // 点击卡片直接进入查看来源于 COS 的无缝长图
  const handleOpenBookReader = async (book: DoujinBookItem) => {
    if ((book.category || '漫画本') === '漫画本' && !isMangaVisible) return;
    soundManager.playPageTurn();

    // 加密归档的本子：正文只有 comic_vault/{id}_secure.txt，没有可读的图片，
    // 所以不进长图画廊，改走 SecureComicReader（维护页 → 校验码 → 内存解密 → Canvas）
    if (book.secure && SecureComicReader) {
      setSecureBook(book);
      onShowToast(`《${book.titleZh}》资源已被安全隔离，需校验码解析 🔒`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setReadingBook(book);
    setDetectedPages(book.pages || 30);
    onShowToast(`正在开启《${book.titleZh}》无缝长图画廊 📖`);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // 只在页数未知时才进行探测
    if (!book.pages || book.pages <= 0) {
      setIsDetectingPages(true);
      try {
        const realPages = await cosService.detectBookPages(book, 40);
        if (realPages && realPages > 0) {
          setDetectedPages(realPages);
        }
      } catch (e) {
        // 维持默认页数
      } finally {
        setIsDetectingPages(false);
      }
    }
  };

  // 退出阅读器
  const handleCloseReader = () => {
    soundManager.playScrollOpen();
    setReadingBook(null);
    setDetectedPages(null);
  };

  // 分享当前阅读的本子：移动端调系统原生分享面板（QQ/微信可直接转发），
  // 桌面端降级为复制「标题 + 链接」。分享的链接永远是站点根路径（链接不变原则），
  // 没进过门的人打开只会看到伪 403，不会暴露任何内容。
  const handleShareBook = async (book: DoujinBookItem) => {
    soundManager.playCoin();
    const url = `${window.location.origin}/`;
    const shareData: ShareData = { title: `《${book.titleZh}》`, url };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        return; // 用户完成或取消系统分享面板，无需 toast
      } catch {
        return; // 用户取消分享不算错误
      }
    }
    const text = `《${book.titleZh}》 ${url}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => onShowToast('已复制标题和链接，去粘贴分享吧 📋'),
        () => onShowToast(`分享链接：${url}`)
      );
    } else {
      onShowToast(`分享链接：${url}`);
    }
  };

  // 过滤同人本列表
  const filteredBooks = books.filter((book) => {
    const matchCat = (book.category || '漫画本') === selectedCategory;
    const matchTag = selectedTag === '全部' || book.tags.includes(selectedTag);
    const matchAuthor =
      selectedAuthor === '全部' || (book.circle || '未知').trim() === selectedAuthor;
    const q = searchQuery.trim().toLowerCase();
    const matchSearch =
      !q ||
      book.titleZh.toLowerCase().includes(q) ||
      (book.titleJp && book.titleJp.toLowerCase().includes(q)) ||
      book.circle.toLowerCase().includes(q) ||
      (book.source && book.source.toLowerCase().includes(q)) ||
      (book.translator && book.translator.toLowerCase().includes(q)) ||
      (book.typesetter && book.typesetter.toLowerCase().includes(q)) ||
      book.tags.some((t) => t.toLowerCase().includes(q));

    return matchCat && matchTag && matchAuthor && matchSearch;
  });

  // 排序：默认「页数多→少」；「从新到旧」按 updatedAt/createdAt 降序；
  // 缺失日期的条目视为最旧（排到末尾）。两种排序都以前者为主、后者（页数/日期）为次级稳定键。
  const sortedBooks = useMemo(() => {
    const getTime = (b: DoujinBookItem) =>
      new Date(b.updatedAt || b.createdAt || 0).getTime() || 0;
    const arr = [...filteredBooks];
    if (sortBy === 'new') {
      arr.sort((a, b) => {
        const diff = getTime(b) - getTime(a);
        return diff !== 0 ? diff : (b.pages || 0) - (a.pages || 0);
      });
    } else {
      arr.sort((a, b) => {
        const diff = (b.pages || 0) - (a.pages || 0);
        return diff !== 0 ? diff : getTime(b) - getTime(a);
      });
    }
    return arr;
  }, [filteredBooks, sortBy]);

  // 处理封面加载失败
  const handleCoverError = (bookId: string) => {
    setFailedCovers((prev) => new Set(prev).add(bookId));
  };

  // ==========================================
  // 🔒 加密归档阅读模式（维护页 → 校验码 → 解密 → Canvas 瀑布流）
  // 放在长图模式之前：敏感本子绝不允许落到任何图片直链渲染路径上
  // ==========================================
  if (secureBook && isMangaVisible && SecureComicReader) {
    return (
      <React.Suspense
        fallback={
          // 冷灰色，和维护页同一套视觉：加载解码器时也不露馅
          <div className="flex flex-col items-center justify-center w-full h-full bg-[#F2F3F5] gap-2">
            <div className="font-mono text-xs text-[#5F6368] tracking-widest">SECURE NODE GATEWAY</div>
            <div className="font-mono text-[11px] text-[#9AA0A6]">正在加载安全解析节点…</div>
          </div>
        }
      >
        <SecureComicReader
          book={secureBook}
          onClose={() => {
            soundManager.playScrollOpen();
            setSecureBook(null);
          }}
          onShowToast={onShowToast}
        />
      </React.Suspense>
    );
  }

  // ==========================================
  // 📖 无缝长图阅读模式 (基于 腾讯云 COS CDN 映射 + react-pinch-zoom-pan)
  // ==========================================
  if (readingBook && ((readingBook.category || '漫画本') !== '漫画本' || isMangaVisible)) {
    const totalPages = detectedPages || readingBook.pages || 30;
    const pagesList = Array.from({ length: totalPages }, (_, i) => i + 1);

    // 长图主体内容：无间隙、块级排列、消除所有图片缝隙
    const renderLongStripContent = () => (
      <div className="w-full max-w-2xl mx-auto bg-[#F6F1E3] rounded-lg overflow-hidden border-2 border-[#1E4334] shadow-xl">
        {pagesList.map((pageNum) => {
          const pageUrl = cosService.getPageUrl(readingBook, pageNum);

          return (
            <div key={pageNum}>
              <LazyComicPage
                pageNumber={pageNum}
                src={pageUrl}
                alt={`${readingBook.titleZh} 第 ${pageNum} 页`}
                className="relative w-full block m-0 p-0 leading-none"
                referrerPolicy="no-referrer"
              />
            </div>
          );
        })}
      </div>
    );

    return (
      <div id="seamless-doujin-reader" className="relative w-full select-text pb-12">
        {/* 顶部快捷导航控制条（不随滚动固定，回到顶部靠全局悬浮向上按钮） */}
        <div className="mb-3 px-3 py-2 bg-[#FAF5E8]/95 border border-[#1E4334] rounded-lg shadow-md backdrop-blur-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={handleCloseReader}
              className="px-2.5 py-1 bg-[#1E4334] text-[#F9E79F] font-pixel text-xs rounded-xs hover:bg-[#2B5E4A] cursor-pointer transition-all flex items-center gap-1 shrink-0 shadow-xs"
            >
              <span>←</span>
              <span>返回列表</span>
            </button>
            <div className="min-w-0">
              <h2 className="font-pixel text-xs sm:text-sm font-bold text-[#1E3A2B] truncate">
                {readingBook.titleZh}
              </h2>
              <p className="text-[10px] font-retro-jp text-[#7A6958] truncate">
                作者：<AuthorWithLink author={readingBook.circle} customUrl={readingBook.authorUrl} defaultColorClass="text-[#7A6958]" orangeColorClass="text-[#D35400]" /> · 共 {totalPages} 页
                {isDetectingPages ? '（动态校准中...）' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => void handleShareBook(readingBook)}
            className="px-2.5 py-1 bg-[#B7791F] text-[#FFFEEF] font-pixel text-xs rounded-xs hover:bg-[#9A6519] cursor-pointer transition-all flex items-center gap-1 shrink-0 shadow-xs"
            title="分享这本（系统分享面板 / 复制链接）"
          >
            <span>↗</span>
            <span>分享</span>
          </button>
        </div>

        {/* 无缝长图展示区 */}
        {renderLongStripContent()}

        {/* 阅读完毕底部操作 */}
        <div className="w-full max-w-2xl mx-auto mt-4 p-4 bg-[#FAF5E8] border border-[#D5C9AF] rounded-md text-center space-y-2 font-retro-jp">
          <p className="text-xs text-[#5B4636] font-bold">已浏览至末尾（共 {totalPages} 页）</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleCloseReader}
              className="px-3.5 py-1.5 bg-[#1E4334] text-[#F9E79F] font-pixel text-xs rounded-xs hover:bg-[#2B5E4A] cursor-pointer shadow-xs"
            >
              返回本子列表 📚
            </button>
          </div>
        </div>

        {/* 读者同好书评区：仅主站渲染。
            评论数据是 localStorage 单机占位（发出去别人看不见），漫画站隐藏以免误导群友。 */}
        {mode === 'main' && (
          <MangaCommentSection
            bookId={readingBook.id}
            bookTitle={readingBook.titleZh}
            onShowToast={onShowToast}
            onCommentCountChange={() => setCommentVersion((v) => v + 1)}
          />
        )}
      </div>
    );
  }

  // ==========================================
  // 📚 典藏本列表主视图 (coverFile 映射为 腾讯云 COS CDN 链接)
  // ==========================================
  return (
    <div id="doujinshi-archive-root" className="space-y-2 text-[#2C241D] select-text">
      {/* 典藏公约红线轻量提示 */}
      <div className="py-1 px-2.5 bg-[#FBF0EE] border-l-3 border-[#C0392B] rounded-r-xs font-retro-jp text-[11px] text-[#1E4334] flex items-center shadow-2xs">
        <div>
          <span className="font-bold">⚠️ 公约：</span>
          本专区由利韩同好自发分享。<b>严禁倒卖商用、严禁转传闲鱼微店</b>，请共同守护创作者的心血。
        </div>
      </div>

      {/* 筛选与搜索栏 */}
      <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-sm p-2 sm:p-2.5 space-y-1.5 shadow-xs">
        {/* 分类栏与标签 (多行跟随设备动态切换) */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 text-xs font-retro-jp">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] font-pixel text-[#8C7A68] mr-1 shrink-0 whitespace-nowrap">分类:</span>
            {allCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => {
                  soundManager.playBlip();
                  setSelectedCategory(cat);
                  setSelectedTag('全部');
                  setSelectedAuthor('全部');
                }}
                className={`px-2.5 py-1 rounded-xs border transition-all cursor-pointer text-xs shrink-0 whitespace-nowrap select-none active:scale-95 ${
                  selectedCategory === cat
                    ? 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334] font-bold shadow-xs'
                    : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5] active:bg-[#EAE2CE]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* 标签行：漫画本的标签与小说本不通用，小说本模块有自己的题材筛选，此处隐藏 */}
          {(selectedCategory === '插画集' || selectedCategory === '漫画本') && (
            <div className="flex flex-wrap items-center gap-1 pt-1 sm:pt-0 sm:border-l sm:border-dashed sm:border-[#D5C9AF] sm:pl-2">
              <span className="text-[11px] font-pixel text-[#8C7A68] mr-1 shrink-0 whitespace-nowrap">标签:</span>
              <div className="flex flex-wrap items-center gap-1">
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => {
                      soundManager.playBlip();
                      setSelectedTag(tag);
                    }}
                    className={`px-2 py-0.5 rounded-xs border text-xs font-retro-jp transition-all cursor-pointer whitespace-nowrap shrink-0 select-none active:scale-95 ${
                      selectedTag === tag
                        ? 'bg-[#B7791F] text-[#FFFEEF] border-[#B7791F] font-bold shadow-2xs'
                        : 'bg-[#FAF5E8] text-[#7A6958] border-[#E0D5BE] hover:bg-white active:bg-[#EAE2CE]'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 搜索框 */}
        {(selectedCategory === '插画集' || selectedCategory === '漫画本') && (
        <div className="flex items-center gap-1.5 pt-1 border-t border-dashed border-[#E0D5BE]">
          <input
            type="text"
            placeholder="快速检索标题、作者、汉化、嵌字或标签..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-2 py-1 text-xs font-retro-jp bg-[#FAF5E8] border border-[#BFA985] rounded-xs w-full focus:outline-none focus:border-[#1E4334]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-xs text-[#8C7A68] hover:text-[#1E4334] px-1 cursor-pointer whitespace-nowrap shrink-0"
            >
              ✕
            </button>
          )}
        </div>
        )}

        {/* 作者筛选：仅漫画本显示，主题同款下拉框，动态汇总 circle 去重（作品数降序） */}
        {selectedCategory === '漫画本' && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-dashed border-[#E0D5BE]">
            <span className="text-[11px] font-pixel text-[#8C7A68] mr-1 shrink-0 whitespace-nowrap">作者:</span>
            <select
              value={selectedAuthor}
              onChange={(e) => {
                soundManager.playBlip();
                setSelectedAuthor(e.target.value);
              }}
              className="w-auto min-w-[120px] max-w-full bg-[#F8F1DE] focus:ring-1 focus:ring-[#1E4334] px-2 py-1.5 text-xs outline-hidden cursor-pointer font-retro-jp text-[#3B2818]"
            >
              {allAuthors.map((author) => (
                <option key={author} value={author}>
                  {author}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 排序：漫画本/插画集卡片网格通用；小说本使用自己的模块，此处隐藏 */}
        {(selectedCategory === '插画集' || selectedCategory === '漫画本') && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-dashed border-[#E0D5BE]">
            <span className="text-[11px] font-pixel text-[#8C7A68] mr-1 shrink-0 whitespace-nowrap">排序:</span>
            <div className="flex flex-wrap items-center gap-1">
              <button
                onClick={() => {
                  soundManager.playBlip();
                  setSortBy('pages');
                }}
                className={`px-2 py-0.5 rounded-xs border text-xs font-retro-jp transition-all cursor-pointer whitespace-nowrap shrink-0 select-none active:scale-95 ${
                  sortBy === 'pages'
                    ? 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334] font-bold shadow-2xs'
                    : 'bg-[#FAF5E8] text-[#7A6958] border-[#E0D5BE] hover:bg-white active:bg-[#EAE2CE]'
                }`}
              >
                页数多→少
              </button>
              <button
                onClick={() => {
                  soundManager.playBlip();
                  setSortBy('new');
                }}
                className={`px-2 py-0.5 rounded-xs border text-xs font-retro-jp transition-all cursor-pointer whitespace-nowrap shrink-0 select-none active:scale-95 ${
                  sortBy === 'new'
                    ? 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334] font-bold shadow-2xs'
                    : 'bg-[#FAF5E8] text-[#7A6958] border-[#E0D5BE] hover:bg-white active:bg-[#EAE2CE]'
                }`}
              >
                从新到旧
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 小说本 = 专属视图：分类切换（合订本 / 同好来稿）+ 瀑布流 */}
      {selectedCategory === '小说本' && (
        <NovelModule
          searchQuery={searchQuery}
          novels={novels}
          onShowToast={onShowToast}
          initialReadingNovel={requestedNovel}
        />
      )}

      {/* 典藏本卡片网格：2*2 的规整摆放，点击直接进入查看长图
          门已收敛到入口层：comic 模式由 ComicGate 整站守护，main 模式只渲染插画集（公开）。 */}
      {selectedCategory !== '小说本' && (selectedCategory !== '漫画本' || isMangaVisible) && (
        <>
        <div className="columns-1 sm:columns-2 gap-3.5 sm:gap-4.5 w-full">
        {sortedBooks.map((book) => {
          // 通过 COS 逻辑层动态生成封面 CDN 地址
          const coverUrl = cosService.getCoverUrl(book);
          const commentCount = getCommentCountByBookId(book.id);

          return (
            <div
              key={book.id}
              onClick={() => handleOpenBookReader(book)}
              className="bg-[#FFFEEF] border-2 border-[#D5C9AF] hover:border-[#1E4334] rounded-md p-3.5 sm:p-4 flex flex-col justify-between transition-all hover:shadow-md group select-none cursor-pointer space-y-2.5 w-full mb-3.5 sm:mb-4.5 break-inside-avoid"
              title="点击直接打开查看无缝长图"
            >
              <div className="space-y-2">
                {/* 顶部标题与分类徽章 */}
                <div className="flex items-start justify-between gap-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-pixel text-[10px] sm:text-xs px-2 py-0.5 bg-[#1E4334] text-[#F9E79F] rounded-xs font-bold whitespace-nowrap">
                        {book.category || '漫画本'}
                      </span>
                      {book.secure && (
                        <span
                          className="font-pixel text-[10px] px-2 py-0.5 bg-[#7A1F1F] text-[#F6E7C1] rounded-xs font-bold whitespace-nowrap"
                          title="该作品为加密归档，需输入社群安全校验码才能解析"
                        >
                          🔒 含有敏感元素
                        </span>
                      )}
                      {book.pages && (
                        <span className="text-xs font-retro-jp text-[#8C7A68] whitespace-nowrap">
                          {book.pages}P
                        </span>
                      )}
                    </div>
                    <h3 className="font-pixel text-sm sm:text-base font-bold text-[#1E3A2B] group-hover:text-[#B7791F] mt-1 break-words leading-snug transition-colors">
                      {book.titleZh}
                    </h3>
                    {book.titleJp && (
                      <div className="text-xs font-retro-jp text-[#8C7A68] italic truncate">
                        {book.titleJp}
                      </div>
                    )}
                  </div>
                </div>

                {/* 封面图片展示区 (来源 腾讯云 COS CDN 链接映射，竖版漫画本比例 2:3，悬浮显示点击阅读长图) */}
                <div className="relative w-full aspect-[2/3] bg-[#FAF5E8] border border-[#E0D5BE] rounded-xs overflow-hidden group-hover:border-[#1E4334] flex items-center justify-center transition-colors">
                  {book.secure ? (
                    // 敏感本：内页在 COS 上只有密文，读不到任何图片。
                    // 但后台可以「单独上传一张封面」——它不参与加密，落在 {目录}/cover.<ext>，
                    // 面向前台公开可读；有这张才显示封面，没有就退回冷色隔离占位。
                    book.coverFile && !failedCovers.has(book.id) ? (
                      <img
                        src={coverUrl}
                        alt={book.titleZh}
                        title="封面为公开图；正文已加密归档，需校验码解析"
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={() => handleCoverError(book.id)}
                      />
                    ) : (
                      <div className="flex flex-col p-3 text-center w-full h-full items-center justify-center bg-[#EDEFF2]">
                        <div className="text-3xl">🔒</div>
                        <div className="font-mono text-[10px] text-[#5F6368] mt-2 tracking-wide">RESOURCE ISOLATED</div>
                        <div className="font-pixel text-xs text-[#1E3A2B] mt-2 font-bold break-words">{book.titleZh}</div>
                        <div className="font-mono text-[9px] text-[#9AA0A6] mt-1 break-all px-1">
                          node://isolated/{book.id}
                        </div>
                        <div className="text-[10px] text-[#B7791F] mt-2">需校验码解析</div>
                      </div>
                    )
                  ) : !failedCovers.has(book.id) ? (
                    <img
                      src={coverUrl}
                      alt={book.titleZh}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      onError={() => handleCoverError(book.id)}
                    />
                  ) : (
                    <div className="flex flex-col p-2 text-center w-full h-full items-center justify-center">
                      <div className="text-2xl">📖</div>
                      <div className="font-pixel text-xs text-[#1E4334] mt-1 font-bold">{book.titleZh}</div>
                      <div className="text-[10px] text-[#8C7A68] mt-0.5 font-mono">{book.bookFolder || book.id}/{book.coverFile || 'image01.webp'}</div>
                      <div className="text-[10px] text-[#B7791F] mt-0.5">点击进入长图画廊</div>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="px-3.5 py-2 bg-[#1E4334] text-[#F9E79F] font-pixel text-xs sm:text-sm rounded-xs shadow-lg flex items-center gap-1.5 whitespace-nowrap">
                      <span>{book.secure ? '🔒 校验码解析' : '📖 点击阅读长图'}</span>
                      <span>→</span>
                    </span>
                  </div>
                </div>

                {/* 内容预警：后台勾选并填写后展示，未填写时整块不渲染 */}
                {book.warning && (
                  <div className="flex items-start gap-1.5 bg-[#FDF0E3] border border-[#E8B04B] rounded-xs px-2.5 py-1.5">
                    <span className="shrink-0 text-xs leading-none mt-px">⚠</span>
                    <span className="text-xs font-retro-jp text-[#8A5A12] break-words leading-snug">
                      {book.warning}
                    </span>
                  </div>
                )}

                {/* 字段区：“作者”、来源、汉化、嵌字 */}
                <div className="bg-[#FAF5E8] border border-[#EBE3D0] rounded-xs p-2.5 space-y-1.5 text-xs sm:text-[13px] font-retro-jp">
                  <div className="flex items-start gap-1">
                    <span className="font-bold text-[#8C6B38] shrink-0 w-11 text-right">作者:</span>
                    <span className="font-bold flex-1 break-words">
                      <AuthorWithLink author={book.circle} customUrl={book.authorUrl} defaultColorClass="text-[#3E342B]" orangeColorClass="text-[#D35400]" />
                    </span>
                  </div>

                  {book.source && (
                    <div className="flex items-start gap-1">
                      <span className="font-bold text-[#7A6958] shrink-0 w-11 text-right">来源:</span>
                      <span className="text-[#5B4636] flex-1 break-words">{book.source}</span>
                    </div>
                  )}

                  {book.translator && (
                    <div className="flex items-start gap-1">
                      <span className="font-bold text-[#27AE60] shrink-0 w-11 text-right">汉化:</span>
                      <span className="text-[#2D5A3A] flex-1 break-words">{book.translator}</span>
                    </div>
                  )}

                  {book.typesetter && (
                    <div className="flex items-start gap-1">
                      <span className="font-bold text-[#6A4C93] shrink-0 w-11 text-right">嵌字:</span>
                      <span className="text-[#4E376B] flex-1 break-words">{book.typesetter}</span>
                    </div>
                  )}
                </div>

                {/* 标签 tags 列表 */}
                <div className="flex flex-wrap gap-1">
                  {book.tags.map((tag, tIdx) => (
                    <span
                      key={tIdx}
                      className={`text-[10px] sm:text-[11px] font-retro-jp px-2 py-0.5 rounded-xs border ${
                        tag === '预警' || tag === '含R18'
                          ? 'bg-[#FADBD8] text-[#C0392B] border-[#F1948A]'
                          : 'bg-[#F4EEDF] text-[#7A6958] border-[#DECFA9]'
                      }`}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* 底部引导栏：主站有本地评论计数时优先展示；漫画站一律显示页数 */}
              <div className="pt-2.5 border-t border-dashed border-[#E0D5BE] flex items-center justify-between text-xs font-retro-jp text-[#8C7A68] whitespace-nowrap">
                {mode === 'main' && commentCount > 0 ? (
                  <span className="flex items-center gap-1 text-[#5B4636] font-medium">
                    <span>💬</span>
                    <span>共 {commentCount} 条评论</span>
                  </span>
                ) : (
                  <span>共 {book.pages || 30} 页</span>
                )}
                <span className="text-[#1E4334] font-pixel text-xs group-hover:translate-x-0.5 transition-transform flex items-center gap-1 font-bold whitespace-nowrap">
                  <span>进入长图阅读</span>
                  <span>→</span>
                </span>
              </div>
            </div>
          );
        })}
          </div>
          {filteredBooks.length === 0 && (
            <div className="p-8 text-center bg-[#FFFEEF] border border-dashed border-[#D5C9AF] rounded-md text-xs font-retro-jp text-[#8C7A68]">
              没有检索到符合条件的同人本，您可以清空搜索条件或调整分类～
            </div>
          )}
        </>
      )}
    </div>
  );
};
