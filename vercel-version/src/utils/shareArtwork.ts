import { cosService } from '../services/cosClient';

/**
 * 巨人资源 & 周边橱窗 PNG 分享随机图库池
 * 收录来自周边橱窗 (COS 官方正版/同人周边高清透明底图 PNG 1~60) 与巨人资源核心素材 PNG
 */

// 周边橱窗 1~60.png 编号清单
const GOODS_PNG_FILES: string[] = Array.from({ length: 60 }, (_, i) => `${i + 1}.png`);

// 巨人资源本站核心 PNG / WebP 优质图库
const RESOURCE_PNG_FILES: string[] = [
  '/images/rules-hange-tea.png',
];

/**
 * 获取所有周边橱窗与巨人资源的候选 PNG / 高清图直链池
 */
export const getAllSharePngCandidates = (): string[] => {
  const cdnGoods = GOODS_PNG_FILES.map((file) => cosService.getGoodsOriginalUrl(file));
  return [...cdnGoods, ...RESOURCE_PNG_FILES];
};

/**
 * 获取用于前端快速展示/海报渲染的缩略版（WebP 优化，省流高速）
 */
export const getAllShareThumbCandidates = (): string[] => {
  const cdnGoodsThumbs = GOODS_PNG_FILES.map((file) => cosService.getGoodsThumbUrl(file, 420));
  return [...cdnGoodsThumbs, ...RESOURCE_PNG_FILES];
};

/**
 * 简单哈希函数，用于根据内容 ID 生成稳定但随机分布的索引
 */
const simpleHash = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

/**
 * 随机从「巨人资源」与「周边橱窗」的 PNG 中挑选一张作为分享图
 * @param seed 可选的种子（如文章 ID、标题等），传了则相同种子每次选相同图，不传则纯随机
 * @param preferThumb 是否返回适合网页快速加载的缩略图版本（默认 true）
 */
export const getRandomSharePng = (seed?: string | number, preferThumb: boolean = false): string => {
  const pool = preferThumb ? getAllShareThumbCandidates() : getAllSharePngCandidates();
  if (pool.length === 0) return '/images/rules-hange-tea.png';

  if (seed !== undefined && seed !== null && seed !== '') {
    const idx = simpleHash(String(seed)) % pool.length;
    return pool[idx];
  }

  const randomIdx = Math.floor(Math.random() * pool.length);
  return pool[randomIdx];
};

/**
 * 针对外部第三方平台（如微博、QQ 分享）获取绝对或可直链的原图 PNG
 */
export const getExternalSharePng = (seed?: string | number): string => {
  const goodsPool = GOODS_PNG_FILES.map((file) => cosService.getGoodsOriginalUrl(file));
  const pool = [...goodsPool, '/images/rules-hange-tea.png'];
  const target = seed ? pool[simpleHash(String(seed)) % pool.length] : pool[Math.floor(Math.random() * pool.length)];
  if (target.startsWith('http://') || target.startsWith('https://')) {
    return target;
  }
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${target}`;
  }
  return target;
};
