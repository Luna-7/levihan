export interface QQGroupItem {
  id: string;
  name: string;
  number: string;
  tag?: string;
}

export interface GroupInfo {
  name: string;
  subTitle: string;
  qqGroupNumber: string;
  qqGroups: QQGroupItem[];
  verificationRequirement: string;
  qqGroupLink?: string;
  contactAdmin: string;
  motto: string;
  intro: string;
  establishedDate: string;
  activeAnnouncement: string;
}

export interface GroupRule {
  id: string;
  title: string;
  summary: string;
  details: string[];
  icon: string;
  level: 'critical' | 'warning' | 'info';
  badge: string;
}

export interface DoujinshiBook {
  id: string;
  title: string;
  originalTitle?: string;
  authorOrCircle: string;
  source?: string;
  translator?: string;
  typesetter?: string;
  category: 'canon' | 'sweet' | 'serious' | 'au' | 'artbook';
  format: 'PDF汉化精修' | '全彩画集' | '高清单行本' | '图文特典';
  pages?: string;
  coverTag: string;
  description: string;
  downloadUrl: string;
  bucketPreviewUrl?: string;
  code?: string;
  platform: '百度网盘' | '夸克网盘';
  isR18?: boolean;
}

export interface PixivArtist {
  name: string;
  url: string;
  id: string;
  kind: string;
  warn: boolean;
}

export interface ResourceLink {
  id: string;
  title: string;
  platform: '百度网盘' | '夸克网盘' | '微博' | '在线阅读' | 'AO3' | '站内独立阅读';
  url: string;
  code?: string;
  category: 'anime' | 'cut' | 'material' | 'manga' | 'link' | 'novel' | 'creative';
  description?: string;
}

/**
 * 「周边橱窗」单张周边图（清单来自 COS 的 goods/manifest.json，由 scripts/sync-goods.mjs 生成）
 * 原图存放于 COS 的 goods/ 目录；缩略图/预览图由 COS 图片处理参数现场生成，不需要另存一份。
 */
export interface GoodsItem {
  /** COS 上的文件名（含扩展名），位于 goods/ 目录下 */
  file: string;
  /**
   * 展示名。**可选** —— 周边图往往没有名字：
   * 文件名有意义时脚本自动采用；是相机/微信/截图默认名、纯数字或纯 hash 时留空，
   * 前台就当纯图墙渲染（不留一行没用的字）。要补名字用 goods-src/titles.json。
   */
  title?: string;
  /** 可选备注，例如材质 / 尺寸 / 年份 */
  note?: string;
  /** 原图字节数（脚本写入，用于显示体积） */
  bytes?: number;
  /** 原图宽高（脚本写入，用于列表占位按真实比例，避免加载时跳动） */
  width?: number;
  height?: number;
}

export interface AuNovelStory {
  id: string;
  num: number;
  titleZh: string;
  titleEn: string;
  paragraphsZh: string[];
  paragraphsEn: string[];
}

export type NavigationTab = 'home' | 'resources' | 'doujinshi' | 'tatakaru' | 'dispatch';
