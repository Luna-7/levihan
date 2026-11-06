export interface MangaPreviewBook {
  id: string;
  title: string;
  volumeLabel: string;
  pageCount: number;
  pageUrlPrefix: string;
  defaultRotatedPages: readonly number[];
  pageFilePrefix?: string;
  pageNumberOffset?: number;
  actionLabel?: string;
}

const COS_BASE_URL = 'https://levihan-1325571558.cos-website.ap-nanjing.myqcloud.com';
const PREVIEW_BASE_URL = import.meta.env.DEV
  ? '/manga-preview-export'
  : COS_BASE_URL + '/' + encodeURIComponent('无悔的选择');
const SHORT_GIANT_BASE_URL = import.meta.env.DEV
  ? '/manga-preview-export/short-giant'
  : COS_BASE_URL + '/' + encodeURIComponent('短剧的巨人');

export const MANGA_PREVIEW_BOOKS: MangaPreviewBook[] = [
  {
    id: 'no-regrets-vol-01',
    title: '无悔的选择',
    volumeLabel: '第一卷',
    pageCount: 191,
    pageUrlPrefix: PREVIEW_BASE_URL + '/volume-01',
    defaultRotatedPages: [1, 2, 3, 5],
  },
  {
    id: 'no-regrets-vol-02',
    title: '无悔的选择',
    volumeLabel: '第二卷',
    pageCount: 191,
    pageUrlPrefix: PREVIEW_BASE_URL + '/volume-02',
    defaultRotatedPages: [1, 2],
  },
];

export const SHORT_GIANT_PREVIEW_BOOKS: MangaPreviewBook[] = [
  {
    id: 'short-giant-vol-01',
    title: '短剧的巨人',
    volumeLabel: '第一卷',
    pageCount: 132,
    pageUrlPrefix: SHORT_GIANT_BASE_URL + '/volume-01',
    defaultRotatedPages: [],
  },
  {
    id: 'short-giant-vol-02',
    title: '短剧的巨人',
    volumeLabel: '第二卷',
    pageCount: 131,
    pageUrlPrefix: SHORT_GIANT_BASE_URL + '/volume-02',
    defaultRotatedPages: [],
  },
];

export const CHARACTER_DESIGN_PREVIEW_BOOKS: MangaPreviewBook[] = [
  {
    id: 'character-design-three-views',
    title: '人物设定 三视图',
    volumeLabel: '123 张设定图',
    pageCount: 123,
    pageUrlPrefix: COS_BASE_URL + '/' + encodeURIComponent('人物三视图'),
    defaultRotatedPages: [],
    pageFilePrefix: '',
    pageNumberOffset: -1,
    actionLabel: '开始阅读',
  },
];

export const FORMULA_BOOK_PREVIEW_BOOKS: MangaPreviewBook[] = [
  {
    id: 'formula-outside-attack',
    title: '公式书中文版 OUTSIDE 攻',
    volumeLabel: '全一卷',
    pageCount: 96,
    pageUrlPrefix:
      COS_BASE_URL + '/' + encodeURIComponent('进击的巨人_OUTSIDE_攻_公式书'),
    defaultRotatedPages: [],
    pageFilePrefix: 'page-',
    actionLabel: 'OUTSIDE 攻',
  },
  {
    id: 'formula-inside-resist',
    title: '公式书中文版 INSIDE 抗',
    volumeLabel: '全一卷',
    pageCount: 100,
    pageUrlPrefix:
      COS_BASE_URL + '/' + encodeURIComponent('进击的巨人_INSIDE_抗_公式书'),
    defaultRotatedPages: [],
    pageFilePrefix: 'page-',
    actionLabel: 'INSIDE 抗',
  },
];
