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
  category: 'canon' | 'sweet' | 'serious' | 'au' | 'artbook';
  format: 'PDF汉化精修' | '全彩画集' | '高清单行本' | '图文特典';
  pages?: string;
  coverTag: string;
  description: string;
  downloadUrl: string;
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
  platform: '百度网盘' | '夸克网盘' | '微博' | '在线阅读' | 'AO3';
  url: string;
  code?: string;
  category: 'anime' | 'cut' | 'material' | 'manga' | 'link' | 'novel' | 'creative';
  description?: string;
}
