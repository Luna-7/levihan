import React, { useEffect, useState } from 'react';
import { Play, ExternalLink, Link as LinkIcon, X, Copy, Check, EyeOff } from 'lucide-react';

/** 安利墙外链数据（与云函数 forumPublish 的 post.link 结构一一对应） */
export interface LinkShare {
  url: string;
  platform: string; // bilibili | lofter | xiaohongshu | weibo | web
  tier: 'A' | 'B' | 'C';
  bvid?: string;
  coverUrl?: string;
  ogTitle?: string;
  ogDesc?: string;
}

export const PLATFORM_LABEL: Record<string, string> = {
  bilibili: 'B站',
  lofter: 'LOFTER',
  xiaohongshu: '小红书',
  weibo: '微博',
  web: '网页',
};

const PLATFORM_STYLE: Record<string, string> = {
  bilibili: 'bg-[#B7791F] text-[#FFFEEF]',
  lofter: 'bg-[#0F6E56] text-[#FFFEEF]',
  xiaohongshu: 'bg-[#D85A30] text-[#FFFEEF]',
  weibo: 'bg-[#A32D2D] text-[#FFFEEF]',
  web: 'bg-[#5F5E5A] text-[#FFFEEF]',
};

const tierHint = (tier: string): string =>
  tier === 'A' ? '站内直接播放' : tier === 'B' ? '站内预览 · 可跳原文' : '对方限制抓取 · 仅跳转';

export const platformLabel = (platform: string): string => PLATFORM_LABEL[platform] || '网页';

/** 从链接取域名，作为降级卡的副标题 */
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

interface CardProps {
  link: LinkShare;
  title: string;
  note?: string;
  onOpen: () => void;
}

/** 安利墙卡片主体：封面 + 平台徽章 + 标题 + 摘要 + 推荐语 + 操作 */
export const LinkShareCard: React.FC<CardProps> = ({ link, title, note, onOpen }) => {
  const [copied, setCopied] = useState(false);
  const isPlayable = link.tier === 'A';
  const withoutCover = !link.coverUrl;

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 剪贴板不可用（非 https / 无权限）时静默 */
    }
  };

  return (
    <div className="space-y-2.5">
      {/* 封面区：A 级常驻播放键；B 级为预览入口；无封面走米色占位 */}
      <div
        onClick={onOpen}
        className={`relative w-full aspect-video overflow-hidden rounded-lg border border-[#D8C7AA] cursor-pointer group/cover ${
          withoutCover ? 'bg-[#EFE5D2]' : 'bg-[#1E4334]'
        }`}
      >
        {link.coverUrl ? (
          <img
            src={link.coverUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover transition-transform duration-500 group-hover/cover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[#8C6D4F]">
            <EyeOff size={22} />
            <span className="text-[11px] font-retro-jp">链接方未提供可预览封面</span>
          </div>
        )}

        <span className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold shadow-2xs ${PLATFORM_STYLE[link.platform] || PLATFORM_STYLE.web}`}>
          {platformLabel(link.platform)}
        </span>

        {isPlayable && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="w-14 h-14 rounded-full border-2 border-[#F9E79F] bg-[#1E4334]/55 flex items-center justify-center transition-transform group-hover/cover:scale-110">
              <Play size={22} className="text-[#F9E79F] translate-x-[1px]" />
            </span>
          </div>
        )}

        <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-[#2C2016]/85 text-[#F9E79F] text-[10px] font-retro-jp">
          {tierHint(link.tier)}
        </span>
      </div>

      <div className="space-y-1">
        <p className="font-pixel text-[13px] sm:text-sm font-bold text-[#2C2016] leading-snug break-words">
          {title}
        </p>
        {link.ogDesc && (
          <p className="text-[11px] font-retro-jp text-[#6B5B4A] leading-relaxed line-clamp-2 break-words">
            {link.ogDesc}
          </p>
        )}
      </div>

      {note && (
        <div className="border-l-2 border-[#C29641] bg-[#FAF5E8] rounded-r-md px-2.5 py-1.5">
          <p className="text-[11px] font-retro-jp text-[#5B4636] leading-relaxed break-words whitespace-pre-wrap">
            {note}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-0.5">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="px-2.5 py-1 rounded-md bg-[#1E4334] text-[#F9E79F] text-[11px] font-bold flex items-center gap-1 cursor-pointer hover:bg-[#2B5E4A] transition-colors"
        >
          {isPlayable ? <Play size={11} /> : <ExternalLink size={11} />}
          <span>{isPlayable ? '站内播放' : link.tier === 'B' ? '站内预览' : '打开原文'}</span>
        </button>
        <button
          type="button"
          onClick={copy}
          className="px-2.5 py-1 rounded-md bg-[#EFE5D2] border border-[#C5B295] text-[#614E3C] text-[11px] font-bold flex items-center gap-1 cursor-pointer hover:bg-[#E2D4BC] transition-colors"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span>{copied ? '已复制' : '复制链接'}</span>
        </button>
        <span className="ml-auto text-[10px] font-retro-jp text-[#A89078] truncate max-w-[45%]" title={link.url}>
          {hostOf(link.url)}
        </span>
      </div>
    </div>
  );
};

interface ModalProps {
  link: LinkShare;
  title: string;
  note?: string;
  onClose: () => void;
}

/** 展开窗口：A 级内嵌 B 站官方播放器直接播；B/C 级给大图预览 + 跳原文 */
export const LinkShareModal: React.FC<ModalProps> = ({ link, title, note, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const playable = link.tier === 'A' && Boolean(link.bvid);

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-3"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-3xl bg-[#FAF5E8] border-2 border-[#1E4334] rounded-xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#1E4334]">
          <span className="font-pixel text-xs text-[#F9E79F] truncate">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 w-7 h-7 rounded-md border border-[#F9E79F]/45 text-[#F9E79F] flex items-center justify-center cursor-pointer hover:bg-[#2B5E4A] transition-colors"
          >
            <X size={13} />
          </button>
        </div>

        <div className="bg-[#2C2016]">
          {playable ? (
            <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
              <iframe
                title={title}
                src={`https://player.bilibili.com/player.html?bvid=${link.bvid}&autoplay=1&danmaku=0&high_quality=1`}
                className="absolute inset-0 w-full h-full"
                allowFullScreen
                scrolling="no"
                frameBorder="0"
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : link.coverUrl ? (
            <div className="w-full max-h-[62vh] overflow-hidden flex items-center justify-center">
              <img src={link.coverUrl} alt="" className="max-h-[62vh] w-auto object-contain" referrerPolicy="no-referrer" />
            </div>
          ) : (
            <div className="p-10 text-center text-[#D3D1C7] text-xs font-retro-jp">
              对方站点限制了站内预览，点下方按钮去原站查看。
            </div>
          )}
        </div>

        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${PLATFORM_STYLE[link.platform] || PLATFORM_STYLE.web}`}>
              {platformLabel(link.platform)}
            </span>
            <span className="text-[10px] font-retro-jp text-[#8C6D4F]">{tierHint(link.tier)}</span>
          </div>
          {link.ogDesc && (
            <p className="text-[11px] font-retro-jp text-[#5B4636] leading-relaxed line-clamp-3">{link.ogDesc}</p>
          )}
          {note && (
            <div className="border-l-2 border-[#C29641] bg-[#FFFEEF] rounded-r-md px-2.5 py-1.5">
              <p className="text-[11px] font-retro-jp text-[#5B4636] leading-relaxed whitespace-pre-wrap break-words">{note}</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="px-3 py-1.5 rounded-md bg-[#B7791F] text-[#FFFEEF] text-[11px] font-bold flex items-center gap-1 hover:bg-[#9A6519] transition-colors"
            >
              <ExternalLink size={11} />
              <span>去原站打开</span>
            </a>
            <span className="text-[10px] font-retro-jp text-[#A89078] flex items-center gap-1 min-w-0">
              <LinkIcon size={10} className="shrink-0" />
              <span className="truncate">{link.url}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
