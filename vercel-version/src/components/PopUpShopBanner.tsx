import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { SvgBaroqueCorner } from './PopUpShopDecorations';
import { soundManager } from '../utils/audio';
import { UiSprite } from './UiSprite';
import { PopupSketchOverlay } from './PopupSketchOverlay';
import { submitToInbox } from '../utils/submissionInbox';
import { ADMIN_UPLOAD_ENDPOINT } from '../utils/cloudbaseEndpoint';
import { CardPatternOverlay } from './CardPatternOverlay';

export interface AnnouncementItem {
  id: string;
  badge: string;
  badgeType: 'event' | 'archive' | 'doujin' | 'offline';
  title: string;
  subtitle: string;
  period: string;
  location: string;
  description: string;
  tags: string[];
  jumpTab?: string;
  jumpLabel?: string;
  detailContent: string[];
  author?: string;
  image?: string;
  link?: string;
}

// 公告内容完全由管理员后台提供；云端为空时展示“暂无公告”。
export const ANNOUNCEMENTS: AnnouncementItem[] = [];

// 韩吉端茶气泡台词（每次打开弹窗随机抽一句）
const HANGE_TEA_LINES = [
  '很好喝的茶呢～',
  '细则读完啦？真乖。',
  '茶要凉了，快去逛展吧',
  '展品都很可爱的哦',
  '下次再来陪我喝茶呀',
];

interface Props {
  onNavigateTab: (tabId: string) => void;
  onShowToast: (msg: string) => void;
  onOpenGameModal: () => void;
  onOpenRulesModal: () => void;
}

export const PopUpShopBanner: React.FC<Props> = ({
  onNavigateTab,
  onShowToast,
  onOpenGameModal,
  onOpenRulesModal,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState<AnnouncementItem | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>(ANNOUNCEMENTS);
  const [showProposal, setShowProposal] = useState(false);
  const [proposal, setProposal] = useState({ title: '', time: '', author: '', link: '', description: '' });
  const [proposalBusy, setProposalBusy] = useState(false);
  const [proposalImage, setProposalImage] = useState<File | null>(null);
  const [proposalPreview, setProposalPreview] = useState('');
  const [proposalCrop, setProposalCrop] = useState({ x: 50, y: 50, zoom: 1 });

  // 使用 ResizeObserver 动态获取公告栏卡片高度，确保趴趴始终位于卡片底部的 1/3 处
  const cardRef = useRef<HTMLDivElement>(null);
  const [boardHeight, setBoardHeight] = useState<number>(0);

  const currentItem = announcements[currentIndex];

  useEffect(() => {
    if (!cardRef.current) return;
    const element = cardRef.current;
    
    // 初始高度
    setBoardHeight(element.offsetHeight || element.clientHeight || 0);

    // 监听容器高度自适应变化（包含图片加载、文本折叠、屏幕缩放等）
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height;
        if (height > 0) {
          setBoardHeight(height);
        }
      }
    });

    ro.observe(element);
    return () => ro.disconnect();
  }, [currentItem]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(ADMIN_UPLOAD_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action: 'announcementList' }), signal: controller.signal,
    }).then((response) => response.ok ? response.json() : Promise.reject(new Error('公告读取失败')))
      .then((data: { items?: Array<{ id:string; tag:string; title:string; time?:string; author:string; link?:string; image?:string; description?:string }> }) => {
        if (!Array.isArray(data.items)) return;
        setAnnouncements(data.items.map((item) => ({
          id: item.id, badge: item.tag, badgeType: 'event', title: item.title,
          subtitle: '', period: item.time || '', location: item.author,
          description: item.description || '', tags: [], detailContent: [], author: item.author,
          image: item.image || '', link: item.link || '', jumpLabel: '立即推门阅览 ➜',
        })));
        setCurrentIndex(0);
      }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  // 每次打开弹窗换一句韩吉台词
  const hangeLine = useMemo(
    () => HANGE_TEA_LINES[Math.floor(Math.random() * HANGE_TEA_LINES.length)],
    [showDetailModal]
  );

  // 自动轮播切换
  useEffect(() => {
    if (isPaused || showDetailModal || announcements.length < 2) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % announcements.length);
    }, 5500);
    return () => clearInterval(timer);
  }, [isPaused, showDetailModal, announcements.length]);

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    soundManager.playWoodTap();
    if (announcements.length) setCurrentIndex((prev) => (prev - 1 + announcements.length) % announcements.length);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    soundManager.playWoodTap();
    if (announcements.length) setCurrentIndex((prev) => (prev + 1) % announcements.length);
  };

  const handleActionClick = (item: AnnouncementItem) => {
    soundManager.playScrollOpen();
    if (item.link) {
      if (/^https?:\/\//i.test(item.link)) window.open(item.link, '_blank', 'noopener,noreferrer');
      else window.location.assign(item.link);
      return;
    }
    if (item.jumpTab) {
      onNavigateTab(item.jumpTab);
    } else {
      setShowDetailModal(item);
    }
  };

  const submitProposal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!proposal.title.trim() || !proposal.author.trim() || !proposal.description.trim()) return onShowToast('请填写企划标题、发布人和企划宣传文本');
    setProposalBusy(true);
    try {
      let image = '';
      if (proposalImage && proposalPreview) {
        const cropped = await new Promise<string>((resolve, reject) => {
          const img = new Image(); img.onload = () => { try { const ratio=16/9; let sw=img.naturalWidth,sh=sw/ratio;if(sh>img.naturalHeight){sh=img.naturalHeight;sw=sh*ratio;}sw/=proposalCrop.zoom;sh/=proposalCrop.zoom;const sx=(img.naturalWidth-sw)*proposalCrop.x/100,sy=(img.naturalHeight-sh)*proposalCrop.y/100;const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=675;canvas.getContext('2d')!.drawImage(img,sx,sy,sw,sh,0,0,1200,675);resolve(canvas.toDataURL('image/webp',.86).split(',')[1]||''); } catch(error){reject(error);} }; img.onerror=reject; img.src=proposalPreview;
        });
        const response = await fetch(ADMIN_UPLOAD_ENDPOINT,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'announcementImageUpload',imageBase64:cropped})});
        const result=await response.json(); if(!response.ok||!result.ok)throw new Error(result.error||'图片上传失败'); image=result.url;
      }
      await submitToInbox('submitAnnouncement', { ...proposal, image, tag: '利韩企划' });
      if (proposalPreview) URL.revokeObjectURL(proposalPreview);
      setProposal({ title: '', time: '', author: '', link: '', description: '' }); setProposalImage(null); setProposalPreview(''); setProposalCrop({x:50,y:50,zoom:1});
      setShowProposal(false);
      onShowToast('企划已提交，管理员审核通过后会显示在公告栏');
    } catch (error) {
      onShowToast(error instanceof Error ? error.message : '企划提交失败');
    } finally { setProposalBusy(false); }
  };

  return (
    <div className="relative w-full h-full min-h-0 select-none flex flex-col justify-end">
      {/* 复古银金属与晶莹玻璃公告画卷主体 */}
      <div
        className="relative w-full h-full rounded-2xl overflow-hidden silver-retro-frame glass-reflection-overlay transition-all duration-300 flex flex-col justify-between"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onTouchStart={() => setIsPaused(true)}
        onTouchEnd={() => setIsPaused(false)}
      >
        <CardPatternOverlay opacity={0.12} mode="multiply" />
        
        {/* 四角复古银金属雕花角饰与金属铆钉 */}
        <div className="absolute top-1 left-1 z-20 pointer-events-none"><SvgBaroqueCorner position="top-left" size={22} theme="silver" /></div>
        <div className="absolute top-1 right-1 z-20 pointer-events-none"><SvgBaroqueCorner position="top-right" size={22} theme="silver" /></div>
        <div className="absolute bottom-1 left-1 z-20 pointer-events-none"><SvgBaroqueCorner position="bottom-left" size={22} theme="silver" /></div>
        <div className="absolute bottom-1 right-1 z-20 pointer-events-none"><SvgBaroqueCorner position="bottom-right" size={22} theme="silver" /></div>

        {/* ====================================================
            公告宣传画卷核心信息栏 (透光玻璃微磨砂层)
           ==================================================== */}
        <div className="relative z-10 h-full min-h-0 p-2 sm:p-2.5 pt-2 sm:pt-2.5 flex flex-col justify-between">
          <div
            ref={cardRef}
            onClick={() => {
              if (currentItem) {
                soundManager.playWoodTap();
                setShowDetailModal(currentItem);
              }
            }}
            className="flex-1 min-h-0 relative bg-white/70 backdrop-blur-md rounded-xl p-2.5 sm:p-3 border border-white/60 shadow-[inset_0_1px_2px_rgba(255,255,255,0.9)] flex flex-col justify-between cursor-pointer group"
          >
            <CardPatternOverlay opacity={0.08} mode="multiply" />

            {/* ====================================================
                韩吉与利威尔趴趴：使用 ResizeObserver 实时计算高度，严格对齐在公告栏底部的 1/3 处
               ==================================================== */}
            <div
              className="pwa-peek-anchor-third"
              style={{
                bottom: boardHeight > 0 ? `${boardHeight / 3}px` : '33.333%',
                transform: 'translate(-50%, 50%)',
              }}
              aria-label="LEVI 与 HANS 1/3 边框趴趴装饰"
            >
              <div className="pwa-peek-dock">
                <UiSprite
                  name="levi-peek"
                  width={42}
                  role="img"
                  label="利威尔趴趴"
                  className="pwa-peek-sprite-levi"
                />
                <span className="pwa-peek-badge">
                  LEVI<span className="mx-1 text-[#8C6226]">✖</span>HANS
                </span>
                <UiSprite
                  name="hange-peek"
                  width={40}
                  role="img"
                  label="韩吉趴趴"
                  className="pwa-peek-sprite-hange"
                />
              </div>
            </div>

            {!currentItem ? <div className="flex-1 flex flex-col items-center justify-center text-center text-[#8C7A65]"><span className="text-xl">📜</span><p className="mt-1 font-serif-title font-bold text-xs">暂无公告</p></div> : <>
            <div className="flex-1 min-h-0 flex flex-col gap-1 sm:gap-1.5">
              {currentItem.image && (
                <img src={currentItem.image} alt="" className="w-full aspect-video max-h-20 sm:max-h-24 object-cover rounded-lg border border-[#D5C19A] shadow-xs" />
              )}
              {/* 企划标题与分类标签 */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-serif-title text-[9px] sm:text-[10px] font-black text-[#16273B] bg-[#F4EADB] border border-[#C5A059] px-1.5 py-0.5 rounded-xs">
                  {currentItem.badge}
                </span>
                <span className="font-mincho text-xs sm:text-sm font-bold text-[#1A1817] truncate">
                  {currentItem.title}
                </span>
              </div>

              {/* 展期与地点提示 */}
              <div className="flex items-center gap-2 text-[9px] sm:text-[10px] text-[#715431]">
                <span className="flex items-center gap-0.5">
                  <Calendar className="w-3 h-3 text-[#A67C33]" />
                  <span>{currentItem.period || '常设公告'}</span>
                </span>
                <span className="text-[#D4AF37]">|</span>
                <span className="truncate">{currentItem.location}</span>
              </div>

              {/* 简短描述：弹性占据剩余高度，文字自然铺满 */}
              {currentItem.description && <p className="text-[10px] sm:text-[11px] text-[#4A4036] line-clamp-2 leading-relaxed font-sans flex-1 min-h-0">{currentItem.description}</p>}

              {/* 展出细则 + 投递企划小字 */}
              <div className="flex items-center justify-between pt-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    soundManager.playWoodTap();
                    setShowDetailModal(currentItem);
                  }}
                  className="text-[10px] sm:text-[11px] text-[#8C6226] hover:text-[#16273B] hover:underline cursor-pointer flex items-center gap-1 transition-colors whitespace-nowrap font-bold"
                  title="查看展出细则"
                >
                  <Info className="w-3 h-3 text-[#8C6226]" />
                  <span>展出细则 📖</span>
                </button>
                {currentItem.link ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      soundManager.playWoodTap();
                      handleActionClick(currentItem);
                    }}
                    className="px-2.5 py-0.5 bg-[#1E4334] text-[#F9E79F] border border-[#C5A059] rounded-md text-[9px] sm:text-[10px] font-bold"
                  >
                    立即推门阅览 ➜
                  </button>
                ) : (
                  <span className="font-retro-jp text-[8px] sm:text-[9px] text-[#285A46]/70 tracking-wider whitespace-nowrap">
                    发布人：{currentItem.author || currentItem.location}
                  </span>
                )}
              </div>
            </div>

            {/* 轮播底部分页控制器与左右微按键 (卡片下方 1/3 边框分界线) */}
            <div
              className="flex items-center justify-between pt-1 mt-1 border-t border-[#EAE0CD]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 轮播点状指示器 */}
              <div className="flex items-center gap-1.5">
                {announcements.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      soundManager.playWoodTap();
                      setCurrentIndex(idx);
                    }}
                    className={`h-1.5 sm:h-2 rounded-full transition-all duration-300 cursor-pointer ${
                      currentIndex === idx
                        ? 'w-5 sm:w-6 bg-[#16273B] shadow-xs'
                        : 'w-1.5 sm:w-2 bg-[#D5C19A] hover:bg-[#B39362]'
                    }`}
                    title={item.title}
                  />
                ))}
              </div>

              {/* 官方授权与同好版权标记 */}
              <div className="text-[8px] sm:text-[9px] text-[#8C7A65] font-serif-title tracking-tight hidden xs:block">
                © 諫山創・講談社／「進撃の巨人」製作委員会 联名同好展
              </div>

              {/* 左右翻页控制器 */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handlePrev}
                  className="w-5 h-5 rounded-full bg-[#F4EADB] hover:bg-[#EAE0CD] text-[#16273B] border border-[#C5A059] flex items-center justify-center cursor-pointer active:scale-90 transition-all shadow-2xs"
                  title="上一篇"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  className="w-5 h-5 rounded-full bg-[#F4EADB] hover:bg-[#EAE0CD] text-[#16273B] border border-[#C5A059] flex items-center justify-center cursor-pointer active:scale-90 transition-all shadow-2xs"
                  title="下一篇"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
            </>}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                soundManager.playWoodTap();
                setShowProposal(true);
              }}
              className="mt-0.5 self-end text-[9px] sm:text-[10px] text-[#8C7A65] hover:text-[#1E4334] cursor-pointer"
            >
              投递利韩企划
            </button>
          </div>
        </div>
      </div>

      {/* ====================================================
          4. 展品细则弹窗 (Detail Modal - 卷轴展开特效 + 韩吉彩蛋)
         ==================================================== */}
      {typeof document !== 'undefined' && showDetailModal && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3"
          onClick={() => {
            soundManager.playWoodTap();
            setShowDetailModal(null);
          }}
        >
          <div
            className="relative w-full max-w-md text-[#1E4334] drop-shadow-2xl select-none"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 关闭按钮（固定在卷轴外层，不随纸面滚动） */}
            <button
              type="button"
              onClick={() => {
                soundManager.playWoodTap();
                setShowDetailModal(null);
              }}
              className="absolute top-4 right-3 z-30 w-7 h-7 bg-[#1E4334] text-[#F4EADB] rounded-full flex items-center justify-center text-xs font-bold hover:bg-[#2C5C46] cursor-pointer shadow-xs"
              title="收起卷轴"
            >
              ✕
            </button>

            {/* 顶轴（固定不动） */}
            <div className="rules-scroll-rod z-20 w-full" aria-hidden="true" />

            {/* 卷轴纸面：自上而下展开 */}
            <div className="rules-scroll-paper relative z-10 mx-3 px-4 sm:px-5 pt-4 pb-5 max-h-[70dvh] overflow-y-auto">
              <PopupSketchOverlay />
              <div className="relative flex items-center gap-2 border-b-2 border-[#C5A059] pb-2 mb-3 pr-8">
                <span className="text-xl">✨</span>
                <span className="font-serif-title font-bold text-sm sm:text-base">
                  {showDetailModal.title}
                </span>
              </div>

              {/* 展开后只有一张卡片上面写文本 */}
              <div className="space-y-2.5 text-xs sm:text-sm text-[#4A4036] leading-relaxed">
                {showDetailModal.detailContent.map((para, i) => (
                  <p key={i} className="leading-relaxed">
                    {para}
                  </p>
                ))}
              </div>

              {/* 底部彩蛋：韩吉端茶简笔画 + 台词气泡 + 跳转按钮（所有公告展开后的默认界面） */}
              <figure className="rules-scroll-hange relative mt-4 pt-3 border-t border-dashed border-[#C5A059] flex items-center justify-center gap-3 flex-wrap">
                <img
                  src="/images/rules-hange-tea.png"
                  alt="端着茶杯淡定喝茶的像素简笔画"
                  className="pixel-art w-20 sm:w-24 shrink-0 cursor-pointer transition-transform active:scale-90"
                  title="点我试试"
                  onClick={() => onShowToast('☕ 韩吉：细则都背下来了？展品可不会自己跑掉，快去逛展吧！')}
                />
                {/* 台词气泡（指向左侧人物） */}
                <div className="relative bg-[#FAF6ED] border-2 border-[#1E4334] rounded-xl px-3 py-1.5 font-retro-jp text-[11px] text-[#1E4334] leading-snug max-w-[9.5rem] shadow-xs">
                  {hangeLine}
                  <span
                    className="absolute top-1/2 -translate-y-1/2 -left-[7px] w-3 h-3 bg-[#FAF6ED] border-l-2 border-b-2 border-[#1E4334] rotate-45"
                    aria-hidden="true"
                  />
                </div>
                {(showDetailModal.link || showDetailModal.jumpTab) && <button
                  type="button"
                  onClick={() => {
                    soundManager.playWoodTap();
                    const target = showDetailModal;
                    setShowDetailModal(null);
                    handleActionClick(target);
                  }}
                  className="px-4 py-1.5 bg-[#1E4334] hover:bg-[#2C5C46] text-[#F9E79F] border border-[#C5A059] rounded-lg font-bold text-xs hover:scale-102 active:scale-95 transition-all cursor-pointer shadow-md flex items-center gap-1.5 whitespace-nowrap"
                >
                  <span>{showDetailModal.jumpLabel || '自由跳转 ➜'}</span>
                </button>}
              </figure>
            </div>

            {/* 底轴（随纸面展开下落） */}
            <div className="rules-scroll-rod rules-scroll-rod-bottom z-20 w-full" aria-hidden="true" />
          </div>
        </div>,
        document.body
      )}
      {typeof document !== 'undefined' && showProposal && createPortal(
        <div
          className="fixed inset-0 z-[110] bg-black/55 flex items-center justify-center p-3"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              soundManager.playWoodTap();
              setShowProposal(false);
            }
          }}
        >
          <form onSubmit={submitProposal} className="relative w-full max-w-lg rounded-xl border-2 border-[#1E4334] bg-[#FBF7EC] p-4 space-y-3 shadow-2xl overflow-hidden">
            <PopupSketchOverlay />
            <div className="relative flex justify-between">
              <div>
                <h3 className="font-serif-title font-bold text-[#1E4334]">投递利韩企划</h3>
                <p className="text-xs text-[#8C7A65]">投递范围包括但不限于，only展、接力活动、庆生活动等等。</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  soundManager.playWoodTap();
                  setShowProposal(false);
                }}
                className="cursor-pointer"
              >
                ✕
              </button>
            </div>
            <label className="block text-xs font-bold">标签<input value="利韩企划" disabled className="mt-1 w-full p-2 border rounded bg-[#EEE8D8]" /></label>
            <label className="block text-xs font-bold">标题 *<input value={proposal.title} onChange={(e) => setProposal({...proposal,title:e.target.value})} maxLength={100} className="mt-1 w-full p-2 border rounded" required /></label>
            <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-bold">时间（选填）<input type="date" value={proposal.time} onChange={(e) => setProposal({...proposal,time:e.target.value})} className="mt-1 w-full p-2 border rounded" /></label><label className="block text-xs font-bold">发布人 *<input value={proposal.author} onChange={(e) => setProposal({...proposal,author:e.target.value})} className="mt-1 w-full p-2 border rounded" required /></label></div>
            <label className="block text-xs font-bold">跳转链接（选填）<input type="url" value={proposal.link} onChange={(e) => setProposal({...proposal,link:e.target.value})} className="mt-1 w-full p-2 border rounded" /></label>
            <label className="block text-xs font-bold">企划宣传文本 *<textarea value={proposal.description} onChange={(e) => setProposal({...proposal,description:e.target.value})} rows={4} maxLength={2000} className="mt-1 w-full p-2 border rounded" required /></label>
            <label className="block text-xs font-bold">上传图片（选填，固定 16:9）<input type="file" accept="image/*" onChange={(e)=>{const file=e.target.files?.[0]||null;if(proposalPreview)URL.revokeObjectURL(proposalPreview);setProposalImage(file);setProposalPreview(file?URL.createObjectURL(file):'');}} className="mt-1 w-full p-2 border rounded bg-white" /></label>
            {proposalPreview && <div className="space-y-2"><div className="aspect-video overflow-hidden rounded border-2 border-[#C5A059] bg-[#E8E0CB]"><img src={proposalPreview} alt="企划图片裁切预览" className="w-full h-full object-cover" style={{objectPosition:`${proposalCrop.x}% ${proposalCrop.y}%`,transform:`scale(${proposalCrop.zoom})`}} /></div><div className="grid grid-cols-3 gap-2 text-[10px]"><label>左右<input type="range" min="0" max="100" value={proposalCrop.x} onChange={(e)=>setProposalCrop({...proposalCrop,x:Number(e.target.value)})} className="w-full"/></label><label>上下<input type="range" min="0" max="100" value={proposalCrop.y} onChange={(e)=>setProposalCrop({...proposalCrop,y:Number(e.target.value)})} className="w-full"/></label><label>缩放<input type="range" min="1" max="2" step="0.05" value={proposalCrop.zoom} onChange={(e)=>setProposalCrop({...proposalCrop,zoom:Number(e.target.value)})} className="w-full"/></label></div></div>}
            <button disabled={proposalBusy} className="w-full py-2 bg-[#1E4334] text-[#F9E79F] rounded font-bold disabled:opacity-50">{proposalBusy ? '提交中…' : '提交审核'}</button>
          </form>
        </div>, document.body
      )}
    </div>
  );
};
