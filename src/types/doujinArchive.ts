export type DoujinCategory = '漫画本' | '小说本' | '插画集' | '商业志' | string;

export interface DoujinBookItem {
  id: string; // ID编号，如 "lh-001"
  titleZh: string; // 本子名
  titleJp?: string; // 日文原名（可选）
  circle: string; // 作者
  category?: DoujinCategory; // 分类（如未填默认为漫画本）
  tags: string[]; // 标签，如 ["自设世界观", "现代", "含R18"]
  source?: string; // 来源，如 "塔比欧卡"
  translator?: string; // 汉化，如 "LG"
  typesetter?: string; // 嵌字，如 "LG"
  pages: number; // 总页数，如 30
  coverFile?: string; // 封面文件名，若不填默认自动映射为 "image01.webp"
  bookFolder?: string; // 存储桶子目录，若不填默认自动映射为 id (如 "lh-001")
  pagePrefix?: string; // 图片前缀，默认为 "image"
  pagePadDigits?: number; // 页码位数，默认为 2 (如 image01.webp)
}
