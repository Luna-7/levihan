import { ScrollItem } from '../types';

export const CATEGORY_NAMES: Record<string, { label: string; icon: string; color: string; tagBg: string }> = {
  secret: { label: '兵团秘密', icon: '⚔️', color: '#86efac', tagBg: 'bg-[#1b3a2b] border-[#2e5944] text-[#a7f3d0]' },
  miss: { label: '深夜思念', icon: '🌙', color: '#c084fc', tagBg: 'bg-[#2b1f3d] border-[#4a346e] text-[#e9d5ff]' },
  wish: { label: '自由心愿', icon: '🕊️', color: '#93c5fd', tagBg: 'bg-[#1c2e42] border-[#2f4b6a] text-[#bfdbfe]' },
  release: { label: '释怀前行', icon: '🍃', color: '#fde047', tagBg: 'bg-[#3b321c] border-[#5e502a] text-[#fef08a]' },
  whisper: { label: '土豆碎念', icon: '🥔', color: '#fda4af', tagBg: 'bg-[#3d241c] border-[#663b2c] text-[#fecdd3]' },
};

export const INITIAL_SCROLLS: ScrollItem[] = [
  {
    id: 'aot-scroll-1',
    content: '巨木森林的夜很静，风穿过树冠的声音让人安心。利威尔在旁边擦拭刀刃，热汤里加了我白天摘的野蘑菇。只要有彼此在，长夜就不可怕。',
    author: '戴单眼罩的四眼',
    category: 'whisper',
    timestamp: Date.now() - 1000 * 60 * 25,
    likes: 68,
    fireflies: 42,
  },
  {
    id: 'aot-scroll-2',
    content: '喂，四眼，别总把稀奇古怪的药草往锅里倒。明天还要带队穿过森林，把汤喝完早点休息。你的决定我从不会怀疑。',
    author: '洁癖兵长',
    category: 'secret',
    timestamp: Date.now() - 1000 * 60 * 90,
    likes: 92,
    fireflies: 75,
  },
  {
    id: 'aot-scroll-3',
    content: '在这片没有巨人的宁静树林里，如果时间能永远停留在篝火旁这一刻该多好。不用背负那么多名字，只是两个人围着一锅热气腾腾的汤。',
    author: '调查兵团的守望者',
    category: 'miss',
    timestamp: Date.now() - 1000 * 60 * 180,
    likes: 104,
    fireflies: 88,
  },
  {
    id: 'aot-scroll-4',
    content: '把所有的迷茫和遗憾都埋进这棵古树的树洞里吧。当太阳升起、跨上战马的那一刻，我们依然会毫无退缩地献出心脏。',
    author: '驻地新兵',
    category: 'wish',
    timestamp: Date.now() - 1000 * 60 * 360,
    likes: 47,
    fireflies: 33,
  },
  {
    id: 'aot-scroll-5',
    content: '从前线回来的路上捡到一个土豆，烤得焦香分成两半。无论这个世界多么残酷，总有人在篝火旁等你归来。',
    author: '林间拾柴的旅人',
    category: 'release',
    timestamp: Date.now() - 1000 * 60 * 620,
    likes: 85,
    fireflies: 60,
  },
  {
    id: 'aot-scroll-6',
    content: '今天也要好好吃饭，好好活着。向树洞许一个愿望：愿我们所珍视的一切，终能在黎明时相聚。塔塔开！',
    author: '墙内同好',
    category: 'wish',
    timestamp: Date.now() - 1000 * 60 * 1200,
    likes: 73,
    fireflies: 51,
  }
];

export const TRAVELER_DIALOGUES = [
  '利威尔：“喂，四眼，别把奇怪的树根丢进锅里，汤要溢出来了。”',
  '韩吉：“利威尔！这可是我在巨木森林新采的蘑菇，汤很香的，快尝尝！”',
  '韩吉：“如果累了就把心事投进树洞吧，它在巨木森林守护了千百年呢。”',
  '利威尔：“喝完这碗汤就去休息。长夜虽冷，但明天太阳依然会升起。”',
  '韩吉：“无论世界如何残酷，只要停下来吃碗热汤，就又有力气塔塔开了！”',
  '利威尔：“树洞会替你守口如瓶，不必再把沉重的心事一个人扛着。”',
];
