import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { soundManager } from '../utils/audio';
import { getAccessToken } from '../utils/cloudbaseToken';
import { useAuthStore } from '../stores/authStore';
import { useAppShellStore } from '../stores/appShellStore';
import { ADMIN_UPLOAD_ENDPOINT, fetchBackend } from '../utils/cloudbaseEndpoint';
import { CardPatternOverlay } from './CardPatternOverlay';
import { normalizeShareLink } from '../utils/forumFormat';
import { Upload, Link as LinkIcon, DollarSign, User as UserIcon, AlertTriangle, Search, PlusCircle, X, ShieldAlert, CheckCircle2, Plus, Trash2, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

export interface MarketItem {
  id: string;
  type?: string;
  title: string;
  price: number;
  image: string;
  images?: string[];
  link: string;
  description: string;
  nickname: string;
  date: string;
}

interface Props {
  onCopyCode?: (code: string) => void;
  onShowToast: (msg: string) => void;
}

const STORAGE_KEY = 'levihan_market_items';

const api = async (action: string, fields: Record<string, unknown> = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'text/plain;charset=UTF-8' };
  const at = await getAccessToken();
  if (at) headers['Authorization'] = `Bearer ${at}`;
  const response = await fetchBackend(ADMIN_UPLOAD_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...fields }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || '服务暂不可用');
  return result;
};

/**
 * 市集初始数据：已清空内置样品卡片（原 5 条 init-* mock），
 * 列表完全以 admin-upload 云函数 marketList 返回的后端数据为准。
 * 保留导出是因为 RestaurantForum 还在用它作为 localStorage 兜底种子。
 */
export const INITIAL_MARKET_ITEMS: MarketItem[] = [];

/** 旧版本种进 localStorage 的样品卡片 id 前缀，加载时一律过滤掉 */
const LEGACY_MOCK_PREFIX = 'init-';

export const PotatoMarket: React.FC<Props> = ({ onShowToast }) => {
  const [items, setItems] = useState<MarketItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isPublishOpen, setIsPublishOpen] = useState<boolean>(false);
  const profile = useAuthStore((state) => state.profile);
  const autoNickname = profile?.nickname || '';
  const isUserLoggedIn = Boolean(profile);

  // 查看卡片详情弹窗
  const [selectedItem, setSelectedItem] = useState<MarketItem | null>(null);
  // 卡片详情弹窗内的图片轮播/切换索引
  const [activeDetailImageIndex, setActiveDetailImageIndex] = useState<number>(0);

  // 查看大图预览状态
  const [isPreviewLargeOpen, setIsPreviewLargeOpen] = useState<boolean>(false);

  // Form states inside modal
  const [formTitle, setFormTitle] = useState<string>('');
  const [formPrice, setFormPrice] = useState<string>('');
  const [formLink, setFormLink] = useState<string>('');
  const [formDesc, setFormDesc] = useState<string>('');
  const [formImages, setFormImages] = useState<string[]>([]);
  const [activeUploadPreviewIndex, setActiveUploadPreviewIndex] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load market items; account identity comes from the shared auth store.
  useEffect(() => {
    // 1. Load listings from localStorage or fallback（过滤旧版样品卡片 init-*）
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setItems(Array.isArray(parsed) ? parsed.filter((item: MarketItem) => !item.id?.startsWith(LEGACY_MOCK_PREFIX)) : []);
      } else {
        setItems(INITIAL_MARKET_ITEMS);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_MARKET_ITEMS));
      }
    } catch {
      setItems(INITIAL_MARKET_ITEMS);
    }

    // 1.5 从后端拉取市集商品，覆盖本地 mock
    void api('marketList')
      .then((result) => {
        if (Array.isArray(result.items) && result.items.length > 0) {
          setItems(result.items);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(result.items));
        }
      })
      .catch(() => undefined);

  }, []);

  // Sync to localStorage
  const saveItems = (updated: MarketItem[]) => {
    setItems(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  // Drag-and-drop & Manual upload handlers supporting up to 3 images
  const handleFiles = (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (list.length === 0) {
      onShowToast('⚠️ 请上传图片格式的文件');
      return;
    }

    const currentCount = formImages.length;
    if (currentCount >= 3) {
      onShowToast('⚠️ 最多只能上传 3 张图片哦');
      return;
    }

    const remainingSlots = 3 - currentCount;
    const toUpload = list.slice(0, remainingSlots);

    if (list.length > remainingSlots) {
      onShowToast(`⚠️ 抱歉，最多上传 3 张图片。已自动为您加载了前 ${remainingSlots} 张`);
    }

    toUpload.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormImages((prev) => {
          const updated = [...prev, reader.result as string];
          setActiveUploadPreviewIndex(updated.length - 1);
          return updated;
        });
        soundManager.playBlip();
      };
      reader.readAsDataURL(file);
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  // Submit listing
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const token = await getAccessToken();
    if (!token) {
      onShowToast('请先登录账号后再发布商品');
      useAppShellStore.getState().openLogin();
      return;
    }

    // Verification
    if (!formTitle.trim()) {
      onShowToast('⚠️ 请输入制品或闲置名称');
      return;
    }
    const priceNum = parseFloat(formPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      onShowToast('⚠️ 请输入合法的价格');
      return;
    }
    if (formImages.length === 0) {
      onShowToast('⚠️ 必须上传商品图片');
      return;
    }
    if (!formLink.trim()) {
      onShowToast('⚠️ 必须上传购买或交易外链');
      return;
    }
    // 与安利墙/市集表单同一套归一化：App 分享链接与裸域名都放行
    const normalizedMarketLink = normalizeShareLink(formLink);
    if (!normalizedMarketLink) {
      onShowToast('⚠️ 请粘贴网页链接或 App 分享链接（裸域名也行，会自动补 https）');
      return;
    }

    const finalNickname = autoNickname || '匿名同好';

    const newItem: MarketItem = {
      id: `item-${Date.now()}`,
      title: formTitle.trim(),
      price: priceNum,
      image: formImages[0], // fallback main cover
      images: formImages, // full array
      link: normalizedMarketLink,
      description: formDesc.trim() || '暂无详细描述。',
      nickname: finalNickname,
      date: new Date().toISOString().split('T')[0]
    };

    const updated = [newItem, ...items];
    saveItems(updated);
    soundManager.playSparkle();
    void api('marketPublish', {
      title: newItem.title,
      price: newItem.price,
      link: newItem.link,
      description: newItem.description,
      nickname: newItem.nickname,
      images: formImages,
    }).then((result) => {
      if (Array.isArray(result.items)) {
        setItems(result.items);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(result.items));
      }
    }).catch(() => undefined);
    onShowToast('🎉 发布成功！已同步至市集列表');

    // Reset Form & Close Modal
    setFormTitle('');
    setFormPrice('');
    setFormLink('');
    setFormDesc('');
    setFormImages([]);
    setActiveUploadPreviewIndex(0);
    setIsPublishOpen(false);
  };

  // Handle unlisting / deleting an item
  const handleDeleteItem = async (id: string) => {
    const token = await getAccessToken();
    if (!token) {
      onShowToast('请先登录账号后再下架商品');
      useAppShellStore.getState().openLogin();
      return;
    }
    const updated = items.filter((item) => item.id !== id);
    saveItems(updated);
    void api('marketDelete', { id }).then((result) => {
      if (Array.isArray(result.items)) {
        setItems(result.items);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(result.items));
      }
    }).catch((err) => onShowToast(err instanceof Error ? err.message : '下架失败'));
    soundManager.playSoftSwoosh();
    onShowToast('🗑️ 该物资已成功从市集下架！');
  };

  // Filter & Search computation
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.nickname.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  return (
    <div id="doujinshi-archive-root" className="space-y-4 text-[#2C241D] select-text pb-12 sm:pb-16">
      
      {/* 1. 顶部醒目的交易安全警告 (购买警告) */}
      <div className="relative py-3.5 px-4 bg-[#FFF0E8] border-2 border-dashed border-[#E67E22] rounded-xl font-retro-jp text-[12px] sm:text-xs text-[#5C2D13] shadow-xs overflow-hidden flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[#E67E22] font-black font-pixel">
          <ShieldAlert className="w-4.5 h-4.5 shrink-0" />
          <span>⚠️ 交易风险防范与安全警示（购买前必读）</span>
        </div>
        <div className="space-y-1.5 leading-relaxed text-[#784212]">
          <p>
            1. 本土豆市集仅作为<b>利韩同好自发制品流转交流平台</b>。本网站仅提供文字及图片信息展示，<b>不提供、不中介实际交易支付保障</b>。
          </p>
          <p>
            2. <b>绝对不要私下进行直接转账！</b>请务必走闲鱼（二手交易）、微店、淘宝、转转等具备<b>官方担保支付、退款保障</b>的专业交易平台。
          </p>
          <p>
            3. 所有同人制品严禁超额加价倒卖商用，请同好相互监督，共同营造有爱、安全的同好氛围。
          </p>
        </div>
      </div>

      {/* 2. 交互控制条：检索输入框 + 发布按钮 */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between bg-[#FFFEEF]/85 backdrop-blur-md rounded-xl p-3 shadow-2xs">
        
        {/* 搜索框与发布按钮组合 */}
        <div className="flex items-center gap-2 flex-1">
          {/* 搜索框 */}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C7A68]" />
            <input
              type="text"
              placeholder="搜名称、详情、发布人..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-8 py-1.5 text-xs font-retro-jp bg-[#FAF5E8] border border-[#BFA985] rounded-lg w-full focus:outline-none focus:border-[#1E4334] transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  soundManager.playSoftSwoosh();
                  setSearchQuery('');
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#8C7A68] hover:text-[#1E4334]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 发布物资按钮 */}
          <button
            onClick={() => {
              soundManager.playScrollOpen();
              setIsPublishOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#1E4334] hover:bg-[#2B5E4A] text-[#F9E79F] font-pixel text-xs rounded-lg cursor-pointer transition-all active:scale-95 shadow-sm whitespace-nowrap font-bold"
          >
            <PlusCircle className="w-4 h-4" />
            <span>发布市集物资</span>
          </button>
        </div>

      </div>

      {/* 3. 列表展示 (一行一个) */}
      <div className="flex flex-col gap-4 sm:gap-6 w-full max-w-lg mx-auto">
        {filteredItems.map((item) => (
          <div
            key={item.id}
            onClick={() => {
              soundManager.playCardClick();
              setSelectedItem(item);
              setActiveDetailImageIndex(0);
            }}
            className="relative bg-[#FFFEEF]/85 backdrop-blur-md border border-[#D5C9AF]/70 hover:border-[#8C6B38] rounded-xl p-4 sm:p-5 flex flex-col justify-between transition-all hover:shadow-lg group cursor-pointer select-none overflow-hidden space-y-3.5 shadow-sm"
          >
            {/* 80%不透明度的羊皮纸质感背景底图 */}
            <CardPatternOverlay opacity={0.80} />

            <div className="relative z-10 space-y-3">
              
              {/* 顶部标签 + 价格 */}
              <div className="flex items-center justify-between gap-1.5 flex-wrap">
                <span
                  className="font-pixel text-[10px] px-2 py-0.5 rounded-md font-bold whitespace-nowrap shadow-3xs bg-[#B7791F] text-white"
                >
                  🥔 市集物资
                </span>
                
                {/* 价格标签 */}
                <div className="flex items-center text-[#B7791F] font-black font-serif-title text-xs sm:text-sm bg-[#FAF5E8] px-2.5 py-0.5 rounded-md border border-[#DECFA9]">
                  <span>¥</span>
                  <span className="ml-0.5">{item.price}</span>
                </div>
              </div>

              {/* 制品标题 */}
              <h3 className="font-pixel text-sm sm:text-base font-bold text-[#2C2016] group-hover:text-[#B7791F] transition-colors line-clamp-2 leading-tight">
                {item.title}
              </h3>

              {/* 商品大图展示 (竖版/方版 宽高比：4:3) */}
              <div className="relative w-full aspect-[4/3] bg-[#FAF5E8] border border-[#E0D5BE] rounded-lg overflow-hidden flex items-center justify-center">
                <img
                  src={item.image}
                  alt={item.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-102"
                />
                
                {/* 悬浮查看详情引导 */}
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <span className="px-3.5 py-1.5 bg-[#FFFEEF] text-[#1E4334] rounded-lg text-xs font-pixel font-bold shadow-md flex items-center gap-1">
                    🔍 点击查看详情与交易
                  </span>
                </div>
              </div>

              {/* 制品描述 */}
              <p className="text-xs font-retro-jp text-[#5B4636] leading-relaxed line-clamp-2 bg-[#FAF5E8]/60 p-2.5 rounded-lg border border-[#EBE3D0]/50">
                {item.description}
              </p>

              {/* 发布者署名与发布日期 */}
              <div className="flex items-center justify-between gap-1.5 text-[11px] font-retro-jp text-[#8C7A68] border-t border-dashed border-[#E0D5BE] pt-2.5">
                <div className="flex items-center gap-1.5 max-w-[65%]">
                  <UserIcon className="w-3.5 h-3.5 text-[#8C6D4F]" />
                  <span className="font-bold text-[#5B4636] truncate" title={item.nickname}>
                    {item.nickname}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-[#A6937C]">{item.date}</span>
              </div>

              {/* 下架此物资 */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteItem(item.id);
                }}
                className="block w-full text-center py-1.5 bg-[#FFF0E8] hover:bg-[#F2D7D5] border border-[#E67E22]/60 hover:border-[#C0392B] rounded-lg text-[#78281F] font-pixel text-[10px] font-bold transition-all duration-200 active:scale-97 cursor-pointer"
              >
                🗑️ 下架此物资
              </button>

            </div>
          </div>
        ))}

        {filteredItems.length === 0 && (
          <div className="col-span-2 p-12 text-center bg-[#FFFEEF]/80 backdrop-blur-md border-2 border-dashed border-[#D5C9AF] rounded-2xl text-xs font-retro-jp text-[#8C7A68] w-full">
            🍵 报告长官！目前没有搜索到相应的物资发布，您可以清空搜索词，或自己发布首个宝贝吧！
          </div>
        )}
      </div>

      {/* 4. 发布物资弹窗 Modal */}
      {isPublishOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs transition-opacity animate-fade-in">
          <div
            className="relative w-full max-w-lg bg-[#FFFEEF] border-3 border-[#3F291B] rounded-2xl shadow-2xl p-5 sm:p-6 text-[#2C241D] overflow-hidden max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 羊皮纸背景纹理 */}
            <CardPatternOverlay opacity={0.80} />

            {/* 顶栏控制 */}
            <div className="relative z-10 flex items-center justify-between pb-3 border-b-2 border-[#3F291B] mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">🌾</span>
                <h2 className="font-pixel text-base sm:text-lg font-black text-[#3F291B]">发布同人制品/闲置物资</h2>
              </div>
              <button
                onClick={() => {
                  soundManager.playSoftSwoosh();
                  setIsPublishOpen(false);
                }}
                className="p-1 text-[#8C7A68] hover:text-[#7D291D] rounded-full hover:bg-black/5 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="relative z-10 space-y-4 font-retro-jp text-xs">
              
              {/* 商品名称 */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#5B4636]">
                  商品名称 <span className="text-[#C0392B]">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="例如：【利韩】「壁外调查」定制明信片组 / 自藏二手日版小说本"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-[#FAF5E8] border-2 border-[#D5C9AF] rounded-lg focus:outline-none focus:border-[#1E4334]"
                />
              </div>

              {/* 定价/让渡价 */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#5B4636]">
                  出让定价 (¥) <span className="text-[#C0392B]">*</span>
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C7A68]" />
                  <input
                    type="number"
                    required
                    min="0"
                    placeholder="请输入整数或小数"
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 bg-[#FAF5E8] border-2 border-[#D5C9AF] rounded-lg focus:outline-none focus:border-[#1E4334]"
                  />
                </div>
              </div>

              {/* 交易/购买外链 */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#5B4636] flex items-center gap-1">
                  <span>交易/参考详情链接</span>
                  <span className="text-[#C0392B]">*</span>
                </label>
                <div className="relative">
                  <LinkIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C7A68]" />
                  <input
                    type="text"
                    inputMode="url"
                    required
                    placeholder="链接或裸域名均可，App 分享链接也可以"
                    value={formLink}
                    onChange={(e) => setFormLink(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 bg-[#FAF5E8] border-2 border-[#D5C9AF] rounded-lg focus:outline-none focus:border-[#1E4334]"
                  />
                </div>
              </div>

              {/* 图片上传拖拽器 */}
              <div className="space-y-2">
                <label className="block font-bold text-[#5B4636] flex items-center justify-between">
                  <span>同人制品/闲置物资实物图片 (最多3张) <span className="text-[#C0392B]">*</span></span>
                  <span className="text-[10px] text-[#8C7A68] font-normal">已上传 {formImages.length}/3 张</span>
                </label>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept="image/*"
                  className="hidden"
                  multiple
                />

                {formImages.length > 0 ? (
                  <div 
                    className="relative w-full p-3 bg-[#FAF5E8] border-2 border-[#D5C9AF] rounded-xl flex flex-col gap-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Active Image Preview Container */}
                    <div className="flex flex-col items-center">
                      <div 
                        onClick={() => {
                          soundManager.playCardClick();
                          setIsPreviewLargeOpen(true);
                        }}
                        className="relative w-44 aspect-[4/3] rounded-lg overflow-hidden border-2 border-[#D5C9AF] shadow-2xs group cursor-zoom-in bg-[#FFFEEF]"
                        title="点击查看大图"
                      >
                        <img 
                          src={formImages[activeUploadPreviewIndex]} 
                          alt="主预览" 
                          className="w-full h-full object-cover" 
                        />
                        <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200">
                          <span className="p-1.5 bg-[#FFFEEF] rounded-full text-[#1E4334] mb-1 shadow-sm">
                            <Search className="w-3.5 h-3.5" />
                          </span>
                          <span className="text-[9px] text-white font-bold font-pixel">点击查看大图 🔍</span>
                        </div>
                      </div>
                    </div>

                    {/* Active Image Controls */}
                    <div className="flex items-center justify-between border-b border-dashed border-[#D5C9AF] pb-2 text-[10px]">
                      <span className="text-[#8C7A68]">
                        当前选择第 {activeUploadPreviewIndex + 1} 张图片
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            soundManager.playSoftSwoosh();
                            const indexToRemove = activeUploadPreviewIndex;
                            const filtered = formImages.filter((_, idx) => idx !== indexToRemove);
                            setFormImages(filtered);
                            // Adjust active index
                            if (filtered.length === 0) {
                              setActiveUploadPreviewIndex(0);
                            } else if (indexToRemove >= filtered.length) {
                              setActiveUploadPreviewIndex(filtered.length - 1);
                            }
                            onShowToast('🗑️ 已成功移除该图片');
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-pixel rounded-md transition-all cursor-pointer shadow-3xs font-bold"
                        >
                          <Trash2 className="w-3 h-3 text-red-600" />
                          <span>删除</span>
                        </button>
                      </div>
                    </div>

                    {/* Thumbnails Row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {formImages.map((img, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            soundManager.playCardClick();
                            setActiveUploadPreviewIndex(idx);
                          }}
                          className={`relative w-14 h-14 rounded-md overflow-hidden cursor-pointer transition-all border-2 ${
                            idx === activeUploadPreviewIndex
                              ? 'border-[#1E4334] shadow-xs scale-105'
                              : 'border-[#D5C9AF] hover:border-[#8C6B38]'
                          }`}
                        >
                          <img src={img} alt={`缩略图 ${idx}`} className="w-full h-full object-cover" />
                          
                          {/* Close button on thumbnail */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              soundManager.playSoftSwoosh();
                              const filtered = formImages.filter((_, i) => i !== idx);
                              setFormImages(filtered);
                              if (filtered.length === 0) {
                                setActiveUploadPreviewIndex(0);
                              } else if (activeUploadPreviewIndex >= filtered.length) {
                                setActiveUploadPreviewIndex(filtered.length - 1);
                              }
                              onShowToast('🗑️ 已成功移除该图片');
                            }}
                            className="absolute -top-1 -right-1 w-4 h-4 bg-[#7D291D] hover:bg-black text-white rounded-full flex items-center justify-center text-[8px] border border-white font-bold transition-colors shadow-3xs"
                            title="移除此图"
                          >
                            ×
                          </button>
                        </div>
                      ))}

                      {/* Add Button if < 3 */}
                      {formImages.length < 3 && (
                        <button
                          type="button"
                          onClick={() => {
                            soundManager.playScrollOpen();
                            fileInputRef.current?.click();
                          }}
                          className="w-14 h-14 rounded-md border-2 border-dashed border-[#D5C9AF] hover:border-[#1E4334] bg-[#FFFEEF] flex flex-col items-center justify-center text-center gap-0.5 cursor-pointer text-[#8C7A68] hover:text-[#1E4334] transition-all"
                          title="继续上传图片"
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-[8px] font-bold font-pixel">添加</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 ${
                      isDragging
                        ? 'border-[#B7791F] bg-[#FFF8E8]'
                        : 'border-[#D5C9AF] bg-[#FAF5E8] hover:border-[#1E4334]'
                    }`}
                  >
                    <Upload className="w-6 h-6 text-[#8C7A68]" />
                    <div>
                      <p className="font-bold text-[#5B4636]">拖拽图片至此，或点击本地上传</p>
                      <p className="text-[10px] text-[#A6937C] mt-0.5">支持 PNG, JPG, WEBP 格式，最多上传 3 张</p>
                    </div>
                  </div>
                )}
              </div>

              {/* 描述详情 */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#5B4636]">详细描述 (成色/尺码/特典情况)</label>
                <textarea
                  rows={2}
                  placeholder="请输入该制品的背景、材质，或者闲置宝贝的瑕疵、交易备注、发货时效等..."
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-[#FAF5E8] border-2 border-[#D5C9AF] rounded-lg focus:outline-none focus:border-[#1E4334] resize-none"
                />
              </div>

              {/* 发布人昵称（固定取账号昵称，不提供手动输入） */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#5B4636]">
                  发布者署名 <span className="text-[#C0392B]">*</span>
                </label>
                {isUserLoggedIn && autoNickname ? (
                  <div className="flex items-center gap-2 bg-[#EAECEE]/60 border-2 border-[#D5C9AF] px-3 py-2 rounded-lg text-[#5B4636] font-bold">
                    <UserIcon className="w-4 h-4 text-[#8C6D4F]" />
                    <span className="flex-1">{autoNickname}</span>
                    <span className="flex items-center gap-1 text-[10px] bg-[#27AE60] text-white px-2 py-0.5 rounded-full font-bold">
                      <CheckCircle2 className="w-3 h-3" />
                      已绑定登录账号
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-[#FFF8E8] border-2 border-[#E67E22]/50 px-3 py-2 rounded-lg text-[#B45309] font-bold">
                    <UserIcon className="w-4 h-4 text-[#E67E22]" />
                    <span className="flex-1">尚未登录</span>
                    <span className="text-[10px] font-normal text-[#92400E]">
                      请先点击右上角登录账号，发布将自动以账号昵称署名
                    </span>
                  </div>
                )}
              </div>

              {/* 弹窗底部风险同意与提交 */}
              <div className="pt-3 border-t border-dashed border-[#D5C9AF] space-y-3.5">
                {/* 迷你购买警告 */}
                <div className="flex items-start gap-1.5 bg-[#FFF0E8] p-2.5 rounded-lg border border-[#E67E22]/40 text-[#784212] text-[10.5px] leading-tight">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#E67E22] mt-0.5" />
                  <span>
                    <b>发布须知：</b>必须保证发布内容真实守信、严禁欺诈，<b>链接必须指向担保交易平台</b>（如闲鱼宝贝页），由于违规私下直接转账产生的纠纷需自行承担。
                  </span>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playSoftSwoosh();
                      setIsPublishOpen(false);
                    }}
                    className="px-4 py-2 bg-white hover:bg-[#FAF5E8] border-2 border-[#D5C9AF] text-[#5B4636] font-pixel text-xs rounded-lg cursor-pointer transition-all"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-[#1E4334] hover:bg-[#2B5E4A] text-[#F9E79F] font-pixel text-xs rounded-lg cursor-pointer transition-all active:scale-95 shadow-xs font-bold"
                  >
                    立即呈报发布
                  </button>
                </div>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* 5. 缩略图大图查看 Modal */}
      {isPreviewLargeOpen && formImages[activeUploadPreviewIndex] && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => {
            soundManager.playSoftSwoosh();
            setIsPreviewLargeOpen(false);
          }}
        >
          <div
            className="relative max-w-4xl max-h-[85vh] flex flex-col items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                soundManager.playSoftSwoosh();
                setIsPreviewLargeOpen(false);
              }}
              className="absolute -top-12 right-0 w-9 h-9 rounded-full bg-[#1A110A] text-[#F8FAFC] hover:bg-[#3D2C1F] flex items-center justify-center cursor-pointer border border-[#C5A059]/40 transition-colors shadow-md z-10 animate-pulse"
              title="关闭大图"
            >
              <X size={18} />
            </button>

            {/* Large Image display */}
            <div className="bg-[#FAF5EA] p-2 sm:p-3 rounded-2xl border-4 border-[#3F291B] shadow-2xl overflow-hidden flex items-center justify-center">
              <img
                src={formImages[activeUploadPreviewIndex]}
                alt="大图预览"
                className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-sm select-none"
              />
            </div>

            {/* Quick buttons under the large image */}
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  soundManager.playScrollOpen();
                  fileInputRef.current?.click();
                  setIsPreviewLargeOpen(false); // Auto close after triggering upload
                }}
                className="px-4 py-1.5 bg-[#B7791F] text-[#FFFEEF] font-pixel text-xs rounded-lg hover:bg-[#9E6515] transition-all cursor-pointer shadow-md flex items-center gap-1.5 font-bold"
              >
                🔄 重新上传
              </button>
              <button
                type="button"
                onClick={() => {
                  soundManager.playSoftSwoosh();
                  setIsPreviewLargeOpen(false);
                }}
                className="px-4 py-1.5 bg-[#1E4334] text-[#F9E79F] font-pixel text-xs rounded-lg hover:bg-[#2B5E4A] transition-all cursor-pointer shadow-md font-bold"
              >
                关闭大图
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 6. 商品详情弹窗 Modal */}
      {selectedItem && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => {
            soundManager.playSoftSwoosh();
            setSelectedItem(null);
          }}
        >
          <div
            className="relative w-full max-w-lg bg-[#FFFEEF] border-4 border-[#3F291B] rounded-2xl p-5 shadow-2xl flex flex-col space-y-4 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 羊皮纸背景纹理 */}
            <CardPatternOverlay opacity={0.65} />

            {/* 头部标题与徽章 */}
            <div className="relative z-10 flex items-start justify-between gap-3 border-b-2 border-[#3F291B] pb-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className="font-pixel text-[10px] px-2 py-0.5 rounded-md font-bold text-white shadow-3xs bg-[#B7791F]"
                  >
                    🥔 市集物资
                  </span>
                  <span className="text-[11px] font-mono text-[#A6937C]">{selectedItem.date}</span>
                </div>
                <h2 className="font-pixel text-base sm:text-lg font-black text-[#3F291B] leading-snug pr-4">
                  {selectedItem.title}
                </h2>
              </div>
              
              <button
                type="button"
                onClick={() => {
                  soundManager.playSoftSwoosh();
                  setSelectedItem(null);
                }}
                className="w-8 h-8 rounded-full bg-[#FAF5E8] text-[#5B4636] hover:bg-[#EBE3D0] border-2 border-[#3F291B] flex items-center justify-center cursor-pointer transition-colors shrink-0"
                title="关闭详情"
              >
                <X size={16} />
              </button>
            </div>

            {/* 商品大图与多图切换 */}
            <div className="relative z-10 space-y-3">
              {/* 大图容器 */}
              <div className="relative w-full aspect-[4/3] bg-[#FAF5E8] border-2 border-[#D5C9AF] rounded-xl overflow-hidden flex items-center justify-center shadow-2xs group">
                {(() => {
                  const itemImages = selectedItem.images && selectedItem.images.length > 0
                    ? selectedItem.images
                    : [selectedItem.image];
                  const currentImgSrc = itemImages[activeDetailImageIndex] || selectedItem.image;
                  
                  return (
                    <>
                      <img
                        src={currentImgSrc}
                        alt={selectedItem.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />

                      {/* 左右滑动指示器 (多于 1 张图片时展示) */}
                      {itemImages.length > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              soundManager.playCardClick();
                              setActiveDetailImageIndex((prev) => 
                                prev === 0 ? itemImages.length - 1 : prev - 1
                              );
                            }}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-[#1E4334] text-white flex items-center justify-center border border-white/20 transition-all cursor-pointer opacity-80 hover:opacity-100"
                            title="上一张"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              soundManager.playCardClick();
                              setActiveDetailImageIndex((prev) => 
                                prev === itemImages.length - 1 ? 0 : prev + 1
                              );
                            }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-[#1E4334] text-white flex items-center justify-center border border-white/20 transition-all cursor-pointer opacity-80 hover:opacity-100"
                            title="下一张"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                          
                          {/* 图片张数指示徽章 */}
                          <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded bg-black/60 text-white font-pixel text-[10px] tracking-wide">
                            {activeDetailImageIndex + 1} / {itemImages.length}
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* 多图缩略图列表行 (仅在有多张图片时显示) */}
              {selectedItem.images && selectedItem.images.length > 1 && (
                <div className="flex items-center gap-2 justify-center flex-wrap pt-0.5">
                  {selectedItem.images.map((imgSrc, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        soundManager.playCardClick();
                        setActiveDetailImageIndex(idx);
                      }}
                      className={`w-12 h-12 rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${
                        idx === activeDetailImageIndex
                          ? 'border-[#1E4334] scale-105 shadow-3xs'
                          : 'border-[#D5C9AF] opacity-75 hover:opacity-100'
                      }`}
                    >
                      <img src={imgSrc} alt={`缩略 ${idx}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 价格与发布信息 */}
            <div className="relative z-10 flex items-center justify-between bg-[#FAF5E8] p-3 rounded-xl border border-[#D5C9AF]/60">
              <div className="flex items-center text-[#B7791F]">
                <span className="font-serif-title text-xs font-black">售价：</span>
                <span className="font-serif-title text-xl sm:text-2xl font-black">¥{selectedItem.price}</span>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-[#5B4636] font-retro-jp">
                <UserIcon className="w-4 h-4 text-[#8C6D4F]" />
                <span className="font-bold">发布者: {selectedItem.nickname}</span>
              </div>
            </div>

            {/* 宝贝详细描述 */}
            <div className="relative z-10 space-y-1.5">
              <h4 className="font-pixel text-xs font-bold text-[#5B4636] flex items-center gap-1">
                📖 宝贝详情介绍
              </h4>
              <div className="p-3.5 bg-[#FAF5E8]/80 border border-[#D5C9AF]/55 rounded-xl text-xs font-retro-jp text-[#5B4636] leading-relaxed max-h-[140px] overflow-y-auto select-text scrollbar-thin">
                {selectedItem.description}
              </div>
            </div>

            {/* 弹窗底部操作按钮区 */}
            <div className="relative z-10 pt-3 border-t border-dashed border-[#D5C9AF] space-y-3">
              
              {/* 核心交易链接按钮 */}
              <a
                href={selectedItem.link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => soundManager.playWarpJump()}
                className="flex items-center justify-center gap-2 w-full py-3 bg-gradient-to-b from-[#1E4334] to-[#153025] hover:from-[#2B5E4A] hover:to-[#1E4334] border-2 border-[#1E4334] hover:border-[#2B5E4A] text-[#F9E79F] rounded-xl font-pixel text-sm font-black transition-all duration-200 active:scale-97 shadow-md"
              >
                前往交易看看详情 ➔
              </a>

              {/* 购买安全告知 */}
              <p className="text-[10px] font-retro-jp text-[#8C7A68] text-center leading-tight">
                ⚠️ 本市集不中介支付。点击按钮将打开第三方官方担保交易平台（如闲鱼/微店等）。绝对不要进行微信或支付宝私下直接转账！
              </p>
            </div>

          </div>
        </div>,
        document.body
      )}

    </div>
  );
};

export default PotatoMarket;
