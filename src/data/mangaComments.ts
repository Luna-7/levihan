export interface MangaComment {
  id: string;
  bookId: string;
  author: string;
  content: string;
  timestamp: string;
}

const STORAGE_KEY = 'levihan_manga_comments_store_v1';

// 为漫画本预置真实同好读者评论
const INITIAL_MANGA_COMMENTS: MangaComment[] = [
  {
    id: 'mc-lh001-1',
    bookId: 'lh-001',
    author: '大吉岭红茶客',
    content: '画风与分镜张力太神了！利威尔眼底的温柔全在细微表情里，韩吉的狂气与脆弱感拿捏得淋漓尽致，反复重温！',
    timestamp: '2024-02-14 21:30',
  },
  {
    id: 'mc-lh001-2',
    bookId: 'lh-001',
    author: '护目镜修理工',
    content: '分镜的情感递进真的好细腻，两个背负着人类最沉重命运的人，在这个世界里终于能互相拥抱彼此的伤痕。',
    timestamp: '2024-03-05 14:15',
  },
  {
    id: 'mc-lh001-3',
    bookId: 'lh-001',
    author: '玛利亚之墙哨兵',
    content: '汉化嵌字辛苦了！感谢汉化组的无私分享，汉化质量和排版都极高，给兵团粮仓献出心脏！',
    timestamp: '2024-04-10 09:42',
  },
  {
    id: 'mc-lh002-1',
    bookId: 'lh-002',
    author: '利韩战术研究员',
    content: '战斗与日常交织的节奏感太棒了，这才是调查兵团灵魂伴侣的默契！',
    timestamp: '2024-05-01 16:20',
  },
  {
    id: 'mc-lh002-2',
    bookId: 'lh-002',
    author: '地下街老邻居',
    content: '超喜欢这本的叙事风格，后劲特别大，看完久久不能平静。',
    timestamp: '2024-05-18 20:05',
  },
];

export const getStoredComments = (): MangaComment[] => {
  if (typeof window === 'undefined') return INITIAL_MANGA_COMMENTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_MANGA_COMMENTS;
    const userComments = JSON.parse(raw);
    if (Array.isArray(userComments)) {
      const existingIds = new Set(userComments.map((c: MangaComment) => c.id));
      const combined = [
        ...userComments,
        ...INITIAL_MANGA_COMMENTS.filter((c) => !existingIds.has(c.id)),
      ];
      return combined;
    }
  } catch (e) {
    console.warn('Failed to load manga comments:', e);
  }
  return INITIAL_MANGA_COMMENTS;
};

export const saveCommentsToStorage = (comments: MangaComment[]): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(comments));
  } catch (e) {
    console.warn('Failed to save manga comments:', e);
  }
};

export const getCommentsByBookId = (bookId: string): MangaComment[] => {
  const all = getStoredComments();
  return all.filter((c) => c.bookId === bookId || (bookId.startsWith('lh-') && c.bookId === bookId.toLowerCase()));
};

export const getCommentCountByBookId = (bookId: string): number => {
  return getCommentsByBookId(bookId).length;
};

export const addCommentToBook = (
  bookId: string,
  author: string,
  content: string
): MangaComment => {
  const now = new Date();
  const formattedTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const newComment: MangaComment = {
    id: `mc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    bookId,
    author: author.trim() || '匿名调查兵',
    content: content.trim(),
    timestamp: formattedTime,
  };

  const all = getStoredComments();
  const updated = [newComment, ...all];
  saveCommentsToStorage(updated);
  return newComment;
};
