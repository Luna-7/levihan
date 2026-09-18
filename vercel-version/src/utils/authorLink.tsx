import React from 'react';
import { PIXIV_ARTISTS_DATA } from '../data/initialData';

// 构建 Pixiv 画师映射表（标准化小写与别名索引）
const artistLookupMap = new Map<string, string>();

function normalizeName(str: string): string {
  return str.trim().toLowerCase();
}

// 初始化索引
PIXIV_ARTISTS_DATA.forEach((artist) => {
  if (!artist.url) return;
  const raw = artist.name.trim();
  const rawLower = normalizeName(raw);
  artistLookupMap.set(rawLower, artist.url);

  // 去除括号内的修饰词，如 "きぃ（⚠立场问题，不推荐）" -> "きぃ", "35（珊瑚）" -> "35"
  const cleanName = raw.replace(/[\(（].*?[\)）]/g, '').trim();
  if (cleanName) {
    artistLookupMap.set(normalizeName(cleanName), artist.url);
  }

  // 提取括号内部的文字，如 "35（珊瑚）" -> "珊瑚"
  const matchParen = raw.match(/[\(（](.*?)[\)）]/);
  if (matchParen && matchParen[1]) {
    const inside = matchParen[1].trim();
    if (!inside.includes('⚠') && !inside.includes('立场') && !inside.includes('推荐')) {
      artistLookupMap.set(normalizeName(inside), artist.url);
    }
  }

  // 如果包含斜杠，如 "たっつん/まる", "すずしろ/しろ", "びーまる/すけまる", "ぴこ/Piko"
  if (raw.includes('/')) {
    raw.split('/').forEach((part) => {
      const p = part.trim();
      if (p) {
        artistLookupMap.set(normalizeName(p), artist.url);
      }
    });
  }
});

/**
 * 根据作者名称查找 Pixiv 主页外链
 */
export function getPixivArtistUrl(name: string): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed === '未知') return null;

  const key = normalizeName(trimmed);
  if (artistLookupMap.has(key)) {
    return artistLookupMap.get(key)!;
  }

  // 尝试去除括号
  const stripped = trimmed.replace(/[\(（].*?[\)）]/g, '').trim();
  if (stripped && artistLookupMap.has(normalizeName(stripped))) {
    return artistLookupMap.get(normalizeName(stripped))!;
  }

  // 模糊匹配（如果某个画师名字是当前作者的前缀或子串）
  for (const [artName, url] of artistLookupMap.entries()) {
    if (artName.length >= 2 && (key === artName || key.startsWith(artName) || key.endsWith(artName))) {
      return url;
    }
  }

  return null;
}

interface RenderAuthorOptions {
  customUrl?: string;
  defaultColorClass?: string;
  orangeColorClass?: string;
}

/**
 * 漫画本作者外链渲染组件：
 * - 不做修饰，纯净文本链接
 * - 点击文本直接新标签页跳转
 * - 有外链的作者名换成橙色 (text-[#D35400] / orange)
 * - 没有外链的作者名保持原样
 */
export const AuthorWithLink: React.FC<{
  author?: string;
  customUrl?: string;
  defaultColorClass?: string;
  orangeColorClass?: string;
}> = ({
  author,
  customUrl,
  defaultColorClass = 'text-[#3E342B]',
  orangeColorClass = 'text-[#D35400]',
}) => {
  if (!author || author.trim() === '' || author.trim() === '未知') {
    return <span className={defaultColorClass}>{author || '未知'}</span>;
  }

  // 若传入明确的 customUrl
  if (customUrl) {
    return (
      <a
        href={customUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`${orangeColorClass} hover:underline cursor-pointer`}
        title={`访问 ${author} 的 Pixiv / 主页外链`}
      >
        {author}
      </a>
    );
  }

  // 检查整个作者字符串是否直接匹配
  const directUrl = getPixivArtistUrl(author);
  if (directUrl) {
    return (
      <a
        href={directUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`${orangeColorClass} hover:underline cursor-pointer`}
        title={`访问 ${author} 的 Pixiv 主页`}
      >
        {author}
      </a>
    );
  }

  // 如果包含多位作者或社团联合分割符（/、&、、、、+）
  const parts = author.split(/(\s*[\/&,、+]\s*)/);
  if (parts.length > 1) {
    return (
      <>
        {parts.map((part, idx) => {
          if (/^\s*[\/&,、+]\s*$/.test(part)) {
            return <span key={idx} className={defaultColorClass}>{part}</span>;
          }
          const pTrimmed = part.trim();
          const pUrl = getPixivArtistUrl(pTrimmed);
          if (pUrl) {
            return (
              <a
                key={idx}
                href={pUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`${orangeColorClass} hover:underline cursor-pointer`}
                title={`访问 ${pTrimmed} 的 Pixiv 主页`}
              >
                {part}
              </a>
            );
          }
          return <span key={idx} className={defaultColorClass}>{part}</span>;
        })}
      </>
    );
  }

  // 无外链，保持原样
  return <span className={defaultColorClass}>{author}</span>;
};
