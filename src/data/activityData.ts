export interface ActivityItem {
  id: string;
  title: string;
  badge: string;
  date: string;
  description: string;
  highlights: string[];
  linkText?: string;
  linkUrl?: string;
  isOngoing?: boolean;
}

export const INITIAL_LEVIHAN_ACTIVITIES: ActivityItem[] = [
  {
    id: 'act-2026-spring',
    title: '🌿 2026春日特别企划 ·「第57次壁外之春」利韩作品产粮节',
    badge: '进行中 · 兵团征稿',
    date: '2026.03.01 - 2026.04.30',
    description: '春日复苏，战友重逢！欢迎同好围绕「和平时代/春日茶会/壁外野餐」展开同人图文创作与心得投递。',
    highlights: [
      '画作/短漫：画质 2K 以上，附创作者署名与 Pixiv/社交主页',
      '同人小说：单篇千字以上，AU/原作向均可，欢迎至【联络呈递】投稿',
      '群内评选：优秀作品将收录入站内精修画廊与文库专区',
    ],
    linkText: '前往【联络呈递】投稿作品',
    linkUrl: 'dispatch',
    isOngoing: true,
  },
  {
    id: 'act-cp-survey',
    title: '📊 利韩同好社群生态与磕点全景调查报告发布',
    badge: '重磅档案',
    date: '常驻专题',
    description: '汇聚数百位调查兵团士兵的真实心声，全方位梳理利韩情感羁绊、高光名场面与喜好题材画像。',
    highlights: [
      '名场面投票第 1 名：“韩吉，把心脏献给我吧”',
      '同好最爱题材：战友同行、无差攻受、和平时代红茶小店',
      '可随时在线查看完整交互式数据图表',
    ],
    linkText: '查看完整调查报告网页 ➔',
    linkUrl: '/cp-community-survey-report.html',
    isOngoing: false,
  },
  {
    id: 'act-doujin-sync',
    title: '🍠 土豆粮仓 2026 最新汉化同人本补档与在线阅览升级',
    badge: '粮仓更新',
    date: '持续维护',
    description: '现已上线无缝长图在线阅读器，收录日本知名利韩画师汉化精修本、全彩画集与日文生肉珍稀本。',
    highlights: [
      '支持手机竖屏长图流畅下滑阅读与原图放大',
      '内置Pixiv画师一键直达主页与关注外链',
      '提供夸克/百度网盘高名单行本打包下载',
    ],
    linkText: '进入【土豆粮仓】翻阅同人志',
    linkUrl: 'doujinshi',
    isOngoing: false,
  },
];
