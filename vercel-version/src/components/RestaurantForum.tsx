import React, { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  MessageCircle, Plus, X, Feather, Dice5, Copy, Check, BookOpen, Sparkles, RefreshCw,
  Lock, Unlock, ChevronDown, ChevronUp, Send, Upload, Link as LinkIcon, DollarSign,
  AlertTriangle, Search, PlusCircle, ShieldAlert,
  Trash2, ChevronLeft, ChevronRight, ShoppingBag, Share2, PenLine
} from 'lucide-react';
import { soundManager } from '../utils/audio';
import { getAccessToken, getCurrentUid, getCurrentProfile } from '../utils/cloudbaseToken';
import { ADMIN_UPLOAD_ENDPOINT } from '../utils/cloudbaseEndpoint';
import { CardPatternOverlay } from './CardPatternOverlay';
import { CharacterArt, spriteRef } from './CharacterArt';
import { TeaPartyInteractiveZipline } from './TeaPartyInteractiveZipline';
import { compileRelayPostToNovel, jumpToCompiledNovelInDoujinArchive } from '../utils/relayNovels';
import { MarketItem, INITIAL_MARKET_ITEMS } from './PotatoMarket';
import { TeaPartyShareModal, ShareTargetData } from './TeaPartyShareModal';

export type PostCategory = 'chat' | 'relay' | 'roleplay' | 'market';

export type ForumComment = {
  id: string;
  author: string;
  uid?: string;
  characterName?: string;
  characterAvatar?: string;
  isHost?: boolean;
  body: string;
  createdAt: string;
  potatoes?: number;
  potatoGiven?: boolean;
  diceRoll?: {
    sides: number;
    value: number;
    verdict?: string;
  };
  relayStep?: number;
  wordCount?: number;
};

export type QuillClaim = {
  claimedBy: string;
  claimedAt: number;
  expiresAt: number;
  relayStep: number;
};

export type ForumPost = {
  id: string;
  category: PostCategory;
  author: string;
  uid?: string;
  title?: string;
  body: string;
  prompt?: string;
  image?: string;
  characterName?: string;
  characterImage?: string;
  potatoes: number;
  potatoGiven?: boolean;
  createdAt: string;
  comments: ForumComment[];
  quillClaim?: QuillClaim;
};

export interface RoleplayCharacter {
  id: string;
  name: string;
  /** Circular avatar source — a `sprite:` head close-up for the roster, data URL for uploads. */
  avatar: string;
  /** Full-body illustration for the card column. Falls back to `avatar` when absent. */
  illustration?: string;
  isPreset?: boolean;
}

const STORAGE_KEY = 'levihan_restaurant_forum_v7';
const LEGACY_STORAGE_KEY = 'levihan_restaurant_forum_v6';
const CUSTOM_CHARS_KEY = 'levihan_custom_roleplay_chars_v1';
const RELAY_MIN_WORDS = 500;
const CLAIM_DURATION_MS = 24 * 60 * 60 * 1000;

/** Heads render as small circles, so they live in the atlas as square close-ups. */
const castEntry = (slug: string, name: string): RoleplayCharacter => ({
  id: `char-${slug}`,
  name,
  avatar: spriteRef(`char-${slug}-head`),
  illustration: spriteRef(`char-${slug}`),
  isPreset: true,
});

/** The roster's first entry is the composer's default voice, so the 茶会 host leads. */
export const PRESET_CHARACTERS: RoleplayCharacter[] = [
  castEntry('levi', '利威尔'),
  castEntry('hange', '韩吉'),
  castEntry('armin', '阿尔敏'),
  castEntry('historia', '希斯特利亚'),
  castEntry('eren', '艾伦'),
  castEntry('jean', '让'),
  castEntry('mikasa', '三笠'),
  castEntry('sasha', '莎夏'),
  castEntry('connie', '柯尼'),
  castEntry('erwin', '艾尔文'),
  castEntry('reiner', '莱纳'),
  castEntry('annie', '阿尼'),
];

/** Alternate spellings that historical posts and comments were saved under. */
const CHARACTER_ALIASES: Record<string, string> = {
  萨沙: '莎夏',
  萨莎: '莎夏',
};

/**
 * Artwork that posts and comments recorded before the characters moved into the
 * sprite atlas. Kept so the existing localStorage history and the seed posts
 * show the new portraits instead of the retired placeholders.
 */
const LEGACY_ART_OWNER: Record<string, string> = {
  '/images/characters/levi_tea.jpg': '利威尔',
  '/images/characters/hange_angel.jpg': '韩吉',
  'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=300&auto=format&fit=crop&q=80': '艾尔文',
  'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300&auto=format&fit=crop&q=80': '莎夏',
};

const presetFor = (name?: string): RoleplayCharacter | undefined => {
  const key = name?.trim();
  if (!key) return undefined;
  const canonical = CHARACTER_ALIASES[key] || key;
  return PRESET_CHARACTERS.find((c) => c.name === canonical);
};

const artworkOf = (char: RoleplayCharacter) => ({
  avatar: char.avatar,
  illustration: char.illustration || char.avatar,
});

/**
 * Picks the artwork for one roleplay identity. Resolution order matters: a data
 * URL is a deliberate user upload and always wins, then the character's name is
 * matched so pre-atlas posts upgrade, and only then does the raw stored value
 * stand in.
 */
const resolveArtwork = (name: string | undefined, stored: string | undefined) => {
  const value = stored?.trim();
  if (value?.startsWith('data:')) return { avatar: value, illustration: value };
  const owner = presetFor(name) || presetFor(LEGACY_ART_OWNER[value || '']);
  if (owner) return artworkOf(owner);
  if (value) return { avatar: value, illustration: value };
  return artworkOf(PRESET_CHARACTERS[0]);
};

const PROMPT_CHARACTERS = ['利威尔', '韩吉', '艾尔文', '萨沙', '让', '阿尔敏', '三笠', '莫布利特'];
const PROMPT_LOCATIONS = ['巨树森林深处', '调查兵团旧本部地下室', '玛利亚之墙顶端日落时', '兵长专用茶室', '暴雨夜的特训营地', '特罗斯特区旧书肆', '雪山补给哨所'];
const PROMPT_ITEMS = ['一罐特调红茶罐', '一本泛黄的巨人实验手稿', '一副备用护目镜', '一块新鲜烘焙的蛋糕', '一枚磨损的自由之翼徽章', '一封未寄出的密信'];
const PROMPT_EVENTS = ['突发暴雨被困在木屋里', '不小心打翻了实验溶剂', '发现了一张神秘的壁外藏宝地图', '被要求一起整理一整间档案室', '深夜在屋顶偶遇看星空'];

const generateInspirationPrompt = (): string => {
  const char1 = PROMPT_CHARACTERS[Math.floor(Math.random() * PROMPT_CHARACTERS.length)];
  const char2 = PROMPT_CHARACTERS[Math.floor(Math.random() * PROMPT_CHARACTERS.length)];
  const loc = PROMPT_LOCATIONS[Math.floor(Math.random() * PROMPT_LOCATIONS.length)];
  const item = PROMPT_ITEMS[Math.floor(Math.random() * PROMPT_ITEMS.length)];
  const evt = PROMPT_EVENTS[Math.floor(Math.random() * PROMPT_EVENTS.length)];
  
  return char1 === char2
    ? `【${char1}】在【${loc}】带着【${item}】，准备【${evt}】。`
    : `【${char1}】与【${char2}】在【${loc}】围绕【${item}】，因为【${evt}】。`;
};

const formatTimeRemaining = (expiresAt: number, now: number): string => {
  const diff = expiresAt - now;
  if (diff <= 0) return '00:00';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}h ${pad(minutes)}m`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
};

const seedPosts: ForumPost[] = [
  {
    id: 'rp-levi-tea',
    category: 'roleplay',
    author: '利威尔',
    characterName: '利威尔',
    characterImage: '/images/characters/levi_tea.jpg',
    title: '关于红茶温度与调查报告',
    body: '“喂，四眼，手稿上的墨水又蹭到桌布上了。先去把手洗干净，红茶要是凉了就毫无意义。桌上的发光晶体样本我已经用防潮盒封好了，别用你那沾满泥巴的手去乱碰。”',
    potatoes: 48,
    createdAt: '15分钟前',
    comments: [
      {
        id: 'c-rp-1',
        author: '韩吉',
        characterName: '韩吉',
        characterAvatar: '/images/characters/hange_angel.jpg',
        isHost: false,
        body: '“诶——利威尔！那可是我花了一整天才从旧本部后山挖出来的共鸣矿石！怎么能算泥巴呢！不过……今天的红茶真好喝，加了佛手柑吗？”',
        createdAt: '10分钟前',
        potatoes: 18,
      },
      {
        id: 'c-rp-1-reply',
        author: '利威尔',
        characterName: '利威尔',
        characterAvatar: '/images/characters/levi_tea.jpg',
        isHost: true,
        body: '“啧，谁允许你擅自换话题了。把手洗干净之前不准碰茶杯。”',
        createdAt: '6分钟前',
        potatoes: 32,
      },
    ],
  },
  {
    id: 'rp-hange-wings',
    category: 'roleplay',
    author: '韩吉',
    characterName: '韩吉',
    characterImage: '/images/characters/hange_angel.jpg',
    title: '夜巡归来的全新灵感！',
    body: '“大家快看我手里的羽毛笔！今晚在巨树森林巡逻时，我发现风向和热气流的流动有非常奇妙的规律！只要调整立体机动装置的气阀喷射角度，说不定能在空中滑翔更久！利威尔，明天要不要和我去实地测试看看？”',
    potatoes: 56,
    createdAt: '35分钟前',
    comments: [
      {
        id: 'c-rp-2',
        author: '莫布利特',
        characterName: '莫布利特',
        isHost: false,
        body: '“分队长——！请千万不要在没有挂安全绳的情况下直接测试啊！利威尔兵长您也快劝劝她吧！”',
        createdAt: '25分钟前',
        potatoes: 22,
      },
      {
        id: 'c-rp-2-reply',
        author: '韩吉',
        characterName: '韩吉',
        characterAvatar: '/images/characters/hange_angel.jpg',
        isHost: true,
        body: '“莫布利特你太容易紧张啦！这次我让利威尔在树枝下面当缓冲网不就好了嘛～”',
        createdAt: '18分钟前',
        potatoes: 35,
      },
    ],
  },
  {
    id: 'relay-tea-room',
    category: 'relay',
    author: '利威尔的小茶杯',
    title: '暴雨夜 · 旧茶室未完成的研究手稿',
    prompt: '【利威尔】与【韩吉】在【兵长专用茶室】围绕【一本泛黄的巨人实验手稿】，因为【突发暴雨被困在木屋里】。',
    body: '窗外雷声大作，狂风裹挟着雨点密集地拍打在旧木窗的玻璃上，发出沉闷的震颤。利威尔蹙着眉将刚泡好的红茶端至桌前，杯口升腾着醇厚微苦的佛手柑香气。壁炉里的橡木柴火噼啪作响，火光将两人的影子拉长并投射在斑驳的石墙上。桌案正中央，赫然摊开着韩吉三年前留下的半篇实验笔记——页脚泛黄卷曲，上面密密麻麻记录着关于巨人硬质化与神经传导的猜想，其间还夹杂着几滴早已风干的墨迹与未知咖啡渍。利威尔拉开木椅坐下，目光落在那段未写完的段落上，指腹轻轻摩挲着微烫的骨瓷杯壁。',
    potatoes: 42,
    createdAt: '1小时前',
    comments: [
      {
        id: 'c-alpha-1',
        author: '护目镜反光',
        relayStep: 2,
        body: '厚重的橡木门突然被猛地撞开，伴随着一阵湿漉漉的冷风，浑身湿透的韩吉跌跌撞撞地闯了进来。护目镜上早已凝结了一层浓厚的白雾，连睫毛上都挂着晶莹的雨水。然而她的眼睛却在镜片后闪烁着近乎疯狂的亮光，双手如获至宝般死死护在胸口，掌心里赫然攥着刚从旧本部后山泥沼深处挖出的未知发光矿石样本。“利威尔！快看！手稿上第三页提到的晶体共鸣现象是真的！”她一边喘着粗气一边将湿淋淋的样本重重拍在桌案上，溅起的泥水甚至擦过了利威尔熨烫整齐的白领巾。壁炉的火光照亮了她兴奋得发红的面颊，空气中瞬间混杂了泥土的腥甜与红茶的暖香。',
        createdAt: '45分钟前',
        potatoes: 15,
        wordCount: 520,
        diceRoll: { sides: 100, value: 88, verdict: '大成功 · 样本完好' },
      },
      {
        id: 'c-alpha-2',
        author: '红茶保洁员',
        relayStep: 3,
        body: '“喂，四眼，先把水擦干净再踏进我的地板。”利威尔面无表情地挑起眉梢，虽然嘴上嫌弃地责备着，手中却早已极其熟练地抽出了搭在椅背上的干燥粗麻毛巾，顺势一把罩在韩吉那乱糟糟的湿发上，粗暴却不失力道地揉搓了几下。随后，他将那杯温度刚好的热红茶不偏不倚地推到了韩吉冻得发白的手指边。“喝掉，别在我的茶室里感冒打喷嚏，那会污染空气。”利威尔俯身捻起那枚散发着微弱磷光的矿石，借着烛火将其缓缓对准手稿上晦涩的符号。两人的距离在狭窄的灯影下骤然拉近，连彼此平稳与急促交织的呼吸声都清晰可闻。',
        createdAt: '30分钟前',
        potatoes: 20,
        wordCount: 512,
      },
    ],
    quillClaim: undefined,
  },
  {
    id: 'restaurant-welcome',
    category: 'chat',
    author: '茶会值班兵',
    title: '团长茶话会今日开放',
    body: '欢迎来到调查兵团团长茶话会。在此可进行日常闲聊、分享同好图文与灵感交流。',
    potatoes: 28,
    createdAt: '刚刚',
    comments: [{ id: 'welcome-comment', author: '调查兵', body: '先给茶话会送上一杯热红茶和切块蛋糕！', createdAt: '刚刚' }],
  },
  {
    id: 'restaurant-topic',
    category: 'chat',
    author: '眼镜维修班',
    title: '旧本部森林篇回想',
    body: '那些没有说出口的默契，隔了很多年再看依然很动人。',
    potatoes: 16,
    createdAt: '2小时前',
    comments: [],
  },
];

const loadPosts = (): ForumPost[] => {
  try {
    const v7 = localStorage.getItem(STORAGE_KEY);
    if (v7) return JSON.parse(v7);
    const v6 = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (v6) {
      const parsed = JSON.parse(v6);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const userAdded = parsed.filter(
          (p) => !p.id.startsWith('rp-') && p.id !== 'relay-tea-room' && p.id !== 'restaurant-welcome' && p.id !== 'restaurant-topic'
        );
        return [...seedPosts, ...userAdded];
      }
    }
    return seedPosts;
  } catch {
    return seedPosts;
  }
};

interface Props {
  onBack?: () => void;
  onShowToast: (message: string) => void;
  initialCategory?: 'all' | 'chat' | 'relay' | 'roleplay' | 'market';
}

const MARKET_STORAGE_KEY = 'levihan_market_items';

export const RestaurantForum: React.FC<Props> = ({ onShowToast, initialCategory }) => {
  const [posts, setPosts] = useState<ForumPost[]>(loadPosts);
  const [activeCategory, setActiveCategory] = useState<'all' | 'chat' | 'relay' | 'roleplay' | 'market'>(initialCategory || 'all');
  const [now, setNow] = useState<number>(Date.now());
  const [currentUid, setCurrentUid] = useState<string | null>(null);

  // Market states (土豆市集)
  const [marketItems, setMarketItems] = useState<MarketItem[]>(() => {
    try {
      const stored = localStorage.getItem(MARKET_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // 旧版种进缓存的样品卡片（id 以 init- 开头）一律过滤，列表以 marketList 后端数据为准
        const cleaned = Array.isArray(parsed) ? parsed.filter((item: MarketItem) => !item.id?.startsWith('init-')) : [];
        if (cleaned.length > 0) return cleaned;
      }
      localStorage.setItem(MARKET_STORAGE_KEY, JSON.stringify(INITIAL_MARKET_ITEMS));
      return INITIAL_MARKET_ITEMS;
    } catch {
      return INITIAL_MARKET_ITEMS;
    }
  });
  const [marketSearchQuery, setMarketSearchQuery] = useState<string>('');
  const [selectedMarketItem, setSelectedMarketItem] = useState<MarketItem | null>(null);
  const [activeMarketDetailImageIndex, setActiveMarketDetailImageIndex] = useState<number>(0);
  const [isPreviewLargeOpen, setIsPreviewLargeOpen] = useState<boolean>(false);
  const [previewLargeSrc, setPreviewLargeSrc] = useState<string | null>(null);

  // Category Drag to Scroll handlers
  const categoryScrollRef = useRef<HTMLDivElement>(null);
  const isCategoryDraggingRef = useRef<boolean>(false);
  const categoryStartXRef = useRef<number>(0);
  const categoryScrollLeftRef = useRef<number>(0);
  const categoryDragDistanceRef = useRef<number>(0);
  const [isCategoryDraggingUI, setIsCategoryDraggingUI] = useState<boolean>(false);

  const handleCategoryMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!categoryScrollRef.current) return;
    isCategoryDraggingRef.current = true;
    setIsCategoryDraggingUI(true);
    categoryStartXRef.current = e.clientX;
    categoryScrollLeftRef.current = categoryScrollRef.current.scrollLeft;
    categoryDragDistanceRef.current = 0;
  };

  const handleCategoryMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCategoryDraggingRef.current || !categoryScrollRef.current) return;
    const dx = e.clientX - categoryStartXRef.current;
    categoryDragDistanceRef.current = Math.abs(dx);
    categoryScrollRef.current.scrollLeft = categoryScrollLeftRef.current - dx;
  };

  const handleCategoryMouseUpOrLeave = () => {
    isCategoryDraggingRef.current = false;
    setIsCategoryDraggingUI(false);
  };

  const handleCategoryWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!categoryScrollRef.current) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && Math.abs(e.deltaY) > 0) {
      categoryScrollRef.current.scrollLeft += e.deltaY;
    }
  };

  const handleCategoryTabClick = (categoryKey: 'all' | 'chat' | 'roleplay' | 'relay' | 'market') => {
    if (categoryDragDistanceRef.current > 6) {
      return; // Dragged, prevent accidental click
    }
    soundManager.playFilterClick();
    setActiveCategory(categoryKey);
  };

  // Market publication form states (inside composer)
  const [marketFormTitle, setMarketFormTitle] = useState<string>('');
  const [marketFormPrice, setMarketFormPrice] = useState<string>('');
  const [marketFormLink, setMarketFormLink] = useState<string>('');
  const [marketFormDesc, setMarketFormDesc] = useState<string>('');
  const [marketFormImages, setMarketFormImages] = useState<string[]>([]);
  const [activeMarketUploadPreviewIndex, setActiveMarketUploadPreviewIndex] = useState<number>(0);
  const [isMarketDragging, setIsMarketDragging] = useState<boolean>(false);
  const marketFileInputRef = useRef<HTMLInputElement>(null);

  // Roleplay Character Selector State
  const [customChars, setCustomChars] = useState<RoleplayCharacter[]>(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_CHARS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [selectedChar, setSelectedChar] = useState<RoleplayCharacter>(PRESET_CHARACTERS[0]);
  const [pendingCustomImage, setPendingCustomImage] = useState<string | null>(null);
  const [pendingCharName, setPendingCharName] = useState('');

  // Composer Modal
  const [showComposer, setShowComposer] = useState(false);
  // 土豆市集专用发布弹窗（已从通用发布弹窗中剥离，市集物资只走「发布市集物资」入口）
  const [showMarketComposer, setShowMarketComposer] = useState(false);
  const [composeCategory, setComposeCategory] = useState<PostCategory>('roleplay');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [prompt, setPrompt] = useState('天空');
  const [image, setImage] = useState<string | undefined>();
  const [publishing, setPublishing] = useState(false);

  // 故事接龙编辑弹窗（仅自己发布的接龙可编辑）
  const [editingRelay, setEditingRelay] = useState<ForumPost | null>(null);
  const [relayEditTitle, setRelayEditTitle] = useState('');
  const [relayEditPrompt, setRelayEditPrompt] = useState('');
  const [relayEditBody, setRelayEditBody] = useState('');
  const [savingRelayEdit, setSavingRelayEdit] = useState(false);

  // Comments & Relay Replies
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  // 发帖署名默认留空，待账号档案加载后由 mount 副作用填入「账号昵称」。
  // 语C 分类不发署名（身份=所选拟音人物），其余分类的署名输入框默认显示账号昵称。
  // 注意：选角动作不再改写 nickname，避免把拟音人物名带进闲聊/接龙/市集的署名。
  const [nickname, setNickname] = useState('');
  const [commenterChars, setCommenterChars] = useState<Record<string, RoleplayCharacter>>({});

  // Share Modal & Deep Link Highlights
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);
  const [shareTarget, setShareTarget] = useState<ShareTargetData | null>(null);
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);

  // 深度链接解析与自动定位 (Deep Linking)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const targetCategory = params.get('category') as any;
    const targetPostId = params.get('postId');
    const targetItemId = params.get('itemId');

    if (targetCategory && ['all', 'chat', 'relay', 'roleplay', 'market'].includes(targetCategory)) {
      setActiveCategory(targetCategory);
    }

    if (targetItemId) {
      setActiveCategory('market');
      const item = marketItems.find((m) => m.id === targetItemId);
      if (item) {
        setSelectedMarketItem(item);
      }
    }

    if (targetPostId) {
      setOpenComments(targetPostId);
      setHighlightedPostId(targetPostId);
      setTimeout(() => {
        const el = document.getElementById(`post-${targetPostId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);

      const timer = setTimeout(() => {
        setHighlightedPostId(null);
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [marketItems]);

  const saveMarketItems = (updated: MarketItem[]) => {
    setMarketItems(updated);
    try {
      localStorage.setItem(MARKET_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      /* ignore */
    }
  };

  // Listen for open market event
  useEffect(() => {
    const handleOpenMarket = () => {
      setActiveCategory('market');
    };
    window.addEventListener('levihan-open-market', handleOpenMarket);
    return () => window.removeEventListener('levihan-open-market', handleOpenMarket);
  }, []);

  const getCommenterForPost = (post: ForumPost): RoleplayCharacter => {
    if (commenterChars[post.id]) {
      return commenterChars[post.id];
    }
    if (selectedChar) {
      return selectedChar;
    }
    return PRESET_CHARACTERS[0];
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const allCharacters = useMemo(() => {
    return [...PRESET_CHARACTERS, ...customChars];
  }, [customChars]);

  /** Illustration for the card's right-hand column, plus the circle for its top bar. */
  const getPostArtwork = (post: ForumPost) =>
    resolveArtwork(post.characterName || post.author, post.characterImage);

  const handleSelectCharacter = (char: RoleplayCharacter) => {
    soundManager.playCoin();
    setSelectedChar(char);
    onShowToast(`已选定拟音形象【${char.name}】`);
  };

  const handleCustomCharFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return onShowToast('仅支持图片');
    if (file.size > 2 * 1024 * 1024) return onShowToast('图片不能超过 2MB');
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null;
      if (result) {
        setPendingCustomImage(result);
        setPendingCharName('');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmCustomChar = () => {
    if (!pendingCustomImage) return;
    const name = pendingCharName.trim() || '新角色';
    const newChar: RoleplayCharacter = {
      id: `char-custom-${Date.now()}`,
      name,
      avatar: pendingCustomImage,
      isPreset: false,
    };
    const next = [newChar, ...customChars];
    setCustomChars(next);
    try {
      localStorage.setItem(CUSTOM_CHARS_KEY, JSON.stringify(next));
    } catch {
      /* storage fallback */
    }
    setSelectedChar(newChar);
    setPendingCustomImage(null);
    setPendingCharName('');
    soundManager.playCoin();
    onShowToast(`已添加新角色【${newChar.name}】`);
  };

  const api = async (action: string, fields: Record<string, unknown> = {}) => {
    const headers: Record<string, string> = { 'Content-Type': 'text/plain;charset=UTF-8' };
    const at = await getAccessToken();
    if (at) headers['Authorization'] = `Bearer ${at}`;
    const response = await fetch(ADMIN_UPLOAD_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, ...fields }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || '服务暂不可用');
    return result;
  };

  useEffect(() => {
    void api('forumList')
      .then((result) => {
        if (Array.isArray(result.posts) && result.posts.length > 0) {
          persist(result.posts);
        }
      })
      .catch(() => undefined);

    void api('marketList')
      .then((result) => {
        if (Array.isArray(result.items) && result.items.length > 0) {
          setMarketItems(result.items);
          localStorage.setItem(MARKET_STORAGE_KEY, JSON.stringify(result.items));
        }
      })
      .catch(() => undefined);

    void getCurrentUid().then((uid) => { if (uid) setCurrentUid(uid); }).catch(() => undefined);

    void (async () => {
      try {
        const profile = await getCurrentProfile();
        if (!profile) return;
        // 发帖署名默认取账号昵称；空昵称则保留空串，由发布兜底('调查兵'/'匿名同好')
        if (profile.nickname) {
          setNickname(profile.nickname);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const persist = (next: ForumPost[]) => {
    setPosts(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('levihan-relay-posts-updated'));
      }
    } catch {
      /* storage fallback */
    }
  };

  const filteredPosts = useMemo(() => {
    if (activeCategory === 'all') return posts;
    return posts.filter((p) => (p.category || 'chat') === activeCategory);
  }, [posts, activeCategory]);

  const filteredMarketItems = useMemo(() => {
    const q = marketSearchQuery.toLowerCase().trim();
    return marketItems.filter((item) => {
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.nickname.toLowerCase().includes(q)
      );
    });
  }, [marketItems, marketSearchQuery]);

  const handleMarketFiles = (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (list.length === 0) {
      onShowToast('⚠️ 请上传图片格式的文件');
      return;
    }

    const currentCount = marketFormImages.length;
    if (currentCount >= 3) {
      onShowToast('⚠️ 最多只能上传 3 张图片哦');
      return;
    }

    const remainingSlots = 3 - currentCount;
    const toUpload = list.slice(0, remainingSlots);

    if (list.length > remainingSlots) {
      onShowToast(`⚠️ 最多上传 3 张图片。已自动加载前 ${remainingSlots} 张`);
    }

    toUpload.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setMarketFormImages((prev) => {
          const updated = [...prev, reader.result as string];
          setActiveMarketUploadPreviewIndex(updated.length - 1);
          return updated;
        });
        soundManager.playBlip();
      };
      reader.readAsDataURL(file);
    });
  };

  const handleDeleteMarketItem = async (id: string) => {
    const token = await getAccessToken();
    if (!token) {
      onShowToast('请先登录账号后再下架商品');
      window.dispatchEvent(new Event('levihan-open-login'));
      return;
    }
    const updated = marketItems.filter((item) => item.id !== id);
    saveMarketItems(updated);
    if (selectedMarketItem?.id === id) {
      setSelectedMarketItem(null);
    }
    void api('marketDelete', { id }).then((result) => {
      if (Array.isArray(result.items)) {
        setMarketItems(result.items);
        localStorage.setItem(MARKET_STORAGE_KEY, JSON.stringify(result.items));
      }
    }).catch((err) => onShowToast(err instanceof Error ? err.message : '下架失败'));
    soundManager.playSoftSwoosh();
    onShowToast('🗑️ 该物资已成功从市集下架！');
  };

  const handleDeletePost = async (postId: string) => {
    const token = await getAccessToken();
    if (!token) {
      onShowToast('请先登录账号后再删除帖子');
      window.dispatchEvent(new Event('levihan-open-login'));
      return;
    }
    const updated = posts.filter((p) => p.id !== postId);
    persist(updated);
    void api('forumDelete', { id: postId }).then((result) => {
      if (Array.isArray(result.posts)) persist(result.posts);
    }).catch((err) => onShowToast(err instanceof Error ? err.message : '删除失败'));
    soundManager.playWoodTap();
    onShowToast('帖子已删除');
  };

  // 编辑故事接龙（仅自己发布的帖子；目前后端仅开放 relay 分类）
  const openRelayEdit = (post: ForumPost) => {
    soundManager.playWoodTap();
    setRelayEditTitle(post.title || '');
    setRelayEditPrompt(post.prompt || '');
    setRelayEditBody(post.body || '');
    setEditingRelay(post);
  };

  const handleSaveRelayEdit = async () => {
    if (!editingRelay) return;
    const token = await getAccessToken();
    if (!token) {
      onShowToast('请先登录账号后再编辑接龙');
      window.dispatchEvent(new Event('levihan-open-login'));
      return;
    }
    const nextTitle = relayEditTitle.trim();
    const nextBody = relayEditBody.trim();
    if (!nextTitle || !nextBody) {
      onShowToast('标题和正文不能为空');
      return;
    }
    setSavingRelayEdit(true);
    try {
      const result = await api('forumEdit', {
        id: editingRelay.id,
        title: nextTitle,
        body: nextBody,
        prompt: relayEditPrompt.trim(),
      });
      if (Array.isArray(result.posts)) persist(result.posts);
      setEditingRelay(null);
      soundManager.playPageTurn();
      onShowToast('✏️ 接龙已更新，合订本已同步重编 📖');
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingRelayEdit(false);
    }
  };

  const handleDeleteComment = async (postId: string, commentId: string) => {
    const token = await getAccessToken();
    if (!token) {
      onShowToast('请先登录账号后再删除评论');
      window.dispatchEvent(new Event('levihan-open-login'));
      return;
    }
    const updated = posts.map((p) => p.id === postId ? { ...p, comments: (p.comments || []).filter((c) => c.id !== commentId) } : p);
    persist(updated);
    void api('forumCommentDelete', { postId, commentId }).then((result) => {
      if (Array.isArray(result.posts)) persist(result.posts);
    }).catch((err) => onShowToast(err instanceof Error ? err.message : '删除失败'));
    soundManager.playWoodTap();
    onShowToast('评论已删除');
  };

  const handleImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return onShowToast('仅支持图片');
    if (file.size > 2 * 1024 * 1024) return onShowToast('图片不能超过 2MB');
    const reader = new FileReader();
    reader.onload = () => setImage(typeof reader.result === 'string' ? reader.result : undefined);
    reader.readAsDataURL(file);
  };

  const handleDiceRollForComment = (postId: string) => {
    soundManager.playShuffle();
    const roll = Math.floor(Math.random() * 100) + 1;
    let verdict = '成功';
    if (roll >= 95) verdict = '极度大成功';
    else if (roll >= 80) verdict = '大成功';
    else if (roll <= 5) verdict = '大失败';
    else if (roll <= 25) verdict = '波折';
    
    const rollText = `\n【🎲 1D100=${roll} (${verdict})】\n`;
    setCommentDrafts((drafts) => ({
      ...drafts,
      [postId]: (drafts[postId] || '') + rollText,
    }));
    onShowToast(`🎲 1D100 = ${roll} (${verdict})`);
  };

  const handleInspirationForComment = (postId: string) => {
    soundManager.playWoodTap();
    const p = generateInspirationPrompt();
    setCommentDrafts((drafts) => ({
      ...drafts,
      [postId]: (drafts[postId] || '') + (drafts[postId] ? '\n\n' : '') + `【灵感】${p}\n`,
    }));
    onShowToast('✨ 灵感要素已填入');
  };

  const handleInsertFramework = (postId: string) => {
    soundManager.playWoodTap();
    const framework = `\n【环境】……\n【动作】……\n【对白】“……”\n【推进】……\n`;
    setCommentDrafts((drafts) => ({
      ...drafts,
      [postId]: (drafts[postId] || '') + framework,
    }));
    onShowToast('📝 框架已插入');
  };

  const handleClaimQuill = async (postId: string) => {
    const token = await getAccessToken();
    if (!token) {
      onShowToast('请先登录账号后再认领接龙');
      window.dispatchEvent(new Event('levihan-open-login'));
      return;
    }
    const currentAuthor = nickname.trim() || '调查兵';
    const targetPost = posts.find((p) => p.id === postId);
    if (!targetPost) return;

    if (targetPost.quillClaim && targetPost.quillClaim.expiresAt > now) {
      if (targetPost.quillClaim.claimedBy === currentAuthor) {
        setOpenComments(postId);
        return;
      }
      return onShowToast(`已被【${targetPost.quillClaim.claimedBy}】认领中`);
    }

    const nextStep = targetPost.comments.length + 2;
    const newClaim: QuillClaim = {
      claimedBy: currentAuthor,
      claimedAt: Date.now(),
      expiresAt: Date.now() + CLAIM_DURATION_MS,
      relayStep: nextStep,
    };

    const updated = posts.map((p) => (p.id === postId ? { ...p, quillClaim: newClaim } : p));
    persist(updated);
    void api('forumClaim', { postId, claimedBy: currentAuthor, claimDurationMs: CLAIM_DURATION_MS }).catch(() => undefined);
    setOpenComments(postId);
    soundManager.playScrollOpen();
    onShowToast(`🪶 认领第 ${nextStep} 棒 (24h)`);
  };

  const handleReleaseQuill = (postId: string) => {
    const targetPost = posts.find((p) => p.id === postId);
    if (!targetPost) return;

    const updated = posts.map((p) => (p.id === postId ? { ...p, quillClaim: undefined } : p));
    persist(updated);
    void api('forumReleaseClaim', { postId }).catch(() => undefined);
    soundManager.playWoodTap();
    onShowToast('羽毛笔已归还');
  };

  const publish = async (event: React.FormEvent) => {
    event.preventDefault();

    const token = await getAccessToken();
    if (!token) {
      onShowToast('请先登录账号后再发布');
      window.dispatchEvent(new Event('levihan-open-login'));
      return;
    }

    // 语C (角色拟音) 发布
    if (composeCategory === 'roleplay') {
      const activeChar = selectedChar || PRESET_CHARACTERS[0];
      // 语C 不提供署名输入：发布身份就是所选拟音人物本人
      const charName = activeChar.name;
      // Only the sprite ref / data URL is stored; the card illustration is
      // resolved from `characterImage` at render time so it stays in sync with
      // whichever 拟音人物 is selected.
      const charAvatar = activeChar.avatar;

      if (!body.trim() && !image) {
        return onShowToast('请输入对白或台词内容');
      }

      setPublishing(true);
      try {
        const postTitle = title.trim() || (body.trim().length > 18 ? body.trim().slice(0, 18) + '…' : `${charName}的心声`);
        const newPost: ForumPost = {
          id: `post-${Date.now()}`,
          category: 'roleplay',
          author: charName,
          uid: currentUid || undefined,
          characterName: charName,
          characterImage: charAvatar,
          title: postTitle,
          body: body.trim(),
          image,
          potatoes: 1,
          potatoGiven: false,
          createdAt: '刚刚',
          comments: [],
        };

        const updated = [newPost, ...posts];
        persist(updated);

        setTitle('');
        setBody('');
        setImage(undefined);
        setShowComposer(false);
        soundManager.playCoin();
        onShowToast(`已以【${charName}】身份发布角色拟音`);

        void api('forumPublish', {
          author: charName,
          title: postTitle,
          body: body.trim(),
          category: 'roleplay',
          characterName: charName,
          characterImage: charAvatar,
          imageBase64: image?.split(',')[1] || '',
        }).then((result) => {
          const serverPost = (result && result.post) as ForumPost | undefined;
          if (serverPost && serverPost.id) {
            setPosts((cur) => cur.map((p) => (p.id === newPost.id ? { ...p, ...serverPost, id: p.id } : p)));
          }
        }).catch(() => onShowToast('⚠️ 帖子同步失败（只保存在本机，其他设备看不到）'));
      } catch (error) {
        onShowToast(error instanceof Error ? error.message : '发布失败');
      } finally {
        setPublishing(false);
      }
      return;
    }

    // 闲聊茶歇发布
    if (composeCategory === 'chat') {
      const authorName = nickname.trim() || '调查兵';
      if (!body.trim() && !image) {
        return onShowToast('请输入闲聊内容');
      }

      setPublishing(true);
      try {
        const postTitle = title.trim() || (body.trim().length > 18 ? body.trim().slice(0, 18) + '…' : '茶歇闲聊');
        const newPost: ForumPost = {
          id: `post-${Date.now()}`,
          category: 'chat',
          author: authorName,
          uid: currentUid || undefined,
          title: postTitle,
          body: body.trim(),
          image: image,
          potatoes: 1,
          potatoGiven: false,
          createdAt: '刚刚',
          comments: [],
        };

        const updated = [newPost, ...posts];
        persist(updated);

        setTitle('');
        setBody('');
        setImage(undefined);
        setShowComposer(false);
        soundManager.playCoin();
        onShowToast('闲聊已发布');

        void api('forumPublish', {
          author: authorName,
          title: postTitle,
          body: body.trim(),
          category: 'chat',
          imageBase64: image?.split(',')[1] || '',
        }).then((result) => {
          const serverPost = (result && result.post) as ForumPost | undefined;
          if (serverPost && serverPost.id) {
            setPosts((cur) => cur.map((p) => (p.id === newPost.id ? { ...p, ...serverPost, id: p.id } : p)));
          }
        }).catch(() => onShowToast('⚠️ 帖子同步失败（只保存在本机，其他设备看不到）'));
      } catch (error) {
        onShowToast(error instanceof Error ? error.message : '发布失败');
      } finally {
        setPublishing(false);
      }
      return;
    }

    // 故事接龙发布
    if (composeCategory === 'relay') {
      const authorName = nickname.trim() || '调查兵';
      if (!title.trim()) {
        return onShowToast('请填写故事标题');
      }
      if (!body.trim()) {
        return onShowToast('请填写第1棒开篇正文');
      }

      setPublishing(true);
      try {
        const newPost: ForumPost = {
          id: `post-${Date.now()}`,
          category: 'relay',
          author: authorName,
          uid: currentUid || undefined,
          title: title.trim(),
          body: body.trim(),
          prompt: prompt,
          image: image,
          potatoes: 1,
          potatoGiven: false,
          createdAt: '刚刚',
          comments: [],
          quillClaim: undefined,
        };

        const updated = [newPost, ...posts];
        persist(updated);

        setTitle('');
        setBody('');
        setImage(undefined);
        setShowComposer(false);
        soundManager.playCoin();
        onShowToast('故事接龙手稿已发布，合订本已自动建立 📖');

        void api('forumPublish', {
          author: authorName,
          title: title.trim(),
          body: body.trim(),
          category: 'relay',
          prompt: prompt,
          imageBase64: image?.split(',')[1] || '',
        }).then((result) => {
          // 用后端返回的权威帖子（带 uid / 后端 id）回填本地
          const serverPost = (result && result.post) as ForumPost | undefined;
          if (serverPost && serverPost.id) {
            setPosts((cur) => cur.map((p) => (p.id === newPost.id ? { ...p, ...serverPost, id: p.id } : p)));
          }
        }).catch(() => undefined);
      } catch (error) {
        onShowToast(error instanceof Error ? error.message : '发布失败');
      } finally {
        setPublishing(false);
      }
      return;
    }

    // 🥔 土豆市集发布
    if (composeCategory === 'market') {
      if (!marketFormTitle.trim()) {
        return onShowToast('⚠️ 请输入商品名称');
      }
      const priceNum = parseFloat(marketFormPrice);
      if (isNaN(priceNum) || priceNum < 0) {
        return onShowToast('⚠️ 请输入有效出让定价 (¥)');
      }
      if (marketFormImages.length === 0) {
        return onShowToast('⚠️ 必须上传至少 1 张商品实物图片');
      }
      if (!marketFormLink.trim()) {
        return onShowToast('⚠️ 必须填写交易/参考详情链接');
      }
      if (!marketFormLink.trim().startsWith('http://') && !marketFormLink.trim().startsWith('https://')) {
        return onShowToast('⚠️ 链接格式不正确，必须以 http:// 或 https:// 开头');
      }

      const finalNickname = nickname.trim() || '匿名同好';

      const newItem: MarketItem = {
        id: `item-${Date.now()}`,
        title: marketFormTitle.trim(),
        price: priceNum,
        image: marketFormImages[0],
        images: marketFormImages,
        link: marketFormLink.trim(),
        description: marketFormDesc.trim() || '暂无详细描述。',
        nickname: finalNickname,
        date: new Date().toISOString().split('T')[0],
      };

      const updated = [newItem, ...marketItems];
      saveMarketItems(updated);
      soundManager.playSparkle();
      void api('marketPublish', {
        title: newItem.title,
        price: newItem.price,
        link: newItem.link,
        description: newItem.description,
        nickname: newItem.nickname,
        images: marketFormImages,
      }).then((result) => {
        if (Array.isArray(result.items)) {
          setMarketItems(result.items);
          localStorage.setItem(MARKET_STORAGE_KEY, JSON.stringify(result.items));
        }
      }).catch(() => onShowToast('⚠️ 商品同步失败（只保存在本机，其他设备看不到）'));
      onShowToast('🎉 发布成功！已同步至市集列表');

      setMarketFormTitle('');
      setMarketFormPrice('');
      setMarketFormLink('');
      setMarketFormDesc('');
      setMarketFormImages([]);
      setActiveMarketUploadPreviewIndex(0);
      setShowComposer(false);
      setActiveCategory('market');
      return;
    }
  };

  const givePotato = async (id: string) => {
    const token = await getAccessToken();
    if (!token) {
      onShowToast('请先登录账号后再点赞');
      window.dispatchEvent(new Event('levihan-open-login'));
      return;
    }
    let nowGiven = false;
    persist(
      posts.map((post) => {
        if (post.id === id) {
          nowGiven = !post.potatoGiven;
          return {
            ...post,
            potatoGiven: !post.potatoGiven,
            potatoes: Math.max(0, post.potatoes + (post.potatoGiven ? -1 : 1)),
          };
        }
        return post;
      })
    );
    soundManager.playCoin();
    void api('forumPotato', { target: 'post', id, give: nowGiven }).catch(() => undefined);
    if (nowGiven) {
      onShowToast('投喂了 1 份蛋糕！🍰');
    }
  };

  const addComment = async (postId: string) => {
    const text = (commentDrafts[postId] || '').trim();
    if (!text) return;
    const targetPost = posts.find((p) => p.id === postId);
    if (!targetPost) return;

    const token = await getAccessToken();
    if (!token) {
      onShowToast('请先登录账号后再评论');
      window.dispatchEvent(new Event('levihan-open-login'));
      return;
    }

    const chosenChar = commenterChars[postId] || (targetPost.category === 'roleplay' ? selectedChar : null);
    const authorName = chosenChar ? chosenChar.name.trim() : (nickname.trim() || '调查兵');
    const characterAvatar = chosenChar ? chosenChar.avatar : undefined;
    const isHost = authorName === targetPost.author;

    const isRelay = targetPost.category === 'relay';

    if (isRelay) {
      const claim = targetPost.quillClaim;
      const isClaimActive = claim && claim.expiresAt > now;

      if (!isClaimActive) {
        soundManager.playWoodTap();
        return onShowToast('请先认领羽毛笔');
      }

      if (claim.claimedBy !== authorName && claim.claimedBy !== nickname.trim()) {
        soundManager.playWoodTap();
        return onShowToast(`当前由【${claim.claimedBy}】认领中`);
      }

      if (text.length < RELAY_MIN_WORDS) {
        soundManager.playWoodTap();
        return onShowToast(`需满 ${RELAY_MIN_WORDS} 字 (当前 ${text.length} 字)`);
      }
    }

    const diceMatch = text.match(/【🎲\s*1D100=(\d+)\s*\((.*?)\)】/);
    let diceRoll: ForumComment['diceRoll'] = undefined;
    if (diceMatch) {
      diceRoll = {
        sides: 100,
        value: parseInt(diceMatch[1], 10),
        verdict: diceMatch[2],
      };
    }

    if (isRelay) {
      const stepIndex = targetPost.comments.length + 2;

      const newComment: ForumComment = {
        id: `c-${Date.now()}`,
        author: authorName,
        uid: currentUid || undefined,
        characterName: authorName,
        characterAvatar,
        isHost,
        body: text,
        createdAt: '刚刚',
        potatoes: 0,
        relayStep: stepIndex,
        wordCount: text.length,
        diceRoll,
      };

      const updated = posts.map((p) => {
        if (p.id === postId) {
          return {
            ...p,
            comments: [...p.comments, newComment],
            quillClaim: undefined,
          };
        }
        return p;
      });

      persist(updated);
      setCommentDrafts((drafts) => ({ ...drafts, [postId]: '' }));
      soundManager.playPageTurn();
      void api('forumComment', {
        postId, author: authorName, body: text,
        characterName: authorName, characterAvatar, isHost,
        relayStep: stepIndex, wordCount: text.length, diceRoll,
      }).catch(() => onShowToast('⚠️ 接棒同步失败（只保存在本机，其他设备看不到）'));
      onShowToast(`第 ${stepIndex} 棒已递交 (${text.length}字)，合订本已同步更新 📖`);
    } else {
      const newComment: ForumComment = {
        id: `c-${Date.now()}`,
        author: authorName,
        uid: currentUid || undefined,
        characterName: authorName,
        characterAvatar,
        isHost,
        body: text,
        createdAt: '刚刚',
        potatoes: 0,
      };

      const updated = posts.map((post) => {
        if (post.id === postId) {
          return {
            ...post,
            comments: [...post.comments, newComment],
          };
        }
        return post;
      });

      persist(updated);
      setCommentDrafts((drafts) => ({ ...drafts, [postId]: '' }));
      soundManager.playPageTurn();
      if (targetPost.category === 'roleplay') {
        onShowToast(isHost ? `👑 楼主【${authorName}】已回应对白` : `【${authorName}】已接力搭戏 ✨`);
      } else {
        onShowToast(isHost ? `👑 楼主【${authorName}】已留言` : '留言已发表');
      }

      void api('forumComment', {
        postId, author: authorName, body: text,
        characterName: authorName, characterAvatar, isHost, diceRoll,
      }).catch(() => onShowToast('⚠️ 评论同步失败（只保存在本机，其他设备看不到）'));
    }
  };

  return (
    <div className="w-full h-full pb-2 bg-[#E6D9C1]/80 backdrop-blur-xs text-[#2C2016] flex flex-col overflow-hidden select-none font-sans">
      {/* 1. 兵长茶会 · 顶部预留同色系展示区域 (互动滑索小分队，持续往左平移动画) */}
      <TeaPartyInteractiveZipline onShowToast={onShowToast} />

      {/* 2. 羊皮纸分类工具栏 (分类胶囊按键 + 发布按钮) */}
      <div className="shrink-0 bg-[#E8DCBF]/90 border-b-2 border-[#B89874] px-3 py-2 z-10 shadow-xs relative overflow-hidden">
        <CardPatternOverlay opacity={0.06} mode="multiply" />

        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2 relative z-10">
          {/* 左侧回形针与分类筛选胶囊 (支持鼠标拖拽滑动与触控滑动) */}
          <div
            ref={categoryScrollRef}
            onMouseDown={handleCategoryMouseDown}
            onMouseMove={handleCategoryMouseMove}
            onMouseUp={handleCategoryMouseUpOrLeave}
            onMouseLeave={handleCategoryMouseUpOrLeave}
            onWheel={handleCategoryWheel}
            className={`flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 select-none touch-pan-x overscroll-x-contain ${
              isCategoryDraggingUI ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >
            <span className="text-base text-[#8C6D4F] shrink-0 font-bold select-none mr-0.5" title="复古回形针">
              📎
            </span>

            {/* 1. 全部 */}
            <button
              type="button"
              onClick={() => handleCategoryTabClick('all')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer whitespace-nowrap shadow-2xs shrink-0 ${
                activeCategory === 'all'
                  ? 'bg-[#1E4334] text-[#F9E79F] border border-[#163327]'
                  : 'bg-[#EFE5D2] text-[#614E3C] border border-[#C5B295] hover:bg-[#E2D4BC]'
              }`}
            >
              全部 ({posts.length + marketItems.length})
            </button>

            {/* 2. 闲聊茶歇 */}
            <button
              type="button"
              onClick={() => handleCategoryTabClick('chat')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap shadow-2xs shrink-0 ${
                activeCategory === 'chat'
                  ? 'bg-[#1E4334] text-[#F9E79F] border border-[#163327]'
                  : 'bg-[#EFE5D2] text-[#614E3C] border border-[#C5B295] hover:bg-[#E2D4BC]'
              }`}
            >
              <MessageCircle size={11} />
              <span>闲聊茶歇</span>
              <span className="text-[10px] px-1 rounded-full bg-black/15 font-mono">
                {posts.filter((p) => (p.category || 'chat') === 'chat').length}
              </span>
            </button>

            {/* 3. 角色拟音 */}
            <button
              type="button"
              onClick={() => handleCategoryTabClick('roleplay')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap shadow-2xs shrink-0 ${
                activeCategory === 'roleplay'
                  ? 'bg-[#3B0764] text-[#F3E8FF] border border-[#2E1065]'
                  : 'bg-[#EFE5D2] text-[#614E3C] border border-[#C5B295] hover:bg-[#E2D4BC]'
              }`}
            >
              <Sparkles size={11} />
              <span>角色拟音</span>
              <span className="text-[10px] px-1 rounded-full bg-black/15 font-mono">
                {posts.filter((p) => p.category === 'roleplay').length}
              </span>
            </button>

            {/* 4. 故事接龙 */}
            <button
              type="button"
              onClick={() => handleCategoryTabClick('relay')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap shadow-2xs shrink-0 ${
                activeCategory === 'relay'
                  ? 'bg-[#B45309] text-white border border-[#92400E]'
                  : 'bg-[#EFE5D2] text-[#614E3C] border border-[#C5B295] hover:bg-[#E2D4BC]'
              }`}
            >
              <Feather size={11} />
              <span>故事接龙</span>
              <span className="text-[10px] px-1 rounded-full bg-black/15 font-mono">
                {posts.filter((p) => p.category === 'relay').length}
              </span>
            </button>

            {/* 5. 土豆市集 */}
            <button
              type="button"
              onClick={() => handleCategoryTabClick('market')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap shadow-2xs shrink-0 ${
                activeCategory === 'market'
                  ? 'bg-[#8C5828] text-[#FDF8EE] border border-[#643D16]'
                  : 'bg-[#EFE5D2] text-[#614E3C] border border-[#C5B295] hover:bg-[#E2D4BC]'
              }`}
            >
              <span>🥔</span>
              <span>土豆市集</span>
              <span className="text-[10px] px-1 rounded-full bg-black/15 font-mono">
                {marketItems.length}
              </span>
            </button>
          </div>

          {/* 右侧手写印记与发布按钮 */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex flex-col text-right font-serif text-[9px] text-[#8C6D4F]/80 italic leading-tight select-none pointer-events-none">
              <span>For the stories</span>
              <span>For a better tomorrow.</span>
            </div>

            <button
              type="button"
              onClick={() => {
                soundManager.playActionClick();
                setComposeCategory('chat');
                setShowComposer(true);
              }}
              className="px-3.5 py-1 rounded-full bg-[#1E4334] hover:bg-[#2C5C46] text-[#F9E79F] border border-[#163327] text-xs font-bold cursor-pointer flex items-center gap-1 active:scale-95 shadow-xs"
            >
              <Plus size={13} /> <span>发布</span>
            </button>
          </div>
        </div>
      </div>

      <main id="forum-scroll-container" className="clear-adventure-nav flex-1 min-h-0 overflow-y-auto px-2 sm:px-4 pt-3">
        <div className="max-w-3xl mx-auto space-y-3.5">

          {/* ==================== 🥔 土豆市集专用视图 (当选中土豆市集分类时) ==================== */}
          {activeCategory === 'market' && (
            <div className="space-y-3.5">
              {/* 1. 交易风险防范与安全警示说明 */}
              <div className="bg-[#FAF1D8] border-2 border-[#D97706] rounded-xl p-3 sm:p-3.5 text-[#78350F] shadow-xs relative overflow-hidden">
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className="w-5 h-5 text-[#D97706] shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <h4 className="font-serif-title font-black text-xs sm:text-sm text-[#92400E]">
                      ⚠️ 交易风险防范与安全警示（购买前必读）
                    </h4>
                    <p className="leading-relaxed text-[11px] text-[#78350F]/90">
                      本茶会市集仅作为同好信息互助展示板块，所有物资流转与支付请务必在正规第三方担保平台（如闲鱼/微店/小红书等）内完成。切勿脱离担保平台私下微信或支付宝直接转账，谨防受骗！
                    </p>
                  </div>
                </div>
              </div>

              {/* 2. 搜索栏与快捷发布 */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 bg-[#FAF3E3] p-2 sm:p-2.5 rounded-xl border border-[#C5B295] shadow-xs">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C6D4F]" />
                  <input
                    type="text"
                    placeholder="搜索市集商品名称、描述、发布人..."
                    value={marketSearchQuery}
                    onChange={(e) => setMarketSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-white/90 border border-[#D5C19A] rounded-lg focus:outline-none focus:border-[#8C5828] text-[#2C2016]"
                  />
                  {marketSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setMarketSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#8C6D4F] hover:text-[#2C2016]"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    soundManager.playActionClick();
                    setComposeCategory('market');
                    setShowMarketComposer(true);
                  }}
                  className="px-3.5 py-1.5 bg-[#8C5828] hover:bg-[#72451E] text-[#FFFDF8] rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-transform active:scale-95 shrink-0"
                >
                  <PlusCircle size={14} />
                  <span>发布市集物资</span>
                </button>
              </div>

              {/* 3. 市集卡片列表 */}
              <div className="space-y-3">
                {filteredMarketItems.map((item) => (
                  <article
                    key={item.id}
                    onClick={() => {
                      soundManager.playScrollOpen();
                      setSelectedMarketItem(item);
                      setActiveMarketDetailImageIndex(0);
                    }}
                    className="group relative bg-[#FAF3E3]/90 backdrop-blur-xs border-2 border-[#8C5828] rounded-2xl p-3.5 sm:p-4 cursor-pointer hover:border-[#5B3714] transition-all overflow-hidden shadow-[0_4px_16px_rgba(140,88,40,0.18)]"
                  >
                    <CardPatternOverlay opacity={0.08} mode="multiply" />

                    <div className="relative z-10 flex flex-col sm:flex-row gap-3 sm:gap-4 items-start">
                      {/* 商品首图 (4:3 比例) */}
                      <div className="relative w-full sm:w-44 aspect-4/3 rounded-xl overflow-hidden border-2 border-[#8C6D4F]/40 bg-[#EFE5D2] shrink-0">
                        <img
                          src={item.image}
                          alt={item.title}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute top-2 left-2 bg-[#8C5828] text-[#FAF5EA] font-pixel text-[10px] font-bold px-2 py-0.5 rounded shadow-xs border border-[#C5A059]/40">
                          🥔 市集物资
                        </div>
                        <div className="absolute bottom-2 right-2 bg-black/75 backdrop-blur-xs text-[#FDE68A] font-bold text-xs px-2 py-0.5 rounded shadow-xs">
                          ¥{item.price}
                        </div>
                      </div>

                      {/* 右侧商品信息 */}
                      <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch">
                        <div className="space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-serif-title text-base sm:text-lg font-black text-[#2D1F13] group-hover:text-[#8C5828] transition-colors line-clamp-2">
                              {item.title}
                            </h3>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteMarketItem(item.id);
                              }}
                              className="text-[#8C7A65] hover:text-[#DC2626] p-1 rounded transition-colors shrink-0"
                              title="下架该物资"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>

                          <p className="text-xs sm:text-sm text-[#614E3C] leading-relaxed line-clamp-2 sm:line-clamp-3">
                            {item.description}
                          </p>
                        </div>

                        <div className="pt-2.5 mt-2 border-t border-[#D8C7AA] flex items-center justify-between text-xs text-[#8C6D4F]">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-[#3B2818]">发布人:</span>
                            <span className="font-medium">{item.nickname}</span>
                            <span className="text-[10px] text-[#A89078] ml-1">{item.date}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                soundManager.playActionClick();
                                setShareTarget({ type: 'market', marketItem: item });
                                setIsShareModalOpen(true);
                              }}
                              className="px-2 py-0.5 rounded-md bg-[#EFE5D2] hover:bg-[#E2D4BC] border border-[#C5B295] text-[#8C6D4F] hover:text-[#1E4334] text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                              title="分享此市集物资"
                            >
                              <Share2 size={11} />
                              <span>分享</span>
                            </button>

                            <span className="text-xs font-bold text-[#8C5828] group-hover:underline flex items-center gap-1">
                              <span>详情</span>
                              <span>➔</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}

                {filteredMarketItems.length === 0 && (
                  <div className="text-center py-12 bg-[#FAF3E3] rounded-2xl border-2 border-dashed border-[#C5B295] space-y-2">
                    <span className="text-3xl">🥔</span>
                    <p className="text-sm font-bold text-[#8C6D4F]">市集暂无相关物资</p>
                    <p className="text-xs text-[#A89078]">可以点击上方“发布市集物资”上传第一件同人好物！</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==================== 论坛原有分类帖子列表 (全部 / 故事接龙 / 闲聊茶歇 / 角色拟音) ==================== */}
          {activeCategory !== 'market' && filteredPosts.map((post) => {
            const isRelay = post.category === 'relay';
            const isExpanded = openComments === post.id;
            const currentAuthor = nickname.trim() || '调查兵';

            // ==================== 🪶 故事接龙卡片 (参考图第3张卡片排版: 复古羊皮纸金铜双边框) ====================
            if (isRelay) {
              const steps = post.comments || [];
              const nextStepNum = steps.length + 2;
              const claim = post.quillClaim;
              const isClaimActive = claim && claim.expiresAt > now;
              const isMyClaim = isClaimActive && claim.claimedBy === currentAuthor;
              const isOtherClaim = isClaimActive && !isMyClaim;

              const currentDraft = commentDrafts[post.id] || '';
              const isWordCountMet = currentDraft.length >= RELAY_MIN_WORDS;

              return (
                <article
                  key={post.id}
                  id={`post-${post.id}`}
                  onClick={() => setOpenComments(isExpanded ? null : post.id)}
                  className={`relative bg-[#FAF3E3]/90 backdrop-blur-xs border-2 border-[#78350F] rounded-2xl p-3.5 sm:p-4 cursor-pointer hover:border-[#451A03] transition-all group overflow-hidden shadow-[0_4px_16px_rgba(120,53,15,0.18)] ${
                    highlightedPostId === post.id ? 'ring-4 ring-[#D97706] shadow-[0_0_24px_rgba(217,119,6,0.5)] scale-[1.01]' : ''
                  }`}
                  aria-expanded={isExpanded}
                >
                  <CardPatternOverlay opacity={0.12} mode="multiply" />

                  {/* 顶栏: 标签胶囊 + 认领状态 + 右侧合订本 */}
                  <div className="relative z-10 flex items-center justify-between gap-2 pb-2.5 border-b border-[#D8C7AA]">
                    <div className="flex items-center gap-1.5 text-xs flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full bg-[#B45309] text-white font-bold text-[10px] flex items-center gap-1 shadow-2xs">
                        <Feather size={10} /> 故事接龙
                      </span>

                      {isClaimActive ? (
                        isMyClaim ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-[#1E4334] text-[#F9E79F] font-bold text-[10px] flex items-center gap-1">
                            <Feather size={10} /> 执笔中 · {formatTimeRemaining(claim.expiresAt, now)}
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full bg-[#EFE3CD] text-[#8C6D4F] border border-[#C5B295] font-bold text-[10px] flex items-center gap-1">
                            <Lock size={10} /> {claim.claimedBy} · {formatTimeRemaining(claim.expiresAt, now)}
                          </span>
                        )
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full bg-[#EFE3CD] text-[#8C6D4F] border border-[#C5B295] font-bold text-[10px] flex items-center gap-1">
                          <Unlock size={10} /> 可认领第 {nextStepNum} 棒
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        soundManager.playPageTurn();
                        const compiledNovel = compileRelayPostToNovel(post);
                        jumpToCompiledNovelInDoujinArchive(compiledNovel, false);
                      }}
                      className="px-2.5 py-1 rounded-full bg-[#F2E8D5] hover:bg-[#EADCBF] border border-[#B89A74] text-[#614223] text-[11px] font-bold flex items-center gap-1 transition-all active:scale-95 cursor-pointer shrink-0 shadow-2xs"
                      title="前往粮仓小说本查看合订本卡片"
                    >
                      <BookOpen size={11} />
                      <span>查看合订本</span>
                    </button>
                  </div>

                  {/* 发帖者个人信息 */}
                  <div className="relative z-10 flex items-center gap-2 mt-2.5">
                    <div className="w-6 h-6 rounded-full bg-[#8C6D4F] text-[#F9E79F] flex items-center justify-center text-xs font-bold border border-[#B89A74] shrink-0">
                      ✍️
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-[#3B2818] font-bold">{post.author}</span>
                      <span className="text-[#8C7A65] text-[10px]">{post.createdAt}</span>
                      {currentUid && post.uid === currentUid && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openRelayEdit(post); }}
                            className="ml-1 text-[#8C7A65] hover:text-[#235340] p-0.5 rounded transition-colors"
                            title="编辑我发布的接龙"
                          >
                            <PenLine size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void handleDeletePost(post.id); }}
                            className="text-[#8C7A65] hover:text-[#DC2626] p-0.5 rounded transition-colors"
                            title="删除我发布的帖子"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* 标题 */}
                  <h2 className="relative z-10 mt-2 text-base sm:text-lg font-black leading-snug text-[#2C2016] group-hover:text-[#8C6D4F] transition-colors font-serif-title">
                    {post.title}
                  </h2>

                  {/* 灵感题设 (参考图黄色浅网格题设框) */}
                  {post.prompt && (
                    <div className="relative z-10 mt-2 bg-[#F5ECDA] border border-[#D5C19A] p-2.5 rounded-xl flex items-start gap-2 text-xs text-[#633F17]">
                      <span className="text-sm shrink-0">📖</span>
                      <p className="font-serif-title text-[#3B2818] leading-relaxed">{post.prompt}</p>
                    </div>
                  )}

                  {/* 首楼开篇正文 */}
                  <div className="relative z-10 mt-2.5 p-3 bg-[#F3E9D2]/80 border border-[#DECDB3] rounded-xl text-xs sm:text-sm leading-relaxed text-[#3B2818] font-serif-title space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-bold text-[#8C6D4F] border-b border-[#DECDB3]/60 pb-1 mb-1">
                      <div className="flex items-center gap-1.5">
                        <span>#1</span>
                        <span>{post.author}</span>
                      </div>
                      <span className="font-sans font-normal text-[#8C7A65]">{post.body.length}字</span>
                    </div>
                    <p className="indent-2 whitespace-pre-wrap">{post.body}</p>
                  </div>

                  {/* 卡片底栏 (参考图 蛋糕按钮 + 棒数 + 🔗 分享 + 展开指示) */}
                  <div className="relative z-10 mt-3 pt-2.5 border-t border-[#D8C7AA] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          givePotato(post.id);
                        }}
                        className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-transform active:scale-95 shadow-2xs ${
                          post.potatoGiven
                            ? 'bg-[#8C6D4F] text-white'
                            : 'bg-[#EFE3CD] hover:bg-[#E5D5BA] border border-[#C5B295] text-[#3B2818]'
                        }`}
                      >
                        <span className="text-sm">🍰</span>
                        <span>{post.potatoes}</span>
                      </button>

                      <span className="px-3 py-1 rounded-full bg-[#EFE3CD] border border-[#C5B295] text-[#8C6D4F] text-xs font-bold flex items-center gap-1 shadow-2xs">
                        <Feather size={11} />
                        <span>{steps.length + 1} 棒</span>
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          soundManager.playActionClick();
                          setShareTarget({ type: 'post', post });
                          setIsShareModalOpen(true);
                        }}
                        className="px-2.5 py-1 rounded-full bg-[#EFE3CD] hover:bg-[#E5D5BA] border border-[#C5B295] text-[#8C6D4F] hover:text-[#1E4334] text-xs font-bold flex items-center gap-1 cursor-pointer transition-transform active:scale-95 shadow-2xs"
                        title="分享接龙故事"
                      >
                        <Share2 size={11} />
                        <span>分享</span>
                      </button>
                    </div>

                    <div className="text-[#8C6D4F] flex items-center p-1">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>

                  {/* 展开区 */}
                  {isExpanded && (
                    <section
                      onClick={(e) => e.stopPropagation()}
                      className="relative z-10 mt-3 pt-2 space-y-2.5 cursor-default border-t border-[#D8C7AA]"
                    >
                      {/* 后续楼层 */}
                      <div className="space-y-1">
                        {steps.map((comment, index) => {
                          const isCommentHost = comment.isHost || comment.author === post.author;
                          return (
                            <div
                              key={comment.id}
                              className="pt-2 pb-2.5 border-b border-dashed border-[#D8C7AA] last:border-b-0 space-y-1 text-xs"
                            >
                              <div className="flex items-center justify-between text-[11px] text-[#715431]">
                                <div className="flex items-center gap-1.5 font-bold">
                                  <span className="text-[#8C6D4F] font-mono select-none">↳</span>
                                  <span className="text-[#8C6D4F]">#{index + 2}</span>
                                  <span className="text-[#2C2016]">{comment.author}</span>
                                  {isCommentHost && (
                                    <span className="text-[#8C6D4F] font-bold text-[10px] ml-0.5">
                                      楼主
                                    </span>
                                  )}
                                  {comment.diceRoll && (
                                    <span className="text-[10px] text-[#8C6D4F] font-normal">
                                      (🎲 1D100={comment.diceRoll.value})
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-[#8C7A65]">{comment.createdAt}</span>
                                  {currentUid && comment.uid === currentUid && (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); void handleDeleteComment(post.id, comment.id); }}
                                      className="text-[#8C7A65] hover:text-[#DC2626] p-0.5 rounded transition-colors"
                                      title="删除我发布的评论"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  )}
                                </div>
                              </div>

                              <p className="text-xs sm:text-sm text-[#2C2016] leading-relaxed font-serif-title whitespace-pre-wrap pl-4">
                                {comment.body}
                              </p>
                            </div>
                          );
                        })}
                      </div>

                      {/* 创作台 */}
                      {isMyClaim && (
                        <div className="bg-[#FAF3E3] p-3 rounded-xl space-y-2 border-2 border-[#8C6D4F]">
                          <div className="flex items-center justify-between text-xs font-bold text-[#8C6D4F]">
                            <span className="flex items-center gap-1">
                              <Feather size={12} /> 第 {claim.relayStep} 棒 (剩 {formatTimeRemaining(claim.expiresAt, now)})
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleInsertFramework(post.id)}
                                className="px-2 py-0.5 rounded bg-[#EFE3CD] border border-[#C5B295] text-[10px] cursor-pointer"
                              >
                                框架
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDiceRollForComment(post.id)}
                                className="px-2 py-0.5 rounded bg-[#EFE3CD] border border-[#C5B295] text-[10px] cursor-pointer"
                              >
                                1D100
                              </button>
                              <button
                                type="button"
                                onClick={() => handleInspirationForComment(post.id)}
                                className="px-2 py-0.5 rounded bg-[#EFE3CD] border border-[#C5B295] text-[10px] cursor-pointer"
                              >
                                灵感
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReleaseQuill(post.id)}
                                className="px-2 py-0.5 rounded bg-[#E5D5BA] border border-[#C5B295] text-[10px] cursor-pointer"
                              >
                                归还
                              </button>
                            </div>
                          </div>

                          <textarea
                            rows={5}
                            value={currentDraft}
                            onChange={(e) =>
                              setCommentDrafts((drafts) => ({ ...drafts, [post.id]: e.target.value }))
                            }
                            placeholder="承接剧情撰写..."
                            className="w-full p-2.5 rounded-lg text-xs sm:text-sm outline-none bg-white text-[#2C2016] resize-y font-serif-title border border-[#D8C7AA] leading-relaxed"
                          />

                          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                isWordCountMet ? 'bg-[#1E4334] text-[#F9E79F]' : 'bg-[#EFE3CD] text-[#8C6D4F]'
                              }`}
                            >
                              {currentDraft.length} / {RELAY_MIN_WORDS} 字
                            </span>

                            <button
                              type="button"
                              onClick={() => addComment(post.id)}
                              className={`px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer transition-all flex items-center gap-1 active:scale-95 shadow-2xs ${
                                isWordCountMet
                                  ? 'bg-[#8C6D4F] text-white'
                                  : 'bg-[#C5B295] text-white'
                              }`}
                            >
                              <Feather size={12} />
                              <span>递交第 {claim.relayStep} 棒</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {isOtherClaim && (
                        <div className="bg-[#F5ECDA] p-2.5 rounded-xl text-center text-xs text-[#8C6D4F] font-bold flex items-center justify-center gap-1.5 border border-[#DECDB3]">
                          <Lock size={12} />
                          <span>【{claim.claimedBy}】执笔中 · 剩余 {formatTimeRemaining(claim.expiresAt, now)}</span>
                        </div>
                      )}

                      {!isClaimActive && (
                        <div className="text-center pt-1">
                          <button
                            type="button"
                            onClick={() => handleClaimQuill(post.id)}
                            className="px-4 py-1.5 rounded-full bg-[#8C6D4F] hover:bg-[#72573E] text-white text-xs font-bold inline-flex items-center gap-1.5 active:scale-95 cursor-pointer shadow-2xs"
                          >
                            <Feather size={12} />
                            <span>认领第 {nextStepNum} 棒 (24h)</span>
                          </button>
                        </div>
                      )}
                    </section>
                  )}
                </article>
              );
            }

            // ==================== 🎭 角色拟音 (语C) 卡片 ====================
            if (post.category === 'roleplay') {
              const currentCommenter = getCommenterForPost(post);
              // Both come from the same 拟音人物, so the header circle, the card
              // illustration and the composer rail can never disagree.
              const { avatar: charAvatar, illustration: charImg } = getPostArtwork(post);
              const displayName = post.characterName || post.author;

              return (
                <article
                  key={post.id}
                  id={`post-${post.id}`}
                  onClick={() => setOpenComments(isExpanded ? null : post.id)}
                  className={`relative bg-[#FAF3E3]/90 backdrop-blur-xs border-2 border-[#3B0764] rounded-2xl p-3.5 sm:p-4 cursor-pointer hover:border-[#2E1065] transition-all group overflow-hidden shadow-[0_4px_16px_rgba(59,7,100,0.18)] ${
                    highlightedPostId === post.id ? 'ring-4 ring-[#D97706] shadow-[0_0_24px_rgba(217,119,6,0.5)] scale-[1.01]' : ''
                  }`}
                  aria-expanded={isExpanded}
                >
                  <CardPatternOverlay opacity={0.08} mode="multiply" />

                  {/* 背景干花/植物蕾丝纹理装饰 */}
                  <div className="absolute left-1 top-1 bottom-1 w-12 pointer-events-none opacity-20 bg-[radial-gradient(#8C6D4F_1px,transparent_1px)] [background-size:8px_8px]" />

                  {/* 顶栏: [||| 角色拟音] 胶囊 + 头像 + 姓名 + 发布时间 (底边为顶部分割线) */}
                  <div className="relative z-10 flex items-center justify-between gap-2 pb-2 border-b border-[#D8C7AA]">
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full bg-[#433854] text-[#E7D6F7] font-bold text-[10px] flex items-center gap-1 shadow-2xs">
                        <span className="text-[9px] tracking-tighter font-mono">|||</span>
                        <span>角色拟音</span>
                      </span>

                      {/* 头像与名字 */}
                      <div className="flex items-center gap-1.5">
                        <CharacterArt
                          src={charAvatar}
                          alt={displayName}
                          fit="cover"
                          className="w-5 h-5 rounded-full shrink-0 shadow-2xs"
                        />

                        <span className="text-[#2C2016] font-bold text-xs">
                          {displayName}
                        </span>
                      </div>

                      <span className="text-[#8C7A65] text-[10px]">{post.createdAt}</span>
                      {currentUid && post.uid === currentUid && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void handleDeletePost(post.id); }}
                          className="ml-1 text-[#8C7A65] hover:text-[#DC2626] p-0.5 rounded transition-colors"
                          title="删除我发布的帖子"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 中间核心内容区：
                      1. 严格位于顶部分割线与底部分割线之间
                      2. 人物始终固定在文本框右侧
                      3. 图片无任何边框！无外层边框底座！
                      4. 设置 overflow-hidden，确保 hover 时人物动态变大绝对不会超过顶底分割线
                  */}
                  <div className="relative z-10 my-2.5 flex items-stretch justify-between gap-2.5 sm:gap-3.5 overflow-hidden rounded-xl">
                    {/* 左侧：文本框 */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <div className="h-full flex flex-col justify-center p-3 sm:p-3.5 rounded-xl bg-[#F3E9D2]/75 border border-[#DECDB3] shadow-2xs">
                        <p className="text-xs sm:text-sm leading-relaxed font-serif-title whitespace-pre-wrap text-[#3B2818] italic">
                          {post.body}
                        </p>

                        {/* 剧场剧照：仅当上传了与立绘不同的独立配图时展示。
                            历史帖子的 image 曾镜像 characterImage，故需一并排除 */}
                        {post.image && post.image !== charImg && post.image !== post.characterImage && (
                          <div className="mt-2.5 rounded-lg overflow-hidden">
                            <img
                              src={post.image}
                              alt="剧场剧照"
                              className="max-h-36 sm:max-h-44 w-full object-contain bg-[#EADCC7]/30"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 右侧：始终固定在文本框右侧的人物展示区 (纯净无边框，hover 放大但受限于外框溢出截断) */}
                    <div className="shrink-0 w-24 xs:w-28 sm:w-36 md:w-40 self-stretch min-h-[96px] sm:min-h-[112px] relative flex items-center justify-center overflow-hidden select-none">
                      <CharacterArt
                        src={charImg}
                        alt={displayName}
                        fit="contain"
                        // 预留 8% 内边距：hover 放大 115% 后立绘仍在框内，不露边
                        className="w-full h-full p-[8%]"
                        innerClassName="drop-shadow-sm select-none pointer-events-none transition-transform duration-300 ease-out group-hover:scale-115"
                      />

                      {/* 底部角色名微标 */}
                      <div className="absolute bottom-1 right-1.5 px-1.5 py-0.5 rounded bg-black/45 backdrop-blur-2xs text-[8.5px] sm:text-[9px] font-pixel text-[#FAF4E4] pointer-events-none opacity-90 leading-none">
                        {displayName}
                      </div>
                    </div>
                  </div>

                  {/* 底栏: 🍰 蛋糕按键 + 💬 评论数 + 🔗 分享 + 折叠按钮 (顶边为底部分割线) */}
                  <div className="relative z-10 pt-2.5 border-t border-[#D8C7AA] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          givePotato(post.id);
                        }}
                        className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-transform active:scale-95 shadow-2xs ${
                          post.potatoGiven
                            ? 'bg-[#8C6D4F] text-white'
                            : 'bg-[#EFE3CD] hover:bg-[#E5D5BA] border border-[#C5B295] text-[#3B2818]'
                        }`}
                      >
                        <span className="text-sm">🍰</span>
                        <span>{post.potatoes}</span>
                      </button>

                      <span className="px-3 py-1 rounded-full bg-[#EFE3CD] border border-[#C5B295] text-[#8C6D4F] text-xs font-bold flex items-center gap-1 shadow-2xs">
                        <MessageCircle size={11} />
                        <span>{post.comments.length}</span>
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          soundManager.playActionClick();
                          setShareTarget({ type: 'post', post });
                          setIsShareModalOpen(true);
                        }}
                        className="px-2.5 py-1 rounded-full bg-[#EFE3CD] hover:bg-[#E5D5BA] border border-[#C5B295] text-[#8C6D4F] hover:text-[#1E4334] text-xs font-bold flex items-center gap-1 cursor-pointer transition-transform active:scale-95 shadow-2xs"
                        title="分享角色语C台词卡片"
                      >
                        <Share2 size={11} />
                        <span>分享</span>
                      </button>
                    </div>

                    <div className="text-[#8C6D4F] flex items-center p-1">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>

                  {/* 展开区：对白回复 */}
                  {isExpanded && (
                    <section
                      onClick={(e) => e.stopPropagation()}
                      className="relative z-10 mt-3 pt-2 space-y-2.5 cursor-default border-t border-[#D8C7AA]"
                    >
                      <div className="space-y-1">
                        {post.comments.map((comment) => {
                          const isCommentHost = comment.isHost || comment.author === post.author;
                          return (
                            <div
                              key={comment.id}
                              className="pt-2 pb-2.5 border-b border-dashed border-[#D8C7AA] last:border-b-0 space-y-1 text-xs"
                            >
                              <div className="flex items-center justify-between text-[11px]">
                                <div className="flex items-center gap-1.5 font-bold">
                                  <span className="text-[#8C7A65] font-mono select-none">↳</span>
                                  {comment.characterAvatar ? (
                                    <CharacterArt
                                      src={resolveArtwork(comment.characterName || comment.author, comment.characterAvatar).avatar}
                                      alt={comment.author}
                                      fit="cover"
                                      className="w-4 h-4 rounded-full border border-[#8C6D4F]/30 shrink-0"
                                    />
                                  ) : (
                                    <span className="w-4 h-4 rounded-full bg-[#8C6D4F] text-[#F9E79F] flex items-center justify-center text-[9px]">
                                      {isCommentHost ? '👑' : '🎭'}
                                    </span>
                                  )}

                                  <span className="text-[#2C2016]">
                                    {comment.characterName || comment.author}
                                  </span>

                                  {isCommentHost && (
                                    <span className="text-[#8C6D4F] font-bold text-[10px] ml-0.5">
                                      楼主
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] text-[#8C7A65]">{comment.createdAt}</span>
                                  {currentUid && comment.uid === currentUid && (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); void handleDeleteComment(post.id, comment.id); }}
                                      className="text-[#8C7A65] hover:text-[#DC2626] p-0.5 rounded transition-colors"
                                      title="删除我发布的评论"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  )}
                                </div>
                              </div>

                              <p className="text-xs sm:text-sm text-[#2C2016] leading-relaxed font-serif-title whitespace-pre-wrap pl-4">
                                {comment.body}
                              </p>
                            </div>
                          );
                        })}

                        {post.comments.length === 0 && (
                          <div className="py-2 text-xs text-[#8C7A65] flex items-center gap-1.5">
                            <span className="font-mono">↳</span>
                            <span>暂无对白</span>
                          </div>
                        )}
                      </div>

                      {/* 接力对白输入 (展开后缩小选择角色的下拉栏) */}
                      <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <div className="flex items-center gap-1 shrink-0 bg-[#EFE3CD] px-1.5 py-0.5 rounded-md border border-[#C5B295] text-[10px]">
                          {currentCommenter.avatar ? (
                            <CharacterArt
                              src={currentCommenter.avatar}
                              alt={currentCommenter.name}
                              fit="cover"
                              className="w-3.5 h-3.5 rounded-full border border-[#8C6D4F]/30 shrink-0"
                            />
                          ) : (
                            <div className="w-3.5 h-3.5 rounded-full bg-[#8C6D4F] text-[#F9E79F] flex items-center justify-center text-[8px] font-bold shrink-0">
                              🎭
                            </div>
                          )}

                          <select
                            value={currentCommenter.name}
                            onChange={(e) => {
                              const val = e.target.value;
                              const matched = allCharacters.find((c) => c.name === val) || {
                                id: `char-reply-${Date.now()}`,
                                name: val,
                                avatar: currentCommenter.avatar,
                              };
                              setCommenterChars((prev) => ({ ...prev, [post.id]: matched }));
                            }}
                            className="text-[10px] font-bold text-[#3B2818] bg-transparent outline-none cursor-pointer max-w-[80px] sm:max-w-[95px] truncate py-0"
                          >
                            <optgroup label="👑 楼主身份">
                              <option value={post.author}>👑 楼主 ({post.author})</option>
                            </optgroup>
                            <optgroup label="🎭 角色库">
                              {allCharacters.map((c) => (
                                <option key={c.id} value={c.name}>
                                  {c.name === post.author ? `👑 楼主 · ${c.name}` : c.name}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="🎖️ 其他身份">
                              <option value="莫布利特">莫布利特</option>
                              <option value="调查兵">调查兵</option>
                            </optgroup>
                          </select>

                          {currentCommenter.name === post.author && (
                            <span className="px-1 py-0.2 rounded bg-gradient-to-r from-[#FDE68A] to-[#F59E0B] text-[#451A03] border border-[#D97706] font-black text-[8px] shadow-2xs whitespace-nowrap">
                              👑
                            </span>
                          )}
                        </div>

                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <input
                            type="text"
                            value={commentDrafts[post.id] || ''}
                            onChange={(e) =>
                              setCommentDrafts((drafts) => ({ ...drafts, [post.id]: e.target.value }))
                            }
                            placeholder="接力对白…"
                            className="min-w-0 flex-1 px-3 py-1.5 rounded-lg text-xs outline-none bg-white text-[#2C2016] border border-[#D8C7AA] focus:border-[#8C6D4F] transition-colors"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') addComment(post.id);
                            }}
                          />

                          <button
                            type="button"
                            onClick={() => addComment(post.id)}
                            className="px-3.5 py-1.5 rounded-full bg-[#1E4334] hover:bg-[#2C5C46] text-[#F9E79F] border border-[#163327] text-xs font-bold cursor-pointer transition-transform active:scale-95 shadow-2xs flex items-center gap-1 shrink-0"
                          >
                            <span>发送</span>
                            <Send size={11} />
                          </button>
                        </div>
                      </div>
                    </section>
                  )}
                </article>
              );
            }

            // ==================== ☕ 闲聊茶歇卡片 (参考图第4与第5张卡片排版: 绿/咖啡色羊皮纸卡片 + 水彩茶杯底纹) ====================
            return (
              <article
                key={post.id}
                id={`post-${post.id}`}
                onClick={() => setOpenComments(isExpanded ? null : post.id)}
                className={`relative bg-[#FAF3E3]/90 backdrop-blur-xs border-2 border-[#1E4334] rounded-2xl p-3.5 sm:p-4 cursor-pointer hover:border-[#11281E] transition-all group overflow-hidden shadow-[0_4px_16px_rgba(30,67,52,0.18)] ${
                  highlightedPostId === post.id ? 'ring-4 ring-[#D97706] shadow-[0_0_24px_rgba(217,119,6,0.5)] scale-[1.01]' : ''
                }`}
                aria-expanded={isExpanded}
              >
                <CardPatternOverlay opacity={0.08} mode="multiply" />

                {/* 背景水彩红茶杯与手写英文字印记 */}
                <div className="absolute right-3 top-2 bottom-2 w-32 pointer-events-none opacity-20 flex flex-col justify-between items-end text-right font-serif italic text-[#8C6D4F]">
                  <span className="text-xs">Good Tea Better People.</span>
                  <span className="text-[28px] opacity-30">☕</span>
                </div>

                {/* 顶栏: [☕ 闲聊茶歇] 胶囊 + 头像/用户名 + 时间 */}
                <div className="relative z-10 flex items-center justify-between gap-2 pb-2 border-b border-[#D8C7AA]">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-2.5 py-0.5 rounded-full bg-[#1E4334] text-[#F9E79F] font-bold text-[10px] flex items-center gap-1 shadow-2xs">
                      <MessageCircle size={10} /> 闲聊茶歇
                    </span>
                    <div className="w-4 h-4 rounded-full bg-[#1E4334] text-[#F9E79F] flex items-center justify-center text-[9px] font-bold">
                      ☕
                    </div>
                    <span className="text-[#2C2016] font-bold text-xs">{post.author}</span>
                    <span className="text-[#8C7A65] text-[10px]">{post.createdAt}</span>
                    {currentUid && post.uid === currentUid && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleDeletePost(post.id); }}
                        className="ml-1 text-[#8C7A65] hover:text-[#DC2626] p-0.5 rounded transition-colors"
                        title="删除我发布的帖子"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* 正文 */}
                <div className="relative z-10 mt-2 p-2.5 bg-[#F3E9D2]/60 rounded-xl text-xs sm:text-sm leading-relaxed text-[#3B2818] font-serif-title">
                  {post.body}
                </div>

                {post.image && (
                  <img
                    src={post.image}
                    alt="茶话配图"
                    className="relative z-10 mt-2 max-h-[280px] w-full object-contain rounded-xl bg-[#F0E6D2] border border-[#DECDB3]"
                  />
                )}

                {/* 底栏: 🍰 蛋糕按键 + 💬 评论数 + 🔗 分享 */}
                <div className="relative z-10 mt-3 pt-2.5 border-t border-[#D8C7AA] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        givePotato(post.id);
                      }}
                      className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-transform active:scale-95 shadow-2xs ${
                        post.potatoGiven
                          ? 'bg-[#8C6D4F] text-white'
                          : 'bg-[#EFE3CD] hover:bg-[#E5D5BA] border border-[#C5B295] text-[#3B2818]'
                      }`}
                    >
                      <span className="text-sm">🍰</span>
                      <span>{post.potatoes}</span>
                    </button>

                    <span className="px-3 py-1 rounded-full bg-[#EFE3CD] border border-[#C5B295] text-[#8C6D4F] text-xs font-bold flex items-center gap-1 shadow-2xs">
                      <MessageCircle size={11} />
                      <span>{post.comments.length}</span>
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        soundManager.playActionClick();
                        setShareTarget({ type: 'post', post });
                        setIsShareModalOpen(true);
                      }}
                      className="px-2.5 py-1 rounded-full bg-[#EFE3CD] hover:bg-[#E5D5BA] border border-[#C5B295] text-[#8C6D4F] hover:text-[#1E4334] text-xs font-bold flex items-center gap-1 cursor-pointer transition-transform active:scale-95 shadow-2xs"
                      title="分享茶歇发言"
                    >
                      <Share2 size={11} />
                      <span>分享</span>
                    </button>
                  </div>

                  <div className="text-[#8C6D4F] flex items-center p-1">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {/* 展开区 */}
                {isExpanded && (
                  <section
                    onClick={(e) => e.stopPropagation()}
                    className="relative z-10 mt-3 pt-2 space-y-2.5 cursor-default border-t border-[#D8C7AA]"
                  >
                    <div className="space-y-1">
                      {post.comments.map((comment) => {
                        const isCommentHost = comment.isHost || comment.author === post.author;
                        return (
                          <div
                            key={comment.id}
                            className="pt-2 pb-2.5 border-b border-dashed border-[#D8C7AA] last:border-b-0 space-y-1 text-xs"
                          >
                            <div className="flex items-center justify-between text-[11px] text-[#715431]">
                              <div className="flex items-center gap-1.5 font-bold">
                                <span className="text-[#8C6D4F] font-mono select-none">↳</span>
                                <span className="text-[#2C2016]">{comment.author}</span>
                                {isCommentHost && (
                                  <span className="text-[#8C6D4F] font-bold text-[10px] ml-0.5">
                                    楼主
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-[#8C7A65]">{comment.createdAt}</span>
                                {currentUid && comment.uid === currentUid && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); void handleDeleteComment(post.id, comment.id); }}
                                    className="text-[#8C7A65] hover:text-[#DC2626] p-0.5 rounded transition-colors"
                                    title="删除我发布的评论"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-[#3B2818] leading-relaxed whitespace-pre-wrap pl-4 font-serif-title">
                              {comment.body}
                            </p>
                          </div>
                        );
                      })}

                      {post.comments.length === 0 && (
                        <div className="py-2 text-xs text-[#8C7A65] flex items-center gap-1.5">
                          <span className="font-mono">↳</span>
                          <span>暂无留言</span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 pt-1">
                      <input
                        type="text"
                        value={commentDrafts[post.id] || ''}
                        onChange={(e) =>
                          setCommentDrafts((drafts) => ({ ...drafts, [post.id]: e.target.value }))
                        }
                        placeholder="发表茶歇留言..."
                        className="min-w-0 flex-1 px-3 py-1.5 rounded-lg text-xs outline-none bg-white text-[#2C2016] border border-[#D8C7AA] focus:border-[#8C6D4F] transition-colors"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addComment(post.id);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => addComment(post.id)}
                        className="px-3.5 py-1.5 rounded-full bg-[#1E4334] hover:bg-[#2C5C46] text-[#F9E79F] border border-[#163327] text-xs font-bold cursor-pointer transition-transform active:scale-95 shadow-2xs flex items-center gap-1 shrink-0"
                      >
                        <span>发送</span>
                        <Send size={11} />
                      </button>
                    </div>
                  </section>
                )}
              </article>
            );
          })}
        </div>
      </main>

      {/* 发起发布弹窗 (使用 createPortal 居中渲染于 document.body)；
          showMarketComposer 时同一容器复用为「发布市集物资」专用弹窗 */}
      {(showComposer || showMarketComposer) &&
        createPortal(
          <div
            className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 select-none overflow-y-auto animate-in fade-in duration-150"
            onClick={() => { setShowComposer(false); setShowMarketComposer(false); }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-[#FAF6EE] popup-frame-border rounded-2xl shadow-2xl p-4 sm:p-5 space-y-3 max-h-[90vh] overflow-y-auto relative my-auto shrink-0"
            >
              <CardPatternOverlay opacity={0.1} mode="multiply" />

              <div className="relative z-10 flex items-center justify-between pb-2 border-b border-[#D8C7AA]">
                <h2 className="font-serif-title text-sm font-black text-[#2D1F13]">
                  {showMarketComposer ? '发布市集物资' : '发起发布'}
                </h2>
                <button
                  type="button"
                  onClick={() => { setShowComposer(false); setShowMarketComposer(false); }}
                  className="text-[#8C7A65] hover:text-[#2D1F13] cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 类别切换（仅通用发布：闲聊茶歇 / 角色拟音 / 故事接龙；
                  土豆市集已剥离到「发布市集物资」专用弹窗，不再出现在通用发布里） */}
              {!showMarketComposer && (
              <div className="relative z-10 grid grid-cols-3 gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playWoodTap();
                    setComposeCategory('chat');
                  }}
                  className={`py-2 px-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex flex-col sm:flex-row items-center justify-center gap-1 ${
                    composeCategory === 'chat'
                      ? 'bg-[#235340] text-[#E8F5E9] border-[#235340] shadow-xs'
                      : 'bg-[#F4F8F5] text-[#235340] border-[#9EC0AF]'
                  }`}
                >
                  <MessageCircle size={13} />
                  <span>闲聊茶歇</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playWoodTap();
                    setComposeCategory('roleplay');
                  }}
                  className={`py-2 px-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex flex-col sm:flex-row items-center justify-center gap-1 ${
                    composeCategory === 'roleplay'
                      ? 'bg-[#3B0764] text-[#F3E8FF] border-[#2E1065] shadow-xs'
                      : 'bg-[#FAF5FF] text-[#3B0764] border-[#D8B4FE]'
                  }`}
                >
                  <Sparkles size={13} />
                  <span>角色拟音</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playWoodTap();
                    setComposeCategory('relay');
                  }}
                  className={`py-2 px-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex flex-col sm:flex-row items-center justify-center gap-1 ${
                    composeCategory === 'relay'
                      ? 'bg-[#7A4F1D] text-[#FFF8EB] border-[#7A4F1D] shadow-xs'
                      : 'bg-[#FAF2DF] text-[#7A4F1D] border-[#DFC593]'
                  }`}
                >
                  <Feather size={13} />
                  <span>故事接龙</span>
                </button>
              </div>
              )}

              {/* 🥔 土豆市集专属发布表单（仅 showMarketComposer 时渲染） */}
              {showMarketComposer ? (
                <form onSubmit={publish} className="relative z-10 space-y-3">
                  {/* 1. 商品名称 */}
                  <div>
                    <label className="text-[10px] font-bold text-[#6D5A46] block mb-1">
                      商品名称 (必填):
                    </label>
                    <input
                      type="text"
                      value={marketFormTitle}
                      onChange={(e) => setMarketFormTitle(e.target.value)}
                      placeholder="例如：利韩同人棉花娃娃、透卡、吧唧…"
                      className="w-full px-3 py-2 rounded-lg border border-[#C5B498] text-xs sm:text-sm font-bold outline-none bg-white focus:border-[#8C5828]"
                      required
                    />
                  </div>

                  {/* 2. 出让定价（署名已移除：默认以账号昵称发布） */}
                  <div>
                    <label className="text-[10px] font-bold text-[#6D5A46] block mb-1">
                      出让定价 (¥ 必填):
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C6D4F]" />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={marketFormPrice}
                        onChange={(e) => setMarketFormPrice(e.target.value)}
                        placeholder="0.00"
                        className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[#C5B498] text-xs font-bold outline-none bg-white focus:border-[#8C5828]"
                        required
                      />
                    </div>
                  </div>

                  {/* 3. 交易/参考详情链接 */}
                  <div>
                    <label className="text-[10px] font-bold text-[#6D5A46] block mb-1">
                      交易/参考详情链接 (必填):
                    </label>
                    <div className="relative">
                      <LinkIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C6D4F]" />
                      <input
                        type="url"
                        value={marketFormLink}
                        onChange={(e) => setMarketFormLink(e.target.value)}
                        placeholder="https://m.tb.cn/... 或闲鱼/微店/小红书链接"
                        className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[#C5B498] text-xs outline-none bg-white focus:border-[#8C5828]"
                        required
                      />
                    </div>
                    <p className="text-[10px] text-[#8C7A65] mt-0.5">
                      支持闲鱼、淘宝、微店、小红书或交流帖链接（需以 http:// 或 https:// 开头）
                    </p>
                  </div>

                  {/* 4. 实物图片上传 (1-3张) */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-bold text-[#6D5A46]">
                        实物图片上传 (必填 1~3 张):
                      </label>
                      <span className="text-[10px] text-[#8C7A65]">
                        已选 {marketFormImages.length} / 3 张
                      </span>
                    </div>

                    <input
                      ref={marketFileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) handleMarketFiles(e.target.files);
                      }}
                    />

                    {/* 拖拽上传触发框 */}
                    <div
                      onClick={() => marketFileInputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsMarketDragging(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        setIsMarketDragging(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsMarketDragging(false);
                        if (e.dataTransfer.files) handleMarketFiles(e.dataTransfer.files);
                      }}
                      className={`border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition-colors ${
                        isMarketDragging
                          ? 'border-[#8C5828] bg-[#F4E9D5]'
                          : 'border-[#C5B498] hover:border-[#8C5828] bg-white/60'
                      }`}
                    >
                      <Upload className="w-5 h-5 mx-auto text-[#8C6D4F] mb-1" />
                      <p className="text-xs text-[#2D1F13] font-bold">
                        点击或拖拽图片到此处上传
                      </p>
                      <p className="text-[10px] text-[#8C7A65] mt-0.5">
                        支持 JPG / PNG / WEBP，建议 4:3 或 1:1 比例
                      </p>
                    </div>

                    {/* 缩略图列表预览与操作 */}
                    {marketFormImages.length > 0 && (
                      <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
                        {marketFormImages.map((img, idx) => (
                          <div
                            key={idx}
                            className={`relative group shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 cursor-pointer ${
                              activeMarketUploadPreviewIndex === idx
                                ? 'border-[#8C5828] ring-2 ring-[#8C5828]/40'
                                : 'border-[#C5B498]'
                            }`}
                            onClick={() => setActiveMarketUploadPreviewIndex(idx)}
                          >
                            <img
                              src={img}
                              alt={`预览 ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                            {idx === 0 && (
                              <span className="absolute bottom-0 inset-x-0 bg-[#8C5828]/90 text-white text-[8px] font-bold text-center leading-tight py-0.5">
                                封面
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMarketFormImages((prev) => prev.filter((_, i) => i !== idx));
                                setActiveMarketUploadPreviewIndex(0);
                              }}
                              className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="移除此图"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 5. 详细描述 */}
                  <div>
                    <label className="text-[10px] font-bold text-[#6D5A46] block mb-1">
                      详细描述 (瑕疵/成色/运费/注意事项):
                    </label>
                    <textarea
                      rows={3}
                      value={marketFormDesc}
                      onChange={(e) => setMarketFormDesc(e.target.value)}
                      placeholder="请详细说明物资成色、出处、是否包邮、转让原因或注意事项…"
                      className="w-full px-3 py-2 rounded-lg border border-[#C5B498] text-xs outline-none bg-white focus:border-[#8C5828] resize-none leading-relaxed"
                    />
                  </div>

                  {/* 安全提示 */}
                  <div className="p-2 rounded-lg bg-[#FAF1D8] border border-[#DFC593] flex items-start gap-1.5 text-[10px] text-[#78350F]">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#D97706]" />
                    <span>请勿发布与利韩或巨人无关的违规内容；所有交易均需在正规第三方平台完成。</span>
                  </div>

                  {/* 提交按钮 */}
                  <div className="flex items-center justify-end pt-1">
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-lg text-xs font-bold bg-[#8C5828] hover:bg-[#72451E] text-[#FFFDF8] cursor-pointer transition-colors shadow-xs"
                    >
                      立即呈报发布
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {/* 语C角色拟音专属配置：人物选择 */}
                  {composeCategory === 'roleplay' && (
                    <div className="relative z-10 py-1 space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[11px] font-bold text-[#16273B] flex items-center gap-1">
                          <Sparkles size={11} />
                          <span>选择拟音人物与卡片立绘</span>
                        </span>
                        <span className="text-[10px] text-[#8C6D4F]">卡片将固定显示所选图片</span>
                      </div>

                      {/* 人物选择横向滑轨 */}
                      <div className="flex items-center gap-2.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar px-1">
                        {allCharacters.map((char) => {
                          const isSelected = selectedChar?.name === char.name;
                          return (
                            <button
                              key={char.id}
                              type="button"
                              onClick={() => handleSelectCharacter(char)}
                              className={`shrink-0 flex flex-col items-center gap-1 cursor-pointer transition-all ${
                                isSelected
                                  ? 'scale-105 opacity-100'
                                  : 'opacity-65 hover:opacity-100'
                              }`}
                            >
                              <CharacterArt
                                src={char.avatar}
                                alt={char.name}
                                fit="cover"
                                className={`w-11 h-11 rounded-full transition-all ${
                                  isSelected ? 'ring-2 ring-[#7A4F1D] ring-offset-2 shadow-xs' : ''
                                }`}
                              />
                              <span className={`text-[10px] whitespace-nowrap ${isSelected ? 'text-[#16273B] font-black' : 'text-[#50687E] font-medium'}`}>
                                {char.name}
                              </span>
                            </button>
                          );
                        })}

                        {/* 自定义上传新角色/立绘头像 */}
                        <label className="shrink-0 flex flex-col items-center gap-1 cursor-pointer opacity-70 hover:opacity-100 transition-all">
                          <div className="w-11 h-11 rounded-full border-2 border-dashed border-[#8C6D4F] flex items-center justify-center bg-[#FAF4E4] text-[#8C6D4F] hover:bg-white transition-colors">
                            <Plus size={16} />
                          </div>
                          <span className="text-[10px] text-[#8C6D4F] font-bold whitespace-nowrap">自定义</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleCustomCharFile(file);
                            }}
                          />
                        </label>
                      </div>

                      {/* 如果用户选了自定义图片待确认 */}
                      {pendingCustomImage && (
                        <div className="p-2 rounded-lg bg-[#FAF4E4] border border-[#D5C19A] flex items-center gap-2">
                          <CharacterArt
                            src={pendingCustomImage}
                            alt="新头像预览"
                            fit="cover"
                            className="w-8 h-8 rounded-full border border-[#8C6D4F]"
                          />
                          <input
                            type="text"
                            placeholder="角色名称（如：让、三笠、原创）"
                            value={pendingCharName}
                            onChange={(e) => setPendingCharName(e.target.value)}
                            className="flex-1 px-2 py-1 text-xs bg-white rounded border border-[#C5B498] outline-none"
                          />
                          <button
                            type="button"
                            onClick={handleConfirmCustomChar}
                            className="px-2.5 py-1 text-xs bg-[#7A4F1D] text-white rounded font-bold cursor-pointer"
                          >
                            确定
                          </button>
                        </div>
                      )}

                      {/* 当前所选角色立绘与头像确认栏 */}
                      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#FAF4E4] border border-[#DECDB3] text-[11px] text-[#4A3525]">
                        <span className="font-bold text-[#8C6D4F]">已选拟音形象:</span>
                        <CharacterArt
                          src={selectedChar?.avatar || PRESET_CHARACTERS[0].avatar}
                          alt="已选"
                          fit="cover"
                          className="w-5 h-5 rounded-full shrink-0"
                        />
                        <span className="font-black text-[#1E4334]">{selectedChar?.name || PRESET_CHARACTERS[0].name}</span>
                        <span className="text-[10px] text-[#8C6D4F]/80 ml-auto">（卡片文本框右侧将固定展示此图）</span>
                      </div>
                    </div>
                  )}

                  {/* 故事接龙起笔设定 (可编辑输入文档) */}
                  {composeCategory === 'relay' && (
                    <div className="relative z-10 bg-[#F4E6CB] p-2.5 rounded-xl border border-[#DFC593] space-y-1">
                      <label className="text-[10px] font-bold text-[#7A4F1D] block">
                        ✍️ 故事接龙起笔设定 (开篇环境/文档设定):
                      </label>
                      <textarea
                        rows={2}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="输入故事接龙的起笔开篇设定…"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-[#D1B88B] text-xs font-serif-title font-medium leading-relaxed bg-white/95 focus:border-[#235340] outline-none resize-none text-[#2D1F13]"
                      />
                    </div>
                  )}

                  <form onSubmit={publish} className="relative z-10 space-y-2.5">
                    {/* 署名输入已移除：发布人固定为账号昵称（mount 时自动载入，
                        未登录兜底 '调查兵'），不再提供手动输入。 */}

                    {/* 只有故事接龙需要填写标题，闲聊茶歇和角色拟音去除标题 */}
                    {composeCategory === 'relay' && (
                      <div>
                        <label className="text-[10px] font-bold text-[#6D5A46] block mb-1">
                          故事标题 (必填):
                        </label>
                        <input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="例如：墙外森林的古旧钟塔…"
                          className="w-full px-3 py-2 rounded-lg border border-[#C5B498] text-xs sm:text-sm font-bold outline-none bg-white focus:border-[#235340]"
                        />
                      </div>
                    )}

                    <div>
                      <label className="text-[10px] font-bold text-[#6D5A46] block mb-1">
                        {composeCategory === 'roleplay' ? '台词 / 对白内容:' : '内容正文:'}
                      </label>
                      <textarea
                        rows={composeCategory === 'roleplay' ? 3 : composeCategory === 'relay' ? 4 : 3}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder={
                          composeCategory === 'roleplay'
                            ? '以该角色的语气说话（例如：“喂，小鬼，先把桌上的茶渍擦干净再向我报告。”）'
                            : composeCategory === 'relay'
                            ? '输入故事第1棒开篇正文…'
                            : '分享点今天的新鲜事或想法…'
                        }
                        className="w-full px-3 py-2 rounded-lg border border-[#C5B498] text-xs sm:text-sm outline-none bg-white focus:border-[#235340] resize-none leading-relaxed"
                      />
                    </div>

                    <div className="flex items-center justify-end pt-1">
                      <button
                        type="submit"
                        disabled={publishing}
                        className={`px-5 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors shadow-xs ${
                          composeCategory === 'roleplay'
                            ? 'bg-[#16273B] hover:bg-[#223B56] text-[#F9E79F]'
                            : composeCategory === 'relay'
                            ? 'bg-[#7A4F1D] hover:bg-[#633F17] text-[#FFF8EB]'
                            : 'bg-[#1E4334] hover:bg-[#2C5C46] text-[#FAF5EA]'
                        }`}
                      >
                        {publishing ? '发布中…' : '确认发布'}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* ====================================================
          故事接龙编辑弹窗（仅自己发布的接龙可编辑）
         ==================================================== */}
      {editingRelay &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 select-none overflow-y-auto animate-in fade-in duration-150"
            onClick={() => { if (!savingRelayEdit) setEditingRelay(null); }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-[#FAF6EE] popup-frame-border rounded-2xl shadow-2xl p-4 sm:p-5 space-y-3 max-h-[90vh] overflow-y-auto relative my-auto shrink-0"
            >
              <CardPatternOverlay opacity={0.1} mode="multiply" />

              <div className="relative z-10 flex items-center justify-between pb-2 border-b border-[#D8C7AA]">
                <h2 className="font-serif-title text-sm font-black text-[#2D1F13] flex items-center gap-1.5">
                  <PenLine size={14} /> 编辑故事接龙
                </h2>
                <button
                  type="button"
                  onClick={() => { if (!savingRelayEdit) setEditingRelay(null); }}
                  className="text-[#8C7A65] hover:text-[#2D1F13] cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <form
                onSubmit={(e) => { e.preventDefault(); void handleSaveRelayEdit(); }}
                className="relative z-10 space-y-3"
              >
                <div>
                  <label className="text-[10px] font-bold text-[#6D5A46] block mb-1">
                    故事标题 (必填):
                  </label>
                  <input
                    value={relayEditTitle}
                    onChange={(e) => setRelayEditTitle(e.target.value)}
                    maxLength={100}
                    className="w-full px-3 py-2 rounded-lg border border-[#C5B498] text-xs sm:text-sm font-bold outline-none bg-white focus:border-[#235340]"
                  />
                </div>

                <div className="bg-[#F4E6CB] p-2.5 rounded-xl border border-[#DFC593] space-y-1">
                  <label className="text-[10px] font-bold text-[#7A4F1D] block">
                    ✍️ 起笔设定 (开篇环境/文档设定，可留空):
                  </label>
                  <textarea
                    rows={2}
                    value={relayEditPrompt}
                    onChange={(e) => setRelayEditPrompt(e.target.value)}
                    maxLength={2000}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#D1B88B] text-xs font-serif-title font-medium leading-relaxed bg-white/95 focus:border-[#235340] outline-none resize-none text-[#2D1F13]"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-[#6D5A46] block mb-1">
                    第 1 棒开篇正文 (必填):
                  </label>
                  <textarea
                    rows={6}
                    value={relayEditBody}
                    onChange={(e) => setRelayEditBody(e.target.value)}
                    maxLength={5000}
                    className="w-full px-3 py-2 rounded-lg border border-[#C5B498] text-xs sm:text-sm outline-none bg-white focus:border-[#235340] resize-none leading-relaxed font-serif-title"
                  />
                  <p className="mt-1 text-[10px] text-[#8C7A65]">
                    仅可编辑自己发起的接龙；保存后合订本会自动重新编译，他人已接的后续棒数不受影响。
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setEditingRelay(null)}
                    disabled={savingRelayEdit}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-[#EFE3CD] hover:bg-[#E5D5BA] border border-[#C5B295] text-[#6D5A46] cursor-pointer transition-colors disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={savingRelayEdit}
                    className="px-5 py-2 rounded-lg text-xs font-bold bg-[#7A4F1D] hover:bg-[#633F17] text-[#FFF8EB] cursor-pointer transition-colors shadow-xs disabled:opacity-50"
                  >
                    {savingRelayEdit ? '保存中…' : '保存修改'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* ====================================================
          土豆市集物资详情弹窗 (选中商品卡片时弹出)
         ==================================================== */}
      {selectedMarketItem &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 select-none overflow-y-auto animate-in fade-in duration-150"
            onClick={() => setSelectedMarketItem(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-[#FAF6EE] popup-frame-border rounded-2xl shadow-2xl p-4 sm:p-5 space-y-3.5 max-h-[90vh] overflow-y-auto relative my-auto shrink-0 text-[#2D1F13]"
            >
              <CardPatternOverlay opacity={0.08} mode="multiply" />

              {/* 弹窗顶栏 */}
              <div className="relative z-10 flex items-center justify-between pb-2 border-b border-[#D8C7AA]">
                <div className="flex items-center gap-1.5">
                  <span className="text-base">🥔</span>
                  <span className="font-serif-title font-black text-sm text-[#2D1F13]">
                    市集物资详情
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedMarketItem(null)}
                  className="text-[#8C7A65] hover:text-[#2D1F13] cursor-pointer p-1 rounded transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* 大图轮播与预览 */}
              {(() => {
                const currentImages =
                  selectedMarketItem.images && selectedMarketItem.images.length > 0
                    ? selectedMarketItem.images
                    : [selectedMarketItem.image];
                const activeImg = currentImages[activeMarketDetailImageIndex] || currentImages[0];

                return (
                  <div className="relative z-10 space-y-2">
                    <div className="relative aspect-4/3 rounded-xl overflow-hidden border-2 border-[#8C6D4F]/40 bg-[#EFE5D2] group">
                      <img
                        src={activeImg}
                        alt={selectedMarketItem.title}
                        className="w-full h-full object-cover cursor-zoom-in"
                        onClick={() => {
                          setPreviewLargeSrc(activeImg);
                          setIsPreviewLargeOpen(true);
                        }}
                      />

                      {/* 左右切换箭头 (如果多于1张图) */}
                      {currentImages.length > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMarketDetailImageIndex((prev) =>
                                prev === 0 ? currentImages.length - 1 : prev - 1
                              );
                            }}
                            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1.5 cursor-pointer transition-colors shadow-md"
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMarketDetailImageIndex((prev) =>
                                prev === currentImages.length - 1 ? 0 : prev + 1
                              );
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1.5 cursor-pointer transition-colors shadow-md"
                          >
                            <ChevronRight size={16} />
                          </button>
                        </>
                      )}

                      <div className="absolute bottom-2 left-2 bg-[#8C5828] text-[#FAF5EA] font-pixel text-[10px] font-bold px-2 py-0.5 rounded shadow-xs">
                        🥔 市集物资
                      </div>
                      <div className="absolute bottom-2 right-2 bg-black/75 backdrop-blur-xs text-[#FDE68A] font-bold text-xs px-2.5 py-0.5 rounded shadow-xs">
                        ¥{selectedMarketItem.price}
                      </div>
                    </div>

                    {/* 缩略图切换导航 */}
                    {currentImages.length > 1 && (
                      <div className="flex items-center gap-2 overflow-x-auto pb-1">
                        {currentImages.map((img, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setActiveMarketDetailImageIndex(idx)}
                            className={`w-14 h-14 rounded-lg overflow-hidden border-2 cursor-pointer transition-all shrink-0 ${
                              activeMarketDetailImageIndex === idx
                                ? 'border-[#8C5828] ring-2 ring-[#8C5828]/40 scale-105'
                                : 'border-[#D5C19A] opacity-70 hover:opacity-100'
                            }`}
                          >
                            <img
                              src={img}
                              alt={`小图 ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 标题、发布人与价格详情 */}
              <div className="relative z-10 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-serif-title text-base sm:text-lg font-black text-[#2D1F13]">
                    {selectedMarketItem.title}
                  </h3>
                  <span className="text-lg sm:text-xl font-black text-[#B45309] shrink-0 font-mono">
                    ¥{selectedMarketItem.price}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-[#8C6D4F] py-1 border-y border-[#D8C7AA]">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-[#3B2818]">发布同好:</span>
                    <span>{selectedMarketItem.nickname}</span>
                  </div>
                  <span className="text-[11px] text-[#A89078]">{selectedMarketItem.date}</span>
                </div>

                <div className="space-y-1">
                  <span className="text-xs font-bold text-[#3B2818]">详细说明:</span>
                  <p className="text-xs sm:text-sm text-[#4A3525] leading-relaxed whitespace-pre-wrap bg-white/70 p-2.5 rounded-lg border border-[#D8C7AA]">
                    {selectedMarketItem.description}
                  </p>
                </div>

                {/* 交易安全警告 */}
                <div className="p-2.5 rounded-lg bg-[#FAF1D8] border border-[#DFC593] flex items-start gap-2 text-xs text-[#78350F]">
                  <ShieldAlert className="w-4 h-4 shrink-0 text-[#D97706] mt-0.5" />
                  <div className="text-[11px] leading-relaxed">
                    <span className="font-bold">安全提醒：</span>点击下方按钮将前往第三方交易平台（如闲鱼/淘宝/微店等）。请在正规平台内完成下单与支付，切勿脱离担保平台私下转账。
                  </div>
                </div>
              </div>

              {/* 底部按钮操作 */}
              <div className="relative z-10 pt-2 flex items-center justify-between gap-2 border-t border-[#D8C7AA] flex-wrap">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDeleteMarketItem(selectedMarketItem.id)}
                    className="px-3 py-2 rounded-lg text-xs font-bold text-[#DC2626] hover:bg-red-50 border border-red-200 cursor-pointer flex items-center gap-1 transition-colors"
                  >
                    <Trash2 size={14} />
                    <span>下架物资</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playActionClick();
                      setShareTarget({ type: 'market', marketItem: selectedMarketItem });
                      setIsShareModalOpen(true);
                    }}
                    className="px-3 py-2 rounded-lg text-xs font-bold bg-[#EFE3CD] hover:bg-[#E5D5BA] border border-[#C5B295] text-[#8C6D4F] hover:text-[#1E4334] cursor-pointer flex items-center gap-1.5 transition-colors shadow-2xs"
                  >
                    <Share2 size={13} />
                    <span>生成分享海报/链接</span>
                  </button>
                </div>

                <a
                  href={selectedMarketItem.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2 rounded-lg text-xs font-bold bg-[#8C5828] hover:bg-[#72451E] text-[#FFFDF8] cursor-pointer transition-transform active:scale-95 flex items-center gap-1.5 shadow-sm"
                >
                  <ShoppingBag size={14} />
                  <span>前往交易看看详情 ➔</span>
                </a>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ====================================================
          大图查看器放大弹窗
         ==================================================== */}
      {isPreviewLargeOpen &&
        previewLargeSrc &&
        createPortal(
          <div
            className="fixed inset-0 z-[1100] bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 select-none animate-in fade-in duration-150"
            onClick={() => setIsPreviewLargeOpen(false)}
          >
            <div
              className="relative max-w-3xl max-h-[90vh] flex flex-col items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={previewLargeSrc}
                alt="大图预览"
                className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl border border-white/20"
              />
              <button
                type="button"
                onClick={() => setIsPreviewLargeOpen(false)}
                className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white rounded-full p-2 cursor-pointer shadow-md transition-colors"
                title="关闭大图"
              >
                <X size={20} />
              </button>
            </div>
          </div>,
          document.body
        )}
      {/* ====================================================
          兵长茶会分享弹窗 (支持直达链接、文案口令、第三方平台与小红书/LOFTER海报)
         ==================================================== */}
      <TeaPartyShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        target={shareTarget}
        onShowToast={onShowToast}
      />
    </div>
  );
};

