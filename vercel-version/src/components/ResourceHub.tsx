import React, { useState } from 'react';
import { ResourceLink } from '../types';
import { RESOURCE_LINKS } from '../data/initialData';
import { soundManager } from '../utils/audio';
import { AuNovelReader } from './AuNovelReader';
import { CardPatternOverlay } from './CardPatternOverlay';
import {
  CHARACTER_DESIGN_PREVIEW_BOOKS,
  FORMULA_BOOK_PREVIEW_BOOKS,
  MANGA_PREVIEW_BOOKS,
  SHORT_GIANT_PREVIEW_BOOKS,
  type MangaPreviewBook,
} from '../data/mangaPreviewBooks';
import './MangaPageReader.css';

const MangaPageReader = React.lazy(() => import('./MangaPageReader').then((module) => ({ default: module.MangaPageReader })));

interface Props {
  onCopyCode: (code: string) => void;
  onShowToast: (msg: string) => void;
  onGoToDoujin?: () => void;
}

type ResourceGridItem =
  | { kind: 'link'; resource: ResourceLink }
  | { kind: 'preview'; collection: 'no-regrets' | 'short-giant' | 'character-design' | 'formula-book' };

export const ResourceHub: React.FC<Props> = ({
  onShowToast,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('动漫原片');
  const [previewBook, setPreviewBook] = useState<MangaPreviewBook | null>(null);

  const allCategories = ['动漫原片', '漫画', '设定集与分镜', '二创素材', '官方AU小说'];

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
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const animeLinks = RESOURCE_LINKS.filter((r) => r.category === 'anime');
  const creativeLinks = RESOURCE_LINKS.filter((r) => r.category === 'creative');
  const mangaLinks = RESOURCE_LINKS.filter((r) => (
    (r.category === 'manga' || r.category === 'link') && !['r-10', 'r-17', 'r-18', 'r-19'].includes(r.id)
  ));
  const settingAndStoryboardLinks = RESOURCE_LINKS.filter((r) => (
    r.category === 'manga' && ['r-10', 'r-12', 'r-17', 'r-18', 'r-19'].includes(r.id)
  ));

  // 根据选中的分类过滤
  const currentCategoryLinks = (() => {
    switch (selectedCategory) {
      case '动漫原片':
        return animeLinks;
      case '漫画':
        return mangaLinks;
      case '设定集与分镜':
        return settingAndStoryboardLinks;
      case '二创素材':
        return creativeLinks;
      default:
        return [];
    }
  })();

  const currentCategoryItems = currentCategoryLinks.flatMap<ResourceGridItem>((resource) => {
    if (resource.id === 'r-9') return [{ kind: 'preview', collection: 'short-giant' }];
    if (resource.id === 'r-18') return [{ kind: 'preview', collection: 'formula-book' }];
    // r-19 与 r-18 同属「公式书」合集，已由 formula-book 卡片统一承载
    if (resource.id === 'r-19') return [];
    if (resource.id === 'r-12') return [{
      kind: 'preview',
      collection: selectedCategory === '设定集与分镜' ? 'character-design' : 'no-regrets',
    }];
    return [{ kind: 'link', resource }];
  });

  const resourceCardClassName = 'resource-themed-card relative overflow-hidden p-3.5 sm:p-4 flex flex-col justify-between group select-none space-y-2.5 w-full';

  const renderResourceGrid = (entries: ResourceGridItem[]) => (
    <div className="grid grid-cols-1 gap-2.5 w-full">
      {entries.map((entry) => {
        if (entry.kind === 'preview') {
          const isShortGiant = entry.collection === 'short-giant';
          const isCharacterDesign = entry.collection === 'character-design';
          const isFormulaBook = entry.collection === 'formula-book';
          const books = isShortGiant
            ? SHORT_GIANT_PREVIEW_BOOKS
            : isCharacterDesign
              ? CHARACTER_DESIGN_PREVIEW_BOOKS
              : isFormulaBook
                ? FORMULA_BOOK_PREVIEW_BOOKS
                : MANGA_PREVIEW_BOOKS;
          return (
            <article className={resourceCardClassName} key={entry.collection + '-preview'} style={{ contain: 'layout style paint' }}>
              <CardPatternOverlay opacity={0.10} mode="multiply" />
              <div className="relative z-10 space-y-2">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="resource-themed-badge resource-themed-badge--preview text-xs px-2 py-0.5 font-pixel font-bold whitespace-nowrap">
                    在线预览
                  </span>
                </div>
                <h3 className="resource-themed-heading font-pixel text-sm sm:text-base font-bold leading-snug break-words">
                  {isShortGiant
                    ? '短剧的巨人'
                    : isCharacterDesign
                      ? '人物设定 三视图'
                      : isFormulaBook
                        ? '进击的巨人 公式书'
                        : '无悔的选择'}
                </h3>
              </div>
              <div className="manga-preview-volume-actions">
                {books.map((book) => (
                  <button
                    className="manga-preview-open-button"
                    key={book.id}
                    type="button"
                    onClick={() => setPreviewBook(book)}
                  >
                    {book.actionLabel ?? book.volumeLabel}
                  </button>
                ))}
              </div>
            </article>
          );
        }
        const item = entry.resource;
        const platformBadgeVariant = item.platform === '夸克网盘'
          ? 'quark'
          : item.platform === '百度网盘'
            ? 'baidu'
            : item.platform === '在线阅读' || item.platform === '跳转阅读' || item.platform === '站内独立阅读'
              ? 'preview'
              : 'weibo';
        const isExternalReadingLink = item.platform === '在线阅读' || item.platform === '跳转阅读' || item.platform === '站内独立阅读';
        return (
        <button
          type="button"
          key={item.id}
          onClick={() => handleAutoJump(item.url, item.code)}
          onMouseEnter={() => soundManager.playCardHover()}
          className={resourceCardClassName + ' cursor-pointer text-left'}
          style={{ contain: 'layout style paint' }}
          title={isExternalReadingLink ? '打开在线阅读页面' : item.platform === '微博' ? '打开微博内容' : '点击即可自动复制提取码并打开网盘'}
        >
          <CardPatternOverlay opacity={0.10} mode="multiply" />
          <div className="relative z-10 space-y-2">
            {/* Top Badges */}
            <div className="flex items-center justify-between gap-1.5 flex-wrap">
              <span
                className={`resource-themed-badge resource-themed-badge--${platformBadgeVariant} text-xs px-2 py-0.5 font-pixel font-bold whitespace-nowrap`}
              >
                {item.platform}
              </span>

              {item.code ? (
                <span className="resource-themed-badge resource-themed-badge--code font-pixel text-xs px-2 py-0.5 font-bold flex items-center gap-1 whitespace-nowrap">
                  <span>📋 提取码</span>
                  <span>{item.code}</span>
                </span>
              ) : item.platform !== '微博' && !isExternalReadingLink ? (
                <span className="resource-themed-badge resource-themed-badge--code font-pixel text-xs px-2 py-0.5 font-bold whitespace-nowrap">
                  免提取码
                </span>
              ) : null}
              {item.archivePassword && (
                <span className="resource-themed-badge resource-themed-badge--code font-pixel text-xs px-2 py-0.5 font-bold flex items-center gap-1 whitespace-nowrap">
                  <span>解压密码</span>
                  <span>{item.archivePassword}</span>
                </span>
              )}
            </div>

            {/* Title */}
            <h3 className="resource-themed-heading font-pixel text-sm sm:text-base font-bold leading-snug break-words">
              {item.title}
            </h3>

          </div>
        </button>
        );
      })}
    </div>
  );

  const renderCategoryTab = (category: string) => (
    <button
      key={category}
      onClick={() => {
        soundManager.playFilterClick();
        setSelectedCategory(category);
      }}
      onMouseEnter={() => soundManager.playCardHover()}
      className={`resource-filter-tab px-3 py-1.5 cursor-pointer text-xs sm:text-sm whitespace-nowrap select-none ${selectedCategory === category ? 'resource-filter-tab--active font-bold' : ''}`}
    >
      {category}
    </button>
  );

  return (
    <div id="official-resources-root" className="manga-preview-region space-y-3 text-[var(--resource-text)] select-text">
      <div className="space-y-1.5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5">
          <span className="pt-1.5 text-xs font-pixel whitespace-nowrap">分类:</span>
          <div className="grid grid-cols-3 gap-1.5">
            {allCategories.slice(0, 3).map(renderCategoryTab)}
          </div>
          <span aria-hidden="true" />
          <div className="grid grid-cols-2 gap-1.5">
            {allCategories.slice(3).map(renderCategoryTab)}
          </div>
        </div>
      </div>

      {selectedCategory === '官方AU小说' ? (
        /* 📜 官方AU小说专区 */
        <div className="mb-6">
          <AuNovelReader onShowToast={onShowToast} />
        </div>
      ) : (
        <div className="px-3 pb-8 sm:px-4 sm:pb-10">
          {currentCategoryItems.length > 0 ? (
            renderResourceGrid(currentCategoryItems)
          ) : (
            <div className="resource-themed-card p-8 text-center text-xs font-retro-jp">
              暂无资源
            </div>
          )}
        </div>
      )}

      {previewBook && (
        <React.Suspense
          fallback={(
            <div className="manga-reader-backdrop manga-preview-ui" role="status">
              <div className="manga-reader-loading-shell">正在打开阅读器…</div>
            </div>
          )}
        >
          <MangaPageReader key={previewBook.id} book={previewBook} onClose={() => setPreviewBook(null)} />
        </React.Suspense>
      )}
    </div>
  );
};
