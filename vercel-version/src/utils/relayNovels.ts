import { GroupNovel } from '../types/doujinArchive';
import { ForumPost, ForumComment } from '../components/RestaurantForum';

const FORUM_STORAGE_KEYS = [
  'levihan_restaurant_forum_v7',
  'levihan_restaurant_forum_v6',
  'levihan_restaurant_forum_v5',
];

export const LEVIHAN_OPEN_DOUJIN_EVENT = 'levihan-open-doujin-novel';
export const LEVIHAN_RELAY_UPDATED_EVENT = 'levihan-relay-posts-updated';

export interface OpenDoujinNovelDetail {
  novel?: GroupNovel;
  novelId?: string;
  category?: string;
  seg?: string;
  autoRead?: boolean;
}

/**
 * 将单个故事接龙帖子编译转换为在线小说（GroupNovel）
 */
export function compileRelayPostToNovel(post: ForumPost): GroupNovel {
  const relayComments = (post.comments || []).filter((c) => c.relayStep !== undefined || (c.body && c.body.length > 0));
  
  // 按照接力顺序组织所有执笔作者列表（保留先后顺序，去重展示）
  const allAuthorsInOrder = [post.author, ...relayComments.map((c) => c.author)];
  const distinctAuthors = Array.from(new Set(allAuthorsInOrder.filter(Boolean)));

  let totalChars = (post.body || '').length;
  relayComments.forEach((c) => {
    totalChars += (c.body || '').length;
  });

  // 格式化正文排版（包含章节头部、安科判定点以及末尾联名）
  const sections: string[] = [];

  if (post.prompt) {
    sections.push(`【起笔设定】\n${post.prompt}`);
  }

  sections.push(`【第 1 棒 · 执笔：${post.author}】\n${post.body}`);

  relayComments.forEach((comment, idx) => {
    const diceInfo = comment.diceRoll ? ` · 🎲 1D100=${comment.diceRoll.value}${comment.diceRoll.verdict ? ` (${comment.diceRoll.verdict})` : ''}` : '';
    sections.push(`【第 ${idx + 2} 棒 · 执笔：${comment.author}${diceInfo}】\n${comment.body}`);
  });

  sections.push(`──────────────────────────────────\n【兵团同好手稿联合署名】\n${distinctAuthors.join('  ✖️  ')}`);

  const compiledBody = sections.join('\n\n');

  return {
    id: `relay-novel-${post.id}`,
    title: post.title,
    author: `${post.author} 等 ${distinctAuthors.length} 位同好`,
    chars: totalChars,
    createdAt: post.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isRelayCompiled: true,
    relayAuthors: distinctAuthors,
    relayStepsCount: relayComments.length + 1,
    prompt: post.prompt,
    bodyContent: compiledBody,
    originalPostId: post.id,
    authorNote: post.prompt ? `起笔设定：${post.prompt}` : undefined,
    tags: ['故事接龙', '合订本', `${relayComments.length + 1}棒连缀`],
  };
}

/**
 * 获取当前所有已存在的接龙帖子并转为在线小说列表
 */
export function getAllCompiledRelayNovels(currentPosts?: ForumPost[]): GroupNovel[] {
  let posts: ForumPost[] = [];

  if (currentPosts && currentPosts.length > 0) {
    posts = currentPosts;
  } else {
    for (const key of FORUM_STORAGE_KEYS) {
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            posts = parsed;
            break;
          }
        }
      } catch {
        /* continue */
      }
    }
  }

  const relayPosts = posts.filter((p) => p.category === 'relay');
  return relayPosts.map(compileRelayPostToNovel);
}

/**
 * 触发跳转到「土豆粮仓 · 小说本 · 在线小说」卡片列表
 */
export function jumpToCompiledNovelInDoujinArchive(novel: GroupNovel, autoRead = false) {
  if (typeof window === 'undefined') return;
  const detail: OpenDoujinNovelDetail = {
    novel,
    novelId: novel.id,
    category: '小说本',
    seg: '在线小说',
    autoRead,
  };
  window.dispatchEvent(new CustomEvent(LEVIHAN_OPEN_DOUJIN_EVENT, { detail }));
}
