import React, { useState, useEffect } from 'react';
import {
  DOUJIN_ARCHIVE_DATA,
} from '../data/doujinArchiveData';
import { DoujinBookItem, RecommendItem, GroupNovel } from '../types/doujinArchive';
import { soundManager } from '../utils/audio';
import { cosService } from '../services/cosClient';
import { NovelModule } from './NovelModule';
import LazyComicPage from './LazyComicPage';

interface Props {
  onCopyCode?: (code: string) => void;
  onShowToast: (msg: string) => void;
  onGoToResources?: () => void;
}

export const DoujinshiArchive: React.FC<Props> = ({ onShowToast, onGoToResources }) => {
  // 归档数据状态（优先加载远端 COS archive.json，兜底使用本地 Excel 录入数据）
  const [books, setBooks] = useState<DoujinBookItem[]>(DOUJIN_ARCHIVE_DATA);
  const [isLoadingArchive, setIsLoadingArchive] = useState<boolean>(false);

  // 搜索与多维筛选
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('漫画本');
  const [selectedTag, setSelectedTag] = useState<string>('全部');

  // 当前正在无缝长图阅读的书籍
  const [readingBook, setReadingBook] = useState<DoujinBookItem | null>(null);

  // 动态探测与检测到的内页总数
  const [detectedPages, setDetectedPages] = useState<number | null>(null);
  const [isDetectingPages, setIsDetectingPages] = useState<boolean>(false);

  // 封面加载失败状态
  const [failedCovers, setFailedCovers] = useState<Set<string>>(new Set());

  // 站外推荐表（recs.json）与在线小说索引（novels.json）；读不到则为空 → 对应段不渲染
  const [recs, setRecs] = useState<RecommendItem[]>([]);
  const [novels, setNovels] = useState<GroupNovel[]>([]);

  // 统计所有标签（动态汇总当前数据中的所有标签）
  const allCategories = ['漫画本', '小说本', '插画集'];
  const dynamicTags = Array.from(new Set(books.flatMap((b) => b.tags || [])));
  const allTags = ['全部', ...dynamicTags];

  // 组件挂载时自动尝试同步 COS 远端归档（推荐表与在线小说索引并行加载，失败静默降级）
  useEffect(() => {
    handleRefreshArchive(false);
    cosService.loadRecsData().then(setRecs).catch(() => {});
    cosService.loadNovelList().then(setNovels).catch(() => {});
  }, []);

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
    soundManager.playBlip();
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
    soundManager.playBlip();
    setReadingBook(null);
    setDetectedPages(null);
  };

  // 过滤同人本列表
  const filteredBooks = books.filter((book) => {
    const matchCat = (book.category || '漫画本') === selectedCategory;
    const matchTag = selectedTag === '全部' || book.tags.includes(selectedTag);
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

    return matchCat && matchTag && matchSearch;
  });

  // 处理封面加载失败
  const handleCoverError = (bookId: string) => {
    setFailedCovers((prev) => new Set(prev).add(bookId));
  };

  // ==========================================
  // 📖 无缝长图阅读模式 (基于 腾讯云 COS CDN 映射 + react-pinch-zoom-pan)
  // ==========================================
  if (readingBook) {
    const totalPages = detectedPages || readingBook.pages || 30;
    const pagesList = Array.from({ length: totalPages }, (_, i) => i + 1);

    // 长图主体内容：无间隙、块级排列、消除所有图片缝隙
    const renderLongStripContent = () => (
      <div className="w-full max-w-2xl mx-auto bg-[#181D1A] rounded-lg overflow-hidden border-2 border-[#1E4334] shadow-xl">
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
        {/* 顶部快捷导航与手势缩放控制条 */}
        <div className="sticky top-2 z-40 mb-3 px-3 py-2 bg-[#FAF5E8]/95 border border-[#1E4334] rounded-lg shadow-md backdrop-blur-xs flex items-center justify-between gap-2">
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
                作者：{readingBook.circle} · 共 {totalPages} 页
                {isDetectingPages ? '（动态校准中...）' : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => {
                soundManager.playBlip();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="px-2 py-1 bg-[#FAF5E8] hover:bg-[#EAE2CE] border border-[#D5C9AF] text-[#5B4636] font-pixel text-[10px] rounded-xs cursor-pointer"
              title="回到顶端"
            >
              ↑ 顶端
            </button>
          </div>
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
            <button
              onClick={() => {
                soundManager.playBlip();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="px-3 py-1.5 bg-[#FFFEEF] text-[#5B4636] border border-[#D5C9AF] text-xs rounded-xs cursor-pointer hover:bg-white"
            >
              回到顶部
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // 📚 典藏本列表主视图 (coverFile 映射为 腾讯云 COS CDN 链接)
  // ==========================================
  return (
    <div id="doujinshi-archive-root" className="space-y-3 text-[#2C241D] select-text">
      {/* 典藏公约红线轻量提示 */}
      <div className="p-2 px-3 bg-[#FBF0EE] border-l-3 border-[#C0392B] rounded-r-xs font-retro-jp text-[11px] text-[#900C3F] flex items-center">
        <div>
          <span className="font-bold">⚠️ 典藏公约：</span>
          本专区由利韩同好自发汉化嵌字。<b>严禁倒卖商用、严禁转传闲鱼微店</b>，请共同守护创作者的心血。
        </div>
      </div>

      {/* 筛选与搜索栏 */}
      <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-md p-2.5 space-y-2">
        {/* 分类栏与标签 */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-retro-jp">
          <span className="text-[10px] font-pixel text-[#8C7A68] mr-1">分类:</span>
          {allCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                soundManager.playBlip();
                setSelectedCategory(cat);
              }}
              className={`px-2 py-0.5 rounded-xs border transition-all cursor-pointer text-[11px] ${
                selectedCategory === cat
                  ? 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334] font-bold shadow-xs'
                  : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5]'
              }`}
            >
              {cat}
            </button>
          ))}

          {/* 标签行：漫画本的标签与小说本不通用，小说本模块有自己的题材筛选，此处隐藏 */}
          {selectedCategory !== '小说本' && (
            <>
              <span className="text-[10px] font-pixel text-[#8C7A68] ml-2 mr-1">标签:</span>
              <div className="flex flex-wrap gap-1">
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => {
                      soundManager.playBlip();
                      setSelectedTag(tag);
                    }}
                    className={`px-1.5 py-0.5 rounded-xs border text-[10px] font-retro-jp transition-all cursor-pointer ${
                      selectedTag === tag
                        ? 'bg-[#B7791F] text-[#FFFEEF] border-[#B7791F] font-bold'
                        : 'bg-[#FAF5E8] text-[#7A6958] border-[#E0D5BE] hover:bg-white'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 搜索框 */}
        <div className="flex items-center gap-1.5 pt-1 border-t border-dashed border-[#E0D5BE]">
          <input
            type="text"
            placeholder="快速检索标题、作者、汉化、嵌字或标签..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-2.5 py-1 text-xs font-retro-jp bg-[#FAF5E8] border border-[#BFA985] rounded-xs w-full focus:outline-none focus:border-[#1E4334]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-xs text-[#8C7A68] hover:text-[#1E4334] px-1 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 小说本 = 专属视图：段切换（在线小说 / 站外推荐）+ 题材筛选 + 瀑布流 */}
      {selectedCategory === '小说本' && (
        <NovelModule searchQuery={searchQuery} recs={recs} novels={novels} onShowToast={onShowToast} />
      )}

      {/* 典藏本卡片网格：点击直接进入查看长图（手机两列，封面为竖版漫画本比例）；小说本视图下由上方模块接管 */}
      {selectedCategory !== '小说本' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
        {filteredBooks.map((book) => {
          // 通过 COS 逻辑层动态生成封面 CDN 地址
          const coverUrl = cosService.getCoverUrl(book);

          return (
            <div
              key={book.id}
              onClick={() => handleOpenBookReader(book)}
              className="bg-[#FFFEEF] border border-[#D5C9AF] hover:border-[#1E4334] rounded-md p-3 flex flex-col justify-between transition-all hover:shadow-md group select-none cursor-pointer space-y-2"
              title="点击直接打开查看无缝长图"
            >
              <div className="space-y-2">
                {/* 顶部标题与分类徽章 */}
                <div className="flex items-start justify-between gap-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-pixel text-[9px] px-1.5 py-0.2 bg-[#1E4334] text-[#F9E79F] rounded-xs font-bold">
                        {book.category || '漫画本'}
                      </span>
                      {book.pages && (
                        <span className="text-[10px] font-retro-jp text-[#8C7A68]">
                          {book.pages}P
                        </span>
                      )}
                    </div>
                    <h3 className="font-pixel text-xs sm:text-[13px] font-bold text-[#1E3A2B] group-hover:text-[#B7791F] mt-1 break-words leading-snug transition-colors">
                      {book.titleZh}
                    </h3>
                    {book.titleJp && (
                      <div className="text-[10px] font-retro-jp text-[#8C7A68] italic truncate">
                        {book.titleJp}
                      </div>
                    )}
                  </div>
                </div>

                {/* 封面图片展示区 (来源 腾讯云 COS CDN 链接映射，竖版漫画本比例 2:3，悬浮显示点击阅读长图) */}
                <div className="relative w-full aspect-[2/3] bg-[#FAF5E8] border border-[#E0D5BE] rounded-xs overflow-hidden group-hover:border-[#1E4334] flex items-center justify-center transition-colors">
                  {!failedCovers.has(book.id) ? (
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
                      <div className="text-xl">📖</div>
                      <div className="font-pixel text-[10px] text-[#1E4334] mt-1 font-bold">{book.titleZh}</div>
                      <div className="text-[9px] text-[#8C7A68] mt-0.5 font-mono">{book.bookFolder || book.id}/{book.coverFile || 'image01.webp'}</div>
                      <div className="text-[8px] text-[#B7791F] mt-0.5">点击进入长图画廊</div>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="px-3 py-1.5 bg-[#1E4334] text-[#F9E79F] font-pixel text-xs rounded-xs shadow-lg flex items-center gap-1">
                      <span>📖 点击阅读长图</span>
                      <span>→</span>
                    </span>
                  </div>
                </div>

                {/* 内容预警：后台勾选并填写后展示，未填写时整块不渲染 */}
                {book.warning && (
                  <div className="flex items-start gap-1.5 bg-[#FDF0E3] border border-[#E8B04B] rounded-xs px-2 py-1.5">
                    <span className="shrink-0 text-[11px] leading-none mt-px">⚠</span>
                    <span className="text-[10px] font-retro-jp text-[#8A5A12] break-words leading-snug">
                      {book.warning}
                    </span>
                  </div>
                )}

                {/* 字段区：“作者”、来源、汉化、嵌字 */}
                <div className="bg-[#FAF5E8] border border-[#EBE3D0] rounded-xs p-2 space-y-1 text-[11px] font-retro-jp">
                  <div className="flex items-start gap-1">
                    <span className="font-bold text-[#8C6B38] shrink-0 w-10 text-right">作者:</span>
                    <span className="text-[#3E342B] font-bold flex-1 break-words">
                      {book.circle || '未知'}
                    </span>
                  </div>

                  {book.source && (
                    <div className="flex items-start gap-1">
                      <span className="font-bold text-[#7A6958] shrink-0 w-10 text-right">来源:</span>
                      <span className="text-[#5B4636] flex-1 break-words">{book.source}</span>
                    </div>
                  )}

                  {book.translator && (
                    <div className="flex items-start gap-1">
                      <span className="font-bold text-[#27AE60] shrink-0 w-10 text-right">汉化:</span>
                      <span className="text-[#2D5A3A] flex-1 break-words">{book.translator}</span>
                    </div>
                  )}

                  {book.typesetter && (
                    <div className="flex items-start gap-1">
                      <span className="font-bold text-[#6A4C93] shrink-0 w-10 text-right">嵌字:</span>
                      <span className="text-[#4E376B] flex-1 break-words">{book.typesetter}</span>
                    </div>
                  )}
                </div>

                {/* 标签 tags 列表 */}
                <div className="flex flex-wrap gap-1">
                  {book.tags.map((tag, tIdx) => (
                    <span
                      key={tIdx}
                      className={`text-[9px] font-retro-jp px-1.5 py-0.2 rounded-xs border ${
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

              {/* 底部引导栏：简约提示点击即看长图 */}
              <div className="pt-2 border-t border-dashed border-[#E0D5BE] flex items-center justify-between text-[10px] font-retro-jp text-[#8C7A68]">
                <span>共 {book.pages || 30} 页</span>
                <span className="text-[#1E4334] font-pixel text-[10px] group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                  <span>进入长图阅读</span>
                  <span>→</span>
                </span>
              </div>
            </div>
          );
        })}
          </div>
        </>
      )}

      {selectedCategory !== '小说本' && filteredBooks.length === 0 && (
        <div className="p-8 text-center bg-[#FFFEEF] border border-dashed border-[#D5C9AF] rounded-md text-xs font-retro-jp text-[#8C7A68]">
          没有检索到符合条件的同人本，您可以清空搜索条件或调整分类～
        </div>
      )}
    </div>
  );
};
