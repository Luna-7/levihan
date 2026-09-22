import React, { useEffect, useState } from 'react';
import { Play, ExternalLink, Link as LinkIcon, X, Copy, Check, EyeOff, ShieldAlert } from 'lucide-react';

/** 安利墙外链数据（与云函数 forumPublish 的 post.link 结构一一对应） */
export interface LinkShare {
  url: string;
  platform: string; // bilibili | lofter | xiaohongshu | weibo | ao3 | web
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
  ao3: 'AO3',
  web: '网页',
};

const PLATFORM_STYLE: Record<string, string> = {
  bilibili: 'bg-[#B7791F] text-[#FFFEEF]',
  lofter: 'bg-[#0F6E56] text-[#FFFEEF]',
  xiaohongshu: 'bg-[#D85A30] text-[#FFFEEF]',
  weibo: 'bg-[#A32D2D] text-[#FFFEEF]',
  ao3: 'bg-[#8A1F1F] text-[#FFFEEF]',
  web: 'bg-[#5F5E5A] text-[#FFFEEF]',
};

const tierHint = (tier: string): string =>
  tier === 'A' ? '站内直接播放' : tier === 'B' ? '站内预览 · 可跳原文' : '对方限制抓取 · 仅跳转';

const isIOS = (): boolean =>
  typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);

export const platformLabel = (platform: string): string => PLATFORM_LABEL[platform] || '网页';

/**
 * AO3 镜像站表（配置表，后续镜像失效/新增只改这里）。
 * pathMode: true → 作品路径原样拼在域名后（<mirror>/works/{id}）；
 *           false → 镜像站用 query 形式承接（<mirror>/?works={id}）。
 * ao3mirror.com 已实测为路径式（/works/{id} 302 到章节页），其余按路径式处理。
 */
const AO3_MIRRORS: { host: string; pathMode: boolean }[] = [
  { host: 'https://ao3mirror.com', pathMode: true },
  { host: 'https://ao3mirror.net', pathMode: true },
  { host: 'https://go3-cn.online', pathMode: true },
  { host: 'https://go3-cn.xyz', pathMode: true },
  { host: 'https://go3-cn.blog', pathMode: true },
  { host: 'https://ao3-agent.co', pathMode: true },
  { host: 'https://ao3-agent.org', pathMode: true },
];

/** 取原文的路径部分（含 /works/xxx/chapters/yyy 这种章节深链），镜像站共用它 */
const workPathOf = (url: string): string => {
  try {
    const p = new URL(url).pathname;
    return p && p !== '/' ? p : '/';
  } catch {
    return '/';
  }
};

/** 取路径里第一个 /works/{id} 的数字，供 query 式镜像拼装 */
const workIdOf = (url: string): string => {
  const m = String(url).match(/\/works\/(\d+)/);
  return m ? m[1] : '';
};

const buildMirrorUrl = (mirror: { host: string; pathMode: boolean }, originalUrl: string): string => {
  if (mirror.pathMode) return `${mirror.host}${workPathOf(originalUrl)}`;
  const id = workIdOf(originalUrl);
  return id ? `${mirror.host}/?works=${id}` : mirror.host;
};

/** 从链接取域名，作为降级卡的副标题 */
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const copyText = async (text: string): Promise<boolean> => {
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
 * AO3 兜底面板：原站国内常打不开，给一组镜像站 + 复制原链接。
 * 只在 platform === 'ao3' 的卡片上出现，不单独占弹窗。
 */
const Ao3MirrorPanel: React.FC<{ originalUrl: string; title: string }> = ({ originalUrl, title }) => {
  const [copiedUrl, setCopiedUrl] = useState(false);

  const copyOriginal = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await copyText(originalUrl)) {
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 1600);
    }
  };

  return (
    <div className="rounded-lg border border-[#C29641]/70 bg-[#FBF3E0] p-2.5 space-y-2">
      <div className="flex items-start gap-1.5">
        <ShieldAlert size={12} className="text-[#8A5A12] shrink-0 mt-0.5" />
        <p className="text-[10px] font-retro-jp text-[#7A5A22] leading-relaxed">
          AO3 原站在国内常被墙。下面是对应作品页的镜像入口（第三方站点，请自行判断风险）；也可复制原链接自行处理。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <a
          href={originalUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={(e) => e.stopPropagation()}
          className="col-span-2 flex items-center gap-1 px-2 py-1.5 rounded-md bg-white/90 border border-dashed border-[#C5B295] text-[10px] font-retro-jp text-[#8C6D4F] hover:border-[#8A1F1F] hover:text-[#8A1F1F] transition-colors"
          title={originalUrl}
        >
          <ExternalLink size={9} className="shrink-0" />
          <span className="truncate">原站 archiveofourown.org（国内常打不开）</span>
        </a>
        {AO3_MIRRORS.map((m) => (
          <a
            key={m.host}
            href={buildMirrorUrl(m, originalUrl)}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-white/90 border border-[#D8C7AA] text-[10px] font-retro-jp text-[#5B4636] hover:border-[#8A1F1F] hover:text-[#8A1F1F] transition-colors"
            title={`打开 ${m.host}`}
          >
            <ExternalLink size={9} className="shrink-0" />
            <span className="truncate">{m.host.replace(/^https:\/\//, '')}</span>
          </a>
        ))}
      </div>

      <button
        type="button"
        onClick={copyOriginal}
        className="w-full px-2 py-1.5 rounded-md bg-[#EFE5D2] border border-[#C5B295] text-[10px] font-bold text-[#614E3C] flex items-center justify-center gap-1 cursor-pointer hover:bg-[#E2D4BC] transition-colors"
      >
        {copiedUrl ? <Check size={10} /> : <Copy size={10} />}
        <span>{copiedUrl ? '原链接已复制' : `复制原链接《${title.slice(0, 12)}${title.length > 12 ? '…' : ''}》`}</span>
      </button>
    </div>
  );
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
  const [copiedName, setCopiedName] = useState(false);
  const [showMirrors, setShowMirrors] = useState(false);
  const isPlayable = link.tier === 'A';
  const playOnOriginalSite = isPlayable && isIOS();
  const isAo3 = link.platform === 'ao3';
  const withoutCover = !link.coverUrl;

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await copyText(link.url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  /** AO3：复制作品名（与原小说本一致的操作），顺手把镜像站面板摊开 */
  const copyName = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await copyText(title)) {
      setCopiedName(true);
      window.setTimeout(() => setCopiedName(false), 1600);
    }
    setShowMirrors(true);
  };

  return (
    <div className="space-y-2.5">
      {/* AO3 走紧凑卡片：没有封面可放，大视窗只会是一整块空白 */}
      {!isAo3 && (
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
          {playOnOriginalSite ? '前往 B 站播放' : tierHint(link.tier)}
        </span>
      </div>
      )}

      <div className="space-y-1">
        {/* AO3：徽章 + 「需镜像打开」提示压在标题行，不再单开视窗 */}
        {isAo3 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${PLATFORM_STYLE.ao3}`}>
              {platformLabel(link.platform)}
            </span>
            <span className="text-[10px] font-retro-jp text-[#8C6D4F]">AO3 站外作品 · 复制名称或走镜像打开</span>
          </div>
        )}
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
          onClick={(e) => {
            e.stopPropagation();
            if (isAo3) setShowMirrors((v) => !v);
            else onOpen();
          }}
          className="px-2.5 py-1 rounded-md bg-[#1E4334] text-[#F9E79F] text-[11px] font-bold flex items-center gap-1 cursor-pointer hover:bg-[#2B5E4A] transition-colors"
        >
          {isPlayable ? <Play size={11} /> : <ExternalLink size={11} />}
          <span>{playOnOriginalSite ? '前往 B 站播放' : isPlayable ? '站内播放' : isAo3 ? '打开原文 / 镜像' : link.tier === 'B' ? '站内预览' : '打开原文'}</span>
        </button>

        {isAo3 ? (
          <button
            type="button"
            onClick={copyName}
            className="px-2.5 py-1 rounded-md bg-[#EFE5D2] border border-[#C5B295] text-[#614E3C] text-[11px] font-bold flex items-center gap-1 cursor-pointer hover:bg-[#E2D4BC] transition-colors"
          >
            {copiedName ? <Check size={11} /> : <Copy size={11} />}
            <span>{copiedName ? '名称已复制' : '复制名称'}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={copy}
            className="px-2.5 py-1 rounded-md bg-[#EFE5D2] border border-[#C5B295] text-[#614E3C] text-[11px] font-bold flex items-center gap-1 cursor-pointer hover:bg-[#E2D4BC] transition-colors"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            <span>{copied ? '已复制' : '复制链接'}</span>
          </button>
        )}

        <span className="ml-auto text-[10px] font-retro-jp text-[#A89078] truncate max-w-[45%]" title={link.url}>
          {hostOf(link.url)}
        </span>
      </div>

      {/* AO3 专属：镜像站面板（复制名称或点封面后内联展开） */}
      {isAo3 && showMirrors && (
        <div onClick={(e) => e.stopPropagation()}>
          <Ao3MirrorPanel originalUrl={link.url} title={title} />
        </div>
      )}
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
  const playOnOriginalSite = playable && isIOS();

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
          {playOnOriginalSite ? (
            <div className="relative w-full aspect-video flex flex-col items-center justify-center gap-3 bg-[#2C2016]">
              {link.coverUrl && <img src={link.coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-35" referrerPolicy="no-referrer" />}
              <p className="relative text-sm text-[#FFFEEF] font-retro-jp">iOS 请在 B 站页面播放视频</p>
              <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" className="relative px-4 py-2 rounded-md bg-[#B7791F] text-white text-sm font-bold flex items-center gap-2">
                <Play size={16} /> 前往 B 站播放
              </a>
            </div>
          ) : playable ? (
            <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
              <iframe
                title={title}
                src={`https://player.bilibili.com/player.html?bvid=${link.bvid}&autoplay=0&danmaku=0&high_quality=1`}
                className="absolute inset-0 w-full h-full"
                allowFullScreen
                allow="fullscreen; picture-in-picture"
                scrolling="no"
                frameBorder="0"
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
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
            <span className="text-[10px] font-retro-jp text-[#8C6D4F]">
              {playOnOriginalSite ? 'iOS 使用 B 站页面播放' : link.platform === 'ao3' ? 'AO3 站外 · 需镜像打开' : tierHint(link.tier)}
            </span>
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
