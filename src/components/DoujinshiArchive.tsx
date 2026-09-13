import React, { useState, useEffect } from 'react';
import { ReactPinchZoomPan } from 'react-pinch-zoom-pan';
import {
  DOUJIN_ARCHIVE_DATA,
} from '../data/doujinArchiveData';
import { DoujinBookItem } from '../types/doujinArchive';
import { soundManager } from '../utils/audio';
import { cosService, COSConfigState } from '../services/cosClient';

interface Props {
  onCopyCode?: (code: string) => void;
  onShowToast: (msg: string) => void;
  onGoToResources?: () => void;
}

export const DoujinshiArchive: React.FC<Props> = ({ onShowToast, onGoToResources }) => {
  // 游客研发中门禁状态（默认锁定，普通游客显示“研发中”；开发与管理人员可输入暗号解锁测试内部模块）
  const [isDevUnlocked, setIsDevUnlocked] = useState<boolean>(false);
  const [showUnlockModal, setShowUnlockModal] = useState<boolean>(false);
  const [inputSecret, setInputSecret] = useState<string>('');
  const [unlockError, setUnlockError] = useState<string>('');

  // 归档数据状态（优先加载远端 COS archive.json，兜底使用本地 Excel 录入数据）
  const [books, setBooks] = useState<DoujinBookItem[]>(DOUJIN_ARCHIVE_DATA);
  const [isLoadingArchive, setIsLoadingArchive] = useState<boolean>(false);

  // COS 逻辑层状态与配置
  const [cosConfig, setCosConfig] = useState<COSConfigState>(cosService.getConfig());
  const [showCosPanel, setShowCOSPanel] = useState<boolean>(false);
  const [cosConnectionStatus, setCosConnectionStatus] = useState<
    'ready' | 'testing' | 'connected' | 'error'
  >('ready');
  const [cosStatusMessage, setCosStatusMessage] = useState<string>('COS S3 API 逻辑层已就绪');

  // 搜索与多维筛选
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('全部');
  const [selectedTag, setSelectedTag] = useState<string>('全部');

  // 当前正在无缝长图阅读的书籍
  const [readingBook, setReadingBook] = useState<DoujinBookItem | null>(null);

  // 动态探测与检测到的内页总数
  const [detectedPages, setDetectedPages] = useState<number | null>(null);
  const [isDetectingPages, setIsDetectingPages] = useState<boolean>(false);

  // 缩放模式：'seamless'（竖向无缝瀑布流长图） | 'zoom'（利用 react-pinch-zoom-pan 支持手势双指捏合缩放/平移）
  const [interactiveZoom, setInteractiveZoom] = useState<boolean>(false);

  // 统计所有标签（动态汇总当前数据中的所有标签）
  const allCategories = ['全部', '漫画本', '小说本', '插画集'];
  const dynamicTags = Array.from(new Set(books.flatMap((b) => b.tags || [])));
  const allTags = ['全部', ...dynamicTags];

  // 组件挂载时自动尝试同步 COS 远端归档
  useEffect(() => {
    handleRefreshArchive(false);
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

  // 测试与 腾讯云 COS 存储桶的 HTTPS/S3 API 连通性
  const handleTestCosConnection = async () => {
    soundManager.playBlip();
    setCosConnectionStatus('testing');
    setCosStatusMessage('正在请求 COS 端点探测连通性...');

    try {
      // 探测首本 lh-001/image01.webp 样本资源
      const testUrl = cosService.getObjectUrl('lh-001/image01.webp');
      const probe = await cosService.probeResource(testUrl);

      if (probe.ok) {
        setCosConnectionStatus('connected');
        setCosStatusMessage(`连接畅通！HTTP 状态码: ${probe.status} (${probe.contentType || 'image'})`);
        onShowToast('腾讯云 COS 存储桶资源请求通畅 🚀');
      } else {
        // 尝试探测根目录
        const rootProbe = await cosService.probeResource(cosConfig.cdnBaseUrl);
        if (rootProbe.status !== 0) {
          setCosConnectionStatus('connected');
          setCosStatusMessage(`COS 域可访问 (状态码 ${rootProbe.status})，请确保存储桶公共读或图片已上传`);
          onShowToast(`COS 域响应正常 (${rootProbe.status})`);
        } else {
          setCosConnectionStatus('error');
          setCosStatusMessage('探测受阻：请检查 CORS 跨域规则或公开访问权限');
          onShowToast('COS 端点暂未返回响应，请确保存储桶公开访问或配置 CORS');
        }
      }
    } catch (e: any) {
      setCosConnectionStatus('error');
      setCosStatusMessage(`请求异常: ${e?.message || '网络或跨域受阻'}`);
    }
  };

  // 保存自定义 COS 配置 (例如用户提供了自己的公开 CDN 域名或 S3 密钥)
  const handleSaveCosConfig = (newConfig: Partial<COSConfigState>) => {
    cosService.updateConfig(newConfig);
    setCosConfig(cosService.getConfig());
    onShowToast('COS 逻辑层配置已更新并持久化至本地 ⚙️');
  };

  // 点击卡片直接进入查看来源于 COS 的无缝长图
  const handleOpenBookReader = async (book: DoujinBookItem) => {
    soundManager.playBlip();
    setReadingBook(book);
    setDetectedPages(book.pages || 30);
    onShowToast(`正在开启《${book.titleZh}》无缝长图画廊 📖`);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // 后台非阻塞动态探测实际存在页数
    setIsDetectingPages(true);
    try {
      const realPages = await cosService.detectBookPages(book, Math.max(book.pages || 30, 40));
      if (realPages && realPages > 0) {
        setDetectedPages(realPages);
      }
    } catch (e) {
      // 维持默认页数
    } finally {
      setIsDetectingPages(false);
    }
  };

  // 退出阅读器
  const handleCloseReader = () => {
    soundManager.playBlip();
    setReadingBook(null);
    setInteractiveZoom(false);
    setDetectedPages(null);
  };

  // 过滤同人本列表
  const filteredBooks = books.filter((book) => {
    const matchCat = selectedCategory === '全部' || (book.category || '漫画本') === selectedCategory;
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

  // 暗号验证与解锁处理
  const handleVerifySecret = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const val = inputSecret.trim().toLowerCase();
    // 管理员开放密码（仅代码内校验，页面任何位置不显示）
    if (val === 'luna721') {
      soundManager.playCoin();
      setIsDevUnlocked(true);
      setShowUnlockModal(false);
      setInputSecret('');
      setUnlockError('');
      onShowToast('已解锁土豆粮仓内部研发测试模块 🛠️');
    } else {
      soundManager.playBlip();
      setUnlockError('通行口令不正确，请重新输入');
    }
  };

  // ==========================================
  // 🚧 游客研发中展示视图（普通游客默认无法访问内部模块）
  // ==========================================
  if (!isDevUnlocked) {
    return (
      <div id="doujin-under-dev-view" className="space-y-4 text-[#2C241D]">
        {/* 顶部醒目施工横幅 */}
        <div className="bg-[#1E4334] text-[#FAF5E8] border-2 sm:border-[3px] border-[#153025] rounded-md p-4 sm:p-6 shadow-md relative overflow-hidden text-center space-y-3">
          <div className="absolute top-2 left-3 opacity-15 text-2xl select-none pointer-events-none">🚧</div>
          <div className="absolute top-2 right-3 opacity-15 text-2xl select-none pointer-events-none">⚙️</div>
          <div className="absolute bottom-2 left-8 opacity-15 text-2xl select-none pointer-events-none">🥔</div>
          <div className="absolute bottom-2 right-8 opacity-15 text-2xl select-none pointer-events-none">📐</div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#2B5E4A] border border-[#3B7E64] text-[#F9E79F] text-xs font-pixel rounded-xs shadow-xs">
            <span>🚧</span>
            <span>UNDER DEVELOPMENT</span>
          </div>

          <div className="space-y-1">
            <h2 className="font-pixel text-lg sm:text-2xl text-[#F9E79F] font-bold tracking-wide">
              土豆粮仓驻地 · 正在研发施工
            </h2>
            <p className="font-retro-jp text-xs sm:text-sm text-[#D5F5E3] max-w-xl mx-auto leading-relaxed">
              为了提供更优质的浏览与阅读体验，本专区正在进行深度优化与升级。
            </p>
          </div>

          {/* 进度条与状态展示 */}
          <div className="max-w-md mx-auto bg-[#142B21] border border-[#2B5E4A] rounded-xs p-3 space-y-2 text-left">
            <div className="flex items-center justify-between text-[11px] font-pixel text-[#F9E79F]">
              <span className="flex items-center gap-1">
                <span className="animate-spin text-xs">⚙️</span>
                <span>核心模块研发进度</span>
              </span>
              <span>85%</span>
            </div>
            {/* Retro Pixel Progress Bar */}
            <div className="w-full bg-[#0D1C16] border border-[#2B5E4A] h-3 rounded-xs overflow-hidden p-0.5">
              <div className="bg-gradient-to-r from-[#D4AC0D] to-[#58D68D] h-full rounded-2xs w-[85%] transition-all duration-500 animate-pulse" />
            </div>
          </div>
        </div>

        {/* 详细说明卡片 */}
        <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-md p-4 sm:p-5 space-y-3 font-retro-jp shadow-xs">
          <div className="flex items-center gap-2 text-sm font-pixel text-[#1E4334] font-bold border-b border-dashed border-[#D5C9AF] pb-2">
            <span>🥔</span>
            <span>游客访问指引</span>
          </div>

          <div className="space-y-2 text-xs sm:text-sm text-[#5B4636] leading-relaxed">
            <p className="flex items-start gap-1.5">
              <span className="text-[#C0392B] font-bold shrink-0">✦</span>
              <span>
                <b>暂未对外开放：</b>当前同人本画廊与在线阅读器仍在持续调优，暂不对普通游客开放访问，敬请关注后续版本公告。
              </span>
            </p>
            <p className="flex items-start gap-1.5">
              <span className="text-[#27AE60] font-bold shrink-0">✦</span>
              <span>
                <b>公开资源可正常使用：</b>进击的巨人动画利韩全季 Cut、官方广播剧、访谈考据及 140+ Pixiv 画师外链均可在<b>【资源外链】</b>专区无障碍获取。
              </span>
            </p>
            <p className="flex items-start gap-1.5">
              <span className="text-[#8E44AD] font-bold shrink-0">✦</span>
              <span>
                <b>同好交流与答疑：</b>欢迎前往<b>【兵团驻地】</b>查看群规并加入 QQ 同好交流群。
              </span>
            </p>
          </div>

          {/* 快捷导航与内部人员通道 */}
          <div className="pt-3 border-t border-dashed border-[#D5C9AF] flex flex-wrap items-center justify-between gap-2.5">
            <button
              onClick={() => {
                soundManager.playBlip();
                if (onGoToResources) onGoToResources();
              }}
              className="px-4 py-2 bg-[#1E4334] text-[#F9E79F] hover:bg-[#2B5E4A] font-pixel text-xs rounded-xs cursor-pointer transition-all shadow-xs flex items-center gap-1.5"
            >
              <span>📚 前往【资源外链】专区</span>
              <span>➔</span>
            </button>

            <button
              onClick={() => {
                soundManager.playBlip();
                setShowUnlockModal(true);
              }}
              className="px-3 py-1.5 bg-[#FAF5E8] hover:bg-[#F3EAD5] text-[#7A6958] hover:text-[#1E4334] border border-[#D5C9AF] font-retro-jp text-xs rounded-xs cursor-pointer transition-all flex items-center gap-1"
              title="仅限管理与开发人员测试调试使用"
            >
              <span>🛠️ 内部调试通道</span>
            </button>
          </div>
        </div>

        {/* 内部测试暗号解锁弹窗 */}
        {showUnlockModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-[#FAF5E8] border-2 border-[#1E4334] rounded-md max-w-sm w-full p-4 shadow-2xl space-y-3 font-retro-jp">
              <div className="flex items-center justify-between border-b border-[#D5C9AF] pb-2">
                <div className="flex items-center gap-1.5 font-pixel text-xs text-[#1E4334] font-bold">
                  <span>🛠️</span>
                  <span>内部测试通行鉴权</span>
                </div>
                <button
                  onClick={() => {
                    setShowUnlockModal(false);
                    setUnlockError('');
                  }}
                  className="text-xs text-[#7A6958] hover:text-black cursor-pointer px-1"
                >
                  ✕
                </button>
              </div>

              <p className="text-xs text-[#5B4636]">
                请输入内部测试通行口令以提前预览土豆粮仓内部模块：
              </p>

              <form onSubmit={handleVerifySecret} className="space-y-2.5">
                <input
                  type="password"
                  placeholder="输入管理密码..."
                  value={inputSecret}
                  onChange={(e) => {
                    setInputSecret(e.target.value);
                    setUnlockError('');
                  }}
                  autoFocus
                  className="w-full px-2.5 py-1.5 bg-[#FFFEEF] border border-[#1E4334] rounded-xs text-xs font-mono text-[#1E4334] focus:outline-none focus:ring-1 focus:ring-[#1E4334]"
                />

                {unlockError && (
                  <p className="text-[11px] text-[#C0392B] font-bold">{unlockError}</p>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowUnlockModal(false);
                      setUnlockError('');
                    }}
                    className="px-3 py-1 bg-[#FAF5E8] border border-[#D5C9AF] text-xs rounded-xs cursor-pointer text-[#5B4636]"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1 bg-[#1E4334] text-[#F9E79F] font-pixel text-xs rounded-xs cursor-pointer hover:bg-[#2B5E4A] shadow-xs"
                  >
                    确认解锁
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

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
            <div key={pageNum} className="relative w-full block m-0 p-0 leading-none">
              <img
                src={pageUrl}
                alt={`${readingBook.titleZh} 第 ${pageNum} 页`}
                loading={pageNum <= 4 ? 'eager' : 'lazy'}
                referrerPolicy="no-referrer"
                className="w-full h-auto block m-0 p-0 border-0 align-top select-none"
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = 'none';
                  const parent = target.parentElement;
                  if (parent) {
                    parent.className =
                      'w-full py-10 px-4 bg-[#1E2621] border-b border-dashed border-[#34483B] text-center text-[#A69C8E] font-retro-jp space-y-1 block';
                    parent.innerHTML = `
                      <div class="text-sm font-pixel text-[#F9E79F]">第 ${pageNum} / ${totalPages} 页</div>
                      <div class="text-[11px] text-[#C4B7A6] mt-0.5">COS 路径: ${readingBook.bookFolder || readingBook.id}/image${pageNum.toString().padStart(2, '0')}.webp</div>
                      <div class="text-[9px] text-[#7A6958]">若图片未显示，请确保存储桶已开启 Public Access 或文件已同步</div>
                    `;
                  }
                }}
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
                作者：{readingBook.circle} · 共 {totalPages} 页{' '}
                {isDetectingPages ? '(动态校准中...)' : '· COS 动态长图'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* 切换 react-pinch-zoom-pan 手势缩放平移 */}
            <button
              onClick={() => {
                soundManager.playBlip();
                setInteractiveZoom(!interactiveZoom);
                onShowToast(
                  !interactiveZoom
                    ? '已开启双指捏合缩放/平移模式 (Pinch Zoom Pan) 🔍'
                    : '已切回常规长图滚动模式 📜'
                );
              }}
              className={`px-2.5 py-1 font-pixel text-[10px] rounded-xs cursor-pointer transition-all border ${
                interactiveZoom
                  ? 'bg-[#B7791F] text-[#FFFEEF] border-[#B7791F] font-bold shadow-xs'
                  : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#EAE2CE]'
              }`}
              title="使用 react-pinch-zoom-pan 进行双指捏合缩放与全向平移"
            >
              {interactiveZoom ? '🔍 缩放平移中' : '🔍 捏合缩放'}
            </button>

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

        {/* 缩放/平移或常规无缝长图展示区 */}
        {interactiveZoom ? (
          <div className="w-full bg-[#181D1A] rounded-lg overflow-hidden border-2 border-[#1E4334] shadow-xl p-1 touch-none">
            <div className="text-center py-1.5 text-[10px] font-retro-jp text-[#F9E79F] bg-[#1E2621] rounded-xs mb-2 flex items-center justify-center gap-2">
              <span>💡 提示：在画面中支持触摸双指捏合放大、拖动平移。</span>
              <button
                onClick={() => setInteractiveZoom(false)}
                className="underline hover:text-white cursor-pointer"
              >
                切回滚屏
              </button>
            </div>
            {/* react-pinch-zoom-pan 容器 */}
            <ReactPinchZoomPan
              initialScale={1}
              maxScale={3}
              render={({ x, y, scale }) => (
                <div
                  style={{
                    transform: `translate3d(${x}px, ${y}px, 0) scale(${scale})`,
                    transformOrigin: '0 0',
                  }}
                  className="w-full transition-transform duration-75"
                >
                  {renderLongStripContent()}
                </div>
              )}
            />
          </div>
        ) : (
          renderLongStripContent()
        )}

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
      {/* 内部测试模式顶部提示栏 */}
      <div className="bg-[#2B5E4A] text-[#FAF5E8] border border-[#153025] px-3 py-1.5 rounded-xs flex items-center justify-between text-xs font-retro-jp shadow-xs">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="font-pixel text-[#F9E79F]">🛠️ 内部研发预览模式（已解锁）</span>
          <span className="hidden sm:inline text-[#A3E4D7] text-[10px]">普通游客当前看到的是“研发中”页面</span>
        </div>
        <button
          onClick={() => {
            soundManager.playBlip();
            setIsDevUnlocked(false);
            onShowToast('已退出内部调试模式，恢复游客研发中视图 🔒');
          }}
          className="px-2 py-0.5 bg-[#142B21] hover:bg-[#0D1C16] text-[#F9E79F] text-[10px] font-pixel rounded-xs border border-[#3B7E64] cursor-pointer transition-colors"
        >
          重新锁定
        </button>
      </div>

      {/* 典藏公约红线轻量提示 */}
      <div className="p-2 px-3 bg-[#FBF0EE] border-l-3 border-[#C0392B] rounded-r-xs font-retro-jp text-[11px] text-[#900C3F] flex items-center justify-between gap-2">
        <div>
          <span className="font-bold">⚠️ 典藏公约：</span>
          本专区由利韩同好自发汉化嵌字。<b>严禁倒卖商用、严禁转传闲鱼微店</b>，请共同守护创作者的心血。
        </div>

        {/* COS 逻辑层状态指示徽章 */}
        <button
          onClick={() => {
            soundManager.playBlip();
            setShowCOSPanel(!showCosPanel);
          }}
          className="shrink-0 px-2 py-0.5 bg-[#FFFEEF] hover:bg-[#FAF5E8] border border-[#D5C9AF] text-[10px] font-pixel rounded-xs text-[#1E4334] cursor-pointer flex items-center gap-1 shadow-2xs"
          title="展开/折叠 腾讯云 COS 逻辑层与 S3 API 连接信息"
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              cosConnectionStatus === 'connected'
                ? 'bg-emerald-500 animate-pulse'
                : cosConnectionStatus === 'error'
                ? 'bg-rose-500'
                : 'bg-amber-500'
            }`}
          />
          <span>COS 状态</span>
          <span className="text-[8px]">{showCosPanel ? '▲' : '▼'}</span>
        </button>
      </div>

      {/* 腾讯云 COS S3 逻辑层状态与配置面板（可折叠） */}
      {showCosPanel && (
        <div className="bg-[#1E2621] text-[#FAF5E8] border-2 border-[#1E4334] rounded-md p-3 space-y-2.5 font-retro-jp text-xs shadow-md">
          <div className="flex items-center justify-between border-b border-[#34483B] pb-1.5">
            <div className="flex items-center gap-2">
              <span className="font-pixel text-xs text-[#F9E79F]">
                ⚡ 腾讯云 COS S3 API 逻辑层
              </span>
              <span className="px-1.5 py-0.2 bg-[#2B5E4A] text-[#F9E79F] font-pixel text-[9px] rounded-xs">
                AWS SDK / S3 API 已接入
              </span>
            </div>
            <button
              onClick={() => setShowCOSPanel(false)}
              className="text-[#A69C8E] hover:text-white px-1 text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
            <div className="space-y-1">
              <div className="text-[#A69C8E]">
                COS 地域 (Region):{' '}
                <span className="text-[#F9E79F] font-mono select-all">
                  {cosConfig.region || '待配置'}
                </span>
              </div>
              <div className="text-[#A69C8E]">
                存储桶名:{' '}
                <span className="text-[#F9E79F] font-mono select-all">
                  {cosConfig.bucketName || '待配置（含 APPID 后缀）'}
                </span>
              </div>
              <div className="text-[#A69C8E] truncate">
                S3 API 端点:{' '}
                <span className="text-[#F9E79F] font-mono select-all text-[10px]">
                  {cosConfig.s3ApiEndpoint}
                </span>
              </div>
              <div className="text-[#A69C8E]">
                存储规则:{' '}
                <span className="text-[#58D68D] font-mono">
                  lh-XXX/ 目录结构 (如 lh-001/image01.webp)
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-[#A69C8E] truncate">
                公开 CDN 基础链接:{' '}
                <input
                  type="text"
                  value={cosConfig.cdnBaseUrl}
                  onChange={(e) =>
                    handleSaveCosConfig({ cdnBaseUrl: e.target.value.trim() })
                  }
                  className="w-full mt-0.5 px-2 py-1 bg-[#141A17] border border-[#34483B] rounded-xs text-[#F9E79F] font-mono text-[10px] focus:outline-none focus:border-[#F9E79F]"
                  placeholder="https://doujin-archive-125xxxxxxx.cos.ap-guangzhou.myqcloud.com"
                />
              </div>
            </div>
          </div>

          {/* 状态与诊断操作 */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-dashed border-[#34483B] text-[10px]">
            <div className="flex items-center gap-1.5 text-[#C4B7A6]">
              <span className="font-bold">状态:</span>
              <span
                className={
                  cosConnectionStatus === 'connected'
                    ? 'text-[#58D68D] font-bold'
                    : cosConnectionStatus === 'error'
                    ? 'text-[#E74C3C] font-bold'
                    : 'text-[#F9E79F]'
                }
              >
                {cosStatusMessage}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleTestCosConnection}
                disabled={cosConnectionStatus === 'testing'}
                className="px-2.5 py-1 bg-[#2B5E4A] hover:bg-[#3B7E64] text-[#F9E79F] font-pixel text-[9px] rounded-xs cursor-pointer transition-all disabled:opacity-50"
              >
                {cosConnectionStatus === 'testing' ? '探测中...' : '📡 探测 COS 连通性'}
              </button>
              <button
                onClick={() => handleRefreshArchive(true)}
                disabled={isLoadingArchive}
                className="px-2.5 py-1 bg-[#B7791F] hover:bg-[#D4AC0D] text-[#1E2621] font-pixel text-[9px] rounded-xs font-bold cursor-pointer transition-all disabled:opacity-50"
              >
                {isLoadingArchive ? '同步中...' : '🔄 刷新归档数据'}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* 典藏本卡片网格：点击直接进入查看长图 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
                      <span className="px-1.5 py-0.2 bg-[#E8F8F5] text-[#117A65] border border-[#A3E4D7] text-[9px] font-pixel rounded-xs">
                        COS 存储
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

                  <span className="text-[9px] font-pixel text-[#B7791F] shrink-0 font-bold">
                    #{book.id}
                  </span>
                </div>

                {/* 封面图片展示区 (来源 腾讯云 COS CDN 链接映射，悬浮显示点击阅读长图) */}
                <div className="relative w-full aspect-[4/3] bg-[#FAF5E8] border border-[#E0D5BE] rounded-xs overflow-hidden group-hover:border-[#1E4334] flex items-center justify-center transition-colors">
                  <img
                    src={coverUrl}
                    alt={book.titleZh}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    onError={(e) => {
                      const target = e.currentTarget;
                      target.style.display = 'none';
                      const parent = target.parentElement;
                      if (parent) {
                        parent.classList.add('flex-col', 'p-2', 'text-center');
                        parent.innerHTML = `
                          <div class="text-xl">📖</div>
                          <div class="font-pixel text-[10px] text-[#1E4334] mt-1 font-bold">${book.titleZh}</div>
                          <div class="text-[9px] text-[#8C7A68] mt-0.5 font-mono">${book.bookFolder || book.id}/${book.coverFile || 'image01.webp'}</div>
                          <div class="text-[8px] text-[#B7791F] mt-0.5">点击进入长图画廊</div>
                        `;
                      }
                    }}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="px-3 py-1.5 bg-[#1E4334] text-[#F9E79F] font-pixel text-xs rounded-xs shadow-lg flex items-center gap-1">
                      <span>📖 点击阅读长图</span>
                      <span>→</span>
                    </span>
                  </div>
                </div>

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

      {filteredBooks.length === 0 && (
        <div className="p-8 text-center bg-[#FFFEEF] border border-dashed border-[#D5C9AF] rounded-md text-xs font-retro-jp text-[#8C7A68]">
          没有检索到符合条件的同人本，您可以清空搜索条件或调整分类～
        </div>
      )}
    </div>
  );
};
