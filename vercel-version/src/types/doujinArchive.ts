export type DoujinCategory = '漫画本' | '小说本' | '插画集' | '商业志' | string;

export interface DoujinBookItem {
  id: string; // ID编号，如 "lh-001"
  titleZh: string; // 本子名
  titleJp?: string; // 日文原名（可选）
  circle: string; // 作者
  authorUrl?: string; // 作者主页外链（可选，如Pixiv等）
  createdAt?: string; // 归档加入时间（旧作品可能没有）
  updatedAt?: string; // 最近发布或更新的时间
  category?: DoujinCategory; // 分类（如未填默认为漫画本）
  tags: string[]; // 标签，如 ["自设世界观", "现代", "含R18"]
  source?: string; // 来源，如 "塔比欧卡"
  translator?: string; // 汉化，如 "LG"
  typesetter?: string; // 嵌字，如 "LG"
  pages: number; // 总页数，如 30
  coverFile?: string; // 封面文件名，若不填默认自动映射为 "image01.webp"；也允许直接写 http(s) 绝对地址
  bookFolder?: string; // 存储桶子目录，若不填默认自动映射为 id (如 "lh-001")
  pagePrefix?: string; // 图片前缀，默认为 "image"
  pagePadDigits?: number; // 页码位数，默认为 2 (如 image01.webp)
  pageFiles?: string[]; // 后台上传时记录每一页的真实文件名，可混用 jpg/png/webp
  warning?: string; // 内容预警说明（后台勾选后填写，站点卡片显示 ⚠ 提示）
  storageProvider?: 'cos' | 'r2';
  sensitiveLevel?: 'safe' | 'mild-r18';
  /**
   * 敏感内容标记：后台勾选「含有敏感元素」后上传的本子。
   * 正文不是图片，而是 comic_vault/{id}_secure.txt —— AES 双重加密后的密文，
   * 站点必须走 SecureComicReader（403 伪装页 + 双重解密 + Canvas 渲染）才看得到。
   *
   * 注意：标记为 secure 时，`coverFile` 指向的是后台「敏感本封面」单独上传的**明文**图
   * （{bookFolder}/cover.<ext>），是公开可读的，卡片照常显示；不填则卡片只显示隔离占位图。
   */
  secure?: boolean;
}

/** 在线小说元数据（管理台「D 在线小说」→ 云函数 → COS novels.json；正文在 novels/{id}.txt） */
export interface GroupNovel {
  id: string; // 'nv-' + 时间戳36进制 + 随机
  title: string;
  author: string;
  authorUrl?: string; // 作者主页链接（可选）
  chars: number; // 正文字数（云函数计算）
  createdAt: string; // ISO
  updatedAt?: string;
  authorNote?: string; // 作者说的话：卡片引用块 + 阅读器顶部；空则不渲染
  encrypted?: boolean; // 正文已深度加密：存于 novels_vault/{id}_secure.txt，阅读器解密后展示
  warning?: string; // 内容预警：卡片琥珀条 + 阅读器顶部；空则不渲染
  tags?: string[]; // 卡片标签行；空则整行不渲染
  uid?: string; // 上传者 uid（novelDirectPublish 记录）：前台「编辑自己的小说」按它判定归属；旧篇与合订本没有
  isRelayCompiled?: boolean; // 是否为故事接龙合订本
  relayAuthors?: string[]; // 所有接力的人（依序排列）
  relayStepsCount?: number; // 接力总棒数
  prompt?: string; // 起笔设定
  bodyContent?: string; // 完整编译正文内容
  originalPostId?: string; // 关联论坛贴ID
}
