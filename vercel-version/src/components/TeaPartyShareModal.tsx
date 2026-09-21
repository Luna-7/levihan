import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Copy,
  Check,
  Download,
  Image as ImageIcon,
  ExternalLink,
  QrCode,
  Share2
} from 'lucide-react';
import QRCode from 'qrcode';
import { toPng } from 'html-to-image';
import { soundManager } from '../utils/audio';
import { CardPatternOverlay } from './CardPatternOverlay';
import { CharacterArt, externalArtworkUrl } from './CharacterArt';
import { ForumPost, PostCategory } from './RestaurantForum';
import { MarketItem } from './PotatoMarket';

export interface ShareTargetData {
  type: 'post' | 'market' | 'general';
  post?: ForumPost;
  marketItem?: MarketItem;
  category?: PostCategory | 'all';
  customTitle?: string;
  customSummary?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  target: ShareTargetData | null;
  onShowToast: (message: string) => void;
}

const CATEGORY_NAMES: Record<string, string> = {
  all: '兵长茶会',
  chat: '闲聊茶歇',
  links: '安利墙',
  roleplay: '角色拟音',
  relay: '故事接龙',
  market: '土豆市集',
};

export const TeaPartyShareModal: React.FC<Props> = ({
  isOpen,
  onClose,
  target,
  onShowToast,
}) => {
  const [showPosterPreview, setShowPosterPreview] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [copiedText, setCopiedText] = useState<boolean>(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [isGeneratingPoster, setIsGeneratingPoster] = useState<boolean>(false);

  const posterRef = useRef<HTMLDivElement>(null);

  // 计算分享直达深度链接 (Deep Link)
  const shareUrl = React.useMemo(() => {
    if (typeof window === 'undefined') return '';
    const base = window.location.origin + window.location.pathname;
    const url = new URL(base);
    url.searchParams.set('tab', 'doujinshi');

    if (!target) return url.toString();

    if (target.type === 'post' && target.post) {
      url.searchParams.set('category', target.post.category);
      url.searchParams.set('postId', target.post.id);
    } else if (target.type === 'market' && target.marketItem) {
      url.searchParams.set('category', 'market');
      url.searchParams.set('itemId', target.marketItem.id);
    } else if (target.category && target.category !== 'all') {
      url.searchParams.set('category', target.category);
    }
    return url.toString();
  }, [target]);

  // 整理分享内容摘要（极简提炼）
  const shareDetails = React.useMemo(() => {
    if (!target) {
      return {
        title: '兵长茶会 · 调查兵团地下交流所',
        summary: '利韩专属交流粮仓：闲聊茶歇、角色拟音、故事接龙与土豆市集！',
        author: '调查兵团',
        image: '/images/characters/levi_tea.jpg',
        badge: '☕ 兵长茶会',
      };
    }

    if (target.type === 'post' && target.post) {
      const p = target.post;
      const catName = CATEGORY_NAMES[p.category] || '茶会发言';
      const title =
        p.title ||
        (p.category === 'roleplay'
          ? `【语C】${p.characterName || p.author} 的茶会台词`
          : `【${catName}】${p.author} 的发言`);
      const summary = p.body.slice(0, 100) + (p.body.length > 100 ? '...' : '');
      const img = p.image || p.characterImage || '/images/characters/levi_tea.jpg';

      return {
        title,
        summary,
        author: p.characterName || p.author,
        image: img,
        badge: catName,
      };
    }

    if (target.type === 'market' && target.marketItem) {
      const m = target.marketItem;
      return {
        title: `【市集】${m.title} (¥${m.price})`,
        summary: m.description.slice(0, 80) + (m.description.length > 80 ? '...' : ''),
        author: m.nickname,
        image: m.image || '/images/characters/levi_tea.jpg',
        badge: '🥔 土豆市集',
      };
    }

    const catName = CATEGORY_NAMES[target.category || 'all'] || '兵长茶会';
    return {
      title: `兵长茶会 · ${catName}`,
      summary: '利韩专属交流粮仓：闲聊茶歇、角色拟音、故事接龙与土豆市集！',
      author: '利韩土豆仓',
      image: '/images/characters/levi_tea.jpg',
      badge: catName,
    };
  }, [target]);

  // 生成二维码
  useEffect(() => {
    if (!isOpen || !shareUrl) return;
    QRCode.toDataURL(shareUrl, {
      margin: 1,
      width: 120,
      color: {
        dark: '#1E4334',
        light: '#FFFDF6',
      },
    })
      .then((url) => setQrCodeUrl(url))
      .catch((err) => console.error('QR code error', err));
  }, [isOpen, shareUrl]);

  // 生成完整卡片文案
  const fullShareText = React.useMemo(() => {
    return `${shareDetails.title}\n“${shareDetails.summary}”\n—— 来自《利韩土豆仓·兵长茶会》\n➔ 点击直达：${shareUrl}`;
  }, [shareDetails, shareUrl]);

  // 复制链接
  const handleCopyLink = () => {
    soundManager.playCoin();
    navigator.clipboard.writeText(shareUrl).then(
      () => {
        setCopiedLink(true);
        onShowToast('已复制直达链接！📋');
        setTimeout(() => setCopiedLink(false), 2000);
      },
      () => onShowToast(`直达链接：${shareUrl}`)
    );
  };

  // 复制卡片口例文案
  const handleCopyText = () => {
    soundManager.playCoin();
    navigator.clipboard.writeText(fullShareText).then(
      () => {
        setCopiedText(true);
        onShowToast('已复制完整分享文案！📝');
        setTimeout(() => setCopiedText(false), 2000);
      },
      () => onShowToast('复制失败')
    );
  };

  // 唤起原生分享 API
  const handleNativeShare = async () => {
    soundManager.playActionClick();
    if (navigator.share) {
      try {
        await navigator.share({
          title: shareDetails.title,
          text: `${shareDetails.summary} —— 来自兵长茶会`,
          url: shareUrl,
        });
        onShowToast('已呼起系统分享');
      } catch {
        // 用户取消无需提示
      }
    } else {
      handleCopyText();
    }
  };

  // 微博一键分享
  const handleShareToWeibo = () => {
    soundManager.playActionClick();
    const weiboText = encodeURIComponent(
      `#利韩# #兵长茶会# ${shareDetails.title}：${shareDetails.summary}`
    );
    const weiboUrl = encodeURIComponent(shareUrl);
    const weiboPic = encodeURIComponent(
      shareDetails.image.startsWith('http')
        ? externalArtworkUrl(shareDetails.image)
        : `${window.location.origin}${externalArtworkUrl(shareDetails.image)}`
    );
    window.open(
      `https://service.weibo.com/share/share.php?url=${weiboUrl}&title=${weiboText}&pic=${weiboPic}&searchPic=true`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  // QQ 分享
  const handleShareToQQ = () => {
    soundManager.playActionClick();
    const qqTitle = encodeURIComponent(shareDetails.title);
    const qqSummary = encodeURIComponent(shareDetails.summary);
    const qqUrl = encodeURIComponent(shareUrl);
    const qqPic = encodeURIComponent(
      shareDetails.image.startsWith('http')
        ? externalArtworkUrl(shareDetails.image)
        : `${window.location.origin}${externalArtworkUrl(shareDetails.image)}`
    );
    window.open(
      `https://connect.qq.com/widget/shareqq/index.html?url=${qqUrl}&title=${qqTitle}&summary=${qqSummary}&pics=${qqPic}&site=${encodeURIComponent('利韩土豆仓')}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  // 保存海报
  const handleDownloadPoster = async () => {
    if (!posterRef.current) return;
    try {
      soundManager.playActionClick();
      setIsGeneratingPoster(true);
      onShowToast('正在生成海报... 🎨');

      const dataUrl = await toPng(posterRef.current, {
        cacheBust: true,
        pixelRatio: 2.2,
        backgroundColor: '#FAF3E3',
      });

      const link = document.createElement('a');
      link.download = `兵长茶会_${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      onShowToast('海报已保存！✨');
    } catch (err) {
      console.error('Poster generation failed', err);
      onShowToast('生成失败，请重试');
    } finally {
      setIsGeneratingPoster(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[420px] bg-[#FFFDF6] border-2 border-[#8C6D4F] rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.35)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <CardPatternOverlay opacity={0.05} mode="multiply" />

        {/* 极简顶栏 */}
        <div className="relative z-10 px-4 py-3 bg-[#1E4334] text-[#F9E79F] flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm font-serif-title">
            <span>☕</span>
            <span>分享茶会</span>
          </div>
          <button
            type="button"
            onClick={() => {
              soundManager.playNavClick();
              onClose();
            }}
            className="p-1 rounded-lg hover:bg-white/15 text-[#F9E79F] transition-colors cursor-pointer"
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* 极简内容区 */}
        <div className="relative z-10 p-4 space-y-3.5">
          {/* 紧凑卡片预览 */}
          <div className="p-2.5 bg-[#FAF3E3] border border-[#D5C19A] rounded-xl flex items-center gap-3">
            <CharacterArt
              src={shareDetails.image}
              alt="封面"
              fit="cover"
              className="w-12 h-12 rounded-lg border border-[#8C6D4F]/30 bg-[#EFE3CD] shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="px-1.5 py-0.2 bg-[#1E4334] text-[#F9E79F] rounded-xs text-[9px] font-bold">
                  {shareDetails.badge}
                </span>
                <span className="text-[11px] text-[#8C6D4F] truncate">
                  {shareDetails.author}
                </span>
              </div>
              <h4 className="font-serif-title text-xs font-bold text-[#2C2016] truncate mt-0.5">
                {shareDetails.title}
              </h4>
            </div>
          </div>

          {/* 链接直达复制条 */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={shareUrl}
              className="flex-1 px-3 py-2 text-xs bg-[#FAF5E8] text-[#3E342B] border border-[#C5B295] rounded-xl outline-none select-all font-mono truncate"
            />
            <button
              type="button"
              onClick={handleCopyLink}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 shrink-0 ${
                copiedLink
                  ? 'bg-[#1E4334] text-[#F9E79F]'
                  : 'bg-[#8C6D4F] hover:bg-[#72573E] text-white'
              }`}
            >
              {copiedLink ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedLink ? '已复制' : '复制链接'}</span>
            </button>
          </div>

          {/* 4 大快捷操作图标按钮 */}
          <div className="grid grid-cols-4 gap-2 pt-1">
            <button
              type="button"
              onClick={handleNativeShare}
              className="p-2.5 rounded-xl bg-[#FAF3E3] hover:bg-[#F0E6D2] border border-[#DECDB3] text-[#1E4334] flex flex-col items-center gap-1 cursor-pointer transition-transform active:scale-95"
            >
              <span className="text-base">🟢</span>
              <span className="text-[11px] font-bold">微信 / 系统</span>
            </button>

            <button
              type="button"
              onClick={handleShareToWeibo}
              className="p-2.5 rounded-xl bg-[#FAF3E3] hover:bg-[#F0E6D2] border border-[#DECDB3] text-[#DC2626] flex flex-col items-center gap-1 cursor-pointer transition-transform active:scale-95"
            >
              <span className="text-base">🔴</span>
              <span className="text-[11px] font-bold">微博</span>
            </button>

            <button
              type="button"
              onClick={handleShareToQQ}
              className="p-2.5 rounded-xl bg-[#FAF3E3] hover:bg-[#F0E6D2] border border-[#DECDB3] text-[#0284C7] flex flex-col items-center gap-1 cursor-pointer transition-transform active:scale-95"
            >
              <span className="text-base">🐧</span>
              <span className="text-[11px] font-bold">QQ 空间</span>
            </button>

            <button
              type="button"
              onClick={handleCopyText}
              className="p-2.5 rounded-xl bg-[#FAF3E3] hover:bg-[#F0E6D2] border border-[#DECDB3] text-[#8C6D4F] flex flex-col items-center gap-1 cursor-pointer transition-transform active:scale-95"
            >
              <span className="text-base">📋</span>
              <span className="text-[11px] font-bold">{copiedText ? '已复制' : '复制文案'}</span>
            </button>
          </div>

          {/* 切换/展开拍立得海报 */}
          <div className="pt-2 border-t border-[#DECDB3]/80">
            {!showPosterPreview ? (
              <button
                type="button"
                onClick={() => {
                  soundManager.playActionClick();
                  setShowPosterPreview(true);
                }}
                className="w-full py-2 rounded-xl bg-[#FAF3E3] hover:bg-[#F0E6D2] border border-[#DECDB3] text-[#1E4334] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <ImageIcon size={14} />
                <span>生成小红书 / LOFTER 卡片海报 ➔</span>
              </button>
            ) : (
              <div className="space-y-2.5 animate-in fade-in">
                {/* 实际海报 DOM 节点 */}
                <div
                  ref={posterRef}
                  className="bg-[#FAF3E3] border-2 border-[#8C6D4F] rounded-xl p-3.5 text-[#2C2016] shadow-sm relative overflow-hidden space-y-2"
                >
                  <CardPatternOverlay opacity={0.06} mode="multiply" />
                  <div className="relative z-10 flex items-center justify-between border-b border-[#8C6D4F]/40 pb-1.5">
                    <div className="text-[10px] font-bold text-[#1E4334] flex items-center gap-1">
                      <span>☕</span>
                      <span>LEVIHAN TEA PARTY</span>
                    </div>
                    <span className="px-1.5 py-0.2 bg-[#1E4334] text-[#F9E79F] text-[9px] rounded font-bold">
                      {shareDetails.badge}
                    </span>
                  </div>

                  <div className="relative z-10 flex gap-2.5 items-center">
                    <CharacterArt
                      src={shareDetails.image}
                      alt="插图"
                      fit="cover"
                      className="w-16 h-16 rounded-lg border border-[#8C6D4F]/40 bg-[#EFE3CD] shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-serif-title text-xs font-bold text-[#2C2016] line-clamp-1">
                        {shareDetails.title}
                      </h4>
                      <p className="text-[10px] text-[#614E3C] line-clamp-2 leading-tight mt-0.5 italic">
                        “{shareDetails.summary}”
                      </p>
                    </div>
                  </div>

                  <div className="relative z-10 pt-1.5 border-t border-[#8C6D4F]/30 flex items-center justify-between gap-2">
                    <div className="text-[9px] text-[#8C6D4F]">
                      <span className="font-bold text-[#1E4334] block">利韩土豆仓 · 兵长茶会</span>
                      <span>扫码直达交流所</span>
                    </div>
                    {qrCodeUrl && (
                      <img
                        src={qrCodeUrl}
                        alt="二维码"
                        className="w-10 h-10 rounded border border-[#8C6D4F]/30 p-0.5 bg-white shrink-0"
                      />
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isGeneratingPoster}
                    onClick={handleDownloadPoster}
                    className="flex-1 py-2 rounded-xl bg-[#1E4334] hover:bg-[#2C5C46] text-[#F9E79F] font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-transform active:scale-95 shadow-sm disabled:opacity-50"
                  >
                    <Download size={13} />
                    <span>{isGeneratingPoster ? '生成中...' : '保存海报图片 (PNG)'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPosterPreview(false)}
                    className="px-3 py-2 rounded-xl bg-[#FAF3E3] hover:bg-[#F0E6D2] border border-[#DECDB3] text-[#8C6D4F] text-xs font-bold cursor-pointer"
                  >
                    收起
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
