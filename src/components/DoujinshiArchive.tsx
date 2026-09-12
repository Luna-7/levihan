import React, { useState } from 'react';
import { DOUJINSHI_BOOKS } from '../data/initialData';
import { DoujinshiBook } from '../types';
import { soundManager } from '../utils/audio';

interface Props {
  onCopyCode: (code: string) => void;
  onShowToast: (msg: string) => void;
}

interface MangaPreviewItem {
  id: string;
  title: string;
  chapter: string;
  pageLabel: string;
  badge: string;
  desc: string;
  bucketUrl: string;
  sampleQuotes: string;
}

const MANGA_COVER_PREVIEWS: MangaPreviewItem[] = [
  {
    id: 'prev-1',
    title: '利韩同人本 A-Z 全卷',
    chapter: 'VOLUME 01 · 卷首扉页',
    pageLabel: 'PAGE 01 / 漫画首页',
    badge: '存储桶同步',
    desc: '日本知名利韩社团经典开卷扉页，高清原稿已挂载至云端存储桶。',
    bucketUrl: 'https://pan.quark.cn/s/ee4920b9c9f7#/list/share',
    sampleQuotes: '「利威尔，不管墙外是什么样，我们都要一起去看。」',
  },
  {
    id: 'prev-2',
    title: '《夜明けの歌》（黎明之歌）',
    chapter: 'CHAPTER 01 · 正剧篇首卷',
    pageLabel: 'PAGE 01 / 漫画首页',
    badge: '高精扫描',
    desc: '王政篇严肃向长篇作品漫画第1页精修扫描，静默中交付后背的经典分镜。',
    bucketUrl: 'https://pan.quark.cn/s/ee4920b9c9f7#/list/share',
    sampleQuotes: '「喂，四眼，别死了。听到了没有？」',
  },
  {
    id: 'prev-3',
    title: '《自由の翼の下で》',
    chapter: 'ACT 01 · 原作深度向',
    pageLabel: 'PAGE 01 / 卷首彩页',
    badge: '单行本精校',
    desc: '玛雷远征前夕，两代团长与士兵长身份切换的深邃回想篇扉页。',
    bucketUrl: 'https://pan.quark.cn/s/ee4920b9c9f7#/list/share',
    sampleQuotes: '「把心脏献给全人类吧——心臓を捧げよ！」',
  },
  {
    id: 'prev-4',
    title: '《紅茶と眼鏡の引力》',
    chapter: 'SCENE 01 · 兵团生活喜剧',
    pageLabel: 'PAGE 01 / 漫画首页',
    badge: '精修全彩',
    desc: '调查兵团驻地轻喜剧漫画首页，红茶与实验烧杯碰撞的温存日常。',
    bucketUrl: 'https://pan.quark.cn/s/ee4920b9c9f7#/list/share',
    sampleQuotes: '「韩吉！你的实验试管为什么会掉进我的红茶杯里？！」',
  },
];

export const DoujinshiArchive: React.FC<Props> = ({ onCopyCode, onShowToast }) => {
  // Page is locked by default - requires password: levihan
  const [unlocked, setUnlocked] = useState(false);
  const [passkeyInput, setPasskeyInput] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'canon' | 'sweet' | 'serious' | 'au' | 'artbook'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPreview, setSelectedPreview] = useState<MangaPreviewItem | null>(null);

  const handleUnlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = passkeyInput.trim().toLowerCase();
    if (code === 'levihan') {
      soundManager.playFanfare();
      setUnlocked(true);
      onShowToast('🎉 密码核验通过！欢迎查阅土豆粮仓驻地！');
    } else {
      soundManager.playBlip();
      onShowToast('密码错误，请重新输入（提示随时刷新）');
    }
  };

  const handleAutoJump = (url: string, code?: string) => {
    soundManager.playCoin();
    if (code) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(
          () => onShowToast(`已自动复制提取码【${code}】并跳转网盘！📋`),
          () => onShowToast(`提取码为：${code}`)
        );
      } else {
        onShowToast(`提取码为：${code}`);
      }
    } else {
      onShowToast('正在为您跳转至网盘... ↗');
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const filteredBooks = DOUJINSHI_BOOKS.filter((book) => {
    const matchCat = categoryFilter === 'all' || book.category === categoryFilter;
    const matchSearch =
      book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      book.authorOrCircle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (book.source && book.source.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (book.translator && book.translator.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (book.typesetter && book.typesetter.toLowerCase().includes(searchQuery.toLowerCase())) ||
      book.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="space-y-4 text-[#2C241D]">
      {/* Header Banner */}
      <section className="bg-[#FAF5E8] border-2 border-[#5B3F8A] rounded-md p-3.5 sm:p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-dashed border-[#D5C9AF] pb-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔒</span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-pixel text-lg sm:text-xl text-[#5B3F8A] font-black tracking-wide">
                  土豆粮仓驻地
                </h2>
                <span className="bg-[#5B3F8A] text-[#F9E79F] text-[10px] font-pixel px-2 py-0.5 rounded-xs">
                  TOP SECRET
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {unlocked && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-pixel text-[#27AE60] bg-[#E8F8F5] border border-[#A2D9CE] px-2 py-1 rounded-xs flex items-center gap-1">
                  <span>✓</span>
                  <span>已解锁认证</span>
                </span>
                <button
                  onClick={() => {
                    soundManager.playBlip();
                    window.location.reload();
                  }}
                  className="text-xs font-retro-jp px-2 py-1 bg-[#FAF5E8] hover:bg-[#EAE2CE] border border-[#D5C9AF] text-[#5B4636] rounded-xs cursor-pointer flex items-center gap-1"
                  title="提示随时刷新页面"
                >
                  <span>🔄</span>
                  <span>随时刷新</span>
                </button>
                <button
                  onClick={() => {
                    soundManager.playBlip();
                    setUnlocked(false);
                    setPasskeyInput('');
                    onShowToast('已重新锁定驻地 🔒');
                  }}
                  className="text-xs font-retro-jp px-2 py-1 bg-[#FAF5E8] hover:bg-[#F3EAD5] border border-[#BFA985] text-[#8C7A68] rounded-xs cursor-pointer"
                  title="重新锁定驻地"
                >
                  锁定
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Protection / Anti-resell Notice */}
        <div className="space-y-2">
          <div className="p-2.5 bg-[#FBF0EE] border-l-4 border-[#C0392B] rounded-r-xs font-retro-jp text-xs text-[#900C3F] space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <span>⚠️</span>
              <span>【绝对禁令】严禁商用倒卖与公开二次传播：</span>
            </div>
            <p className="leading-relaxed">
              本驻地收录的汉化作品为利韩同好自发翻译与精修，<b>严禁上传至闲鱼/拼多多/微店有偿贩卖</b>，严禁搬运至外网公开社交平台打扰原作者。
            </p>
          </div>
        </div>

        {/* Lock Screen / Passkey Form if locked */}
        {!unlocked && (
          <div className="mt-4 p-4 sm:p-6 bg-[#FFFEEF] border-2 border-dashed border-[#5B3F8A] rounded-sm text-center space-y-3">
            <div className="w-10 h-10 mx-auto bg-[#5B3F8A] text-[#F9E79F] rounded-full flex items-center justify-center text-xl shadow-xs">
              🗝️
            </div>
            <div className="space-y-1">
              <h3 className="font-pixel text-sm sm:text-base text-[#5B3F8A] font-bold">
                请输入进入密码
              </h3>
              <p className="font-retro-jp text-xs text-[#7A6958]">
                为保护群内同好汉化嵌字成果，进入本驻地请输入密码认证（提示随时刷新）
              </p>
            </div>

            <form onSubmit={handleUnlockSubmit} className="max-w-md mx-auto flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
              <input
                type="password"
                value={passkeyInput}
                onChange={(e) => setPasskeyInput(e.target.value)}
                placeholder="请输入访问密码..."
                autoFocus
                className="px-3.5 py-2 text-xs font-pixel bg-[#FAF5E8] border-2 border-[#5B3F8A] rounded-xs w-full sm:w-64 focus:outline-none focus:ring-1 focus:ring-[#5B3F8A] text-center tracking-widest"
              />
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="submit"
                  className="flex-1 sm:flex-initial px-4 py-2 bg-[#5B3F8A] hover:bg-[#4A2D78] text-[#F9E79F] font-pixel text-xs rounded-xs border border-[#3E2266] cursor-pointer transition-all shadow-xs active:scale-95 whitespace-nowrap"
                >
                  确认进入 🗝️
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playBlip();
                    window.location.reload();
                  }}
                  className="px-3 py-2 bg-[#FAF5E8] hover:bg-[#EAE2CE] text-[#5B4636] border border-[#D5C9AF] font-retro-jp text-xs rounded-xs cursor-pointer transition-all whitespace-nowrap"
                  title="提示随时刷新"
                >
                  🔄 刷新
                </button>
              </div>
            </form>

            <div className="text-[11px] font-retro-jp text-[#8C7A68] pt-1">
              提示：请输入兵团同好口令进入（提示随时刷新）
            </div>
          </div>
        )}
      </section>

      {/* Unlocked Content */}
      {unlocked && (
        <div className="space-y-4">
          {/* 1. 漫画首页精选预览 · 链接存储桶 */}
          <section className="bg-[#FFFEEF] border-2 border-[#1E4334] rounded-md p-3.5 sm:p-5 shadow-xs space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-dashed border-[#D5C9AF] pb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xl sm:text-2xl">📖</span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-pixel text-sm sm:text-base text-[#1E4334] font-bold">
                      漫画首页精选预览 · 链接存储桶
                    </h3>
                    <span className="text-[10px] font-retro-jp px-1.5 py-0.5 bg-[#E8F8F5] text-[#27AE60] border border-[#A2D9CE] rounded-xs font-bold">
                      云端存储桶直链已连接
                    </span>
                  </div>
                  <p className="text-[11px] font-retro-jp text-[#7A6958] mt-0.5">
                    打开驻地即览精选同人本漫画首页与卷首扉页，点击可直达云端存储桶查阅完整高清原卷（提示随时刷新）
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <a
                  href="https://pan.quark.cn/s/ee4920b9c9f7#/list/share"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1E4334] hover:bg-[#2B5E4A] text-[#F9E79F] font-pixel text-xs rounded-xs transition-all shadow-xs cursor-pointer"
                  title="进入云端存储桶完整目录"
                >
                  <span>📦 链接云端存储桶 ↗</span>
                </a>
                <button
                  onClick={() => {
                    soundManager.playBlip();
                    window.location.reload();
                  }}
                  className="px-2.5 py-1.5 bg-[#FAF5E8] hover:bg-[#EAE2CE] text-[#5B4636] border border-[#D5C9AF] font-retro-jp text-xs rounded-xs transition-all cursor-pointer"
                  title="提示随时刷新页面"
                >
                  <span>🔄 刷新</span>
                </button>
              </div>
            </div>

            {/* 漫画首页精选预览卡片网格 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {MANGA_COVER_PREVIEWS.map((preview) => (
                <div
                  key={preview.id}
                  className="bg-[#FAF5E8] border-2 border-[#D5C9AF] hover:border-[#1E4334] rounded-xs p-3 flex flex-col justify-between transition-all hover:shadow-xs group"
                >
                  <div className="space-y-2">
                    {/* Simulated Stylized Manga Page Preview */}
                    <div className="relative bg-[#FBF9F2] border border-[#C5B495] rounded-xs p-3 text-center overflow-hidden shadow-2xs">
                      <div className="absolute top-1 left-1 text-[9px] font-pixel px-1 py-0.2 bg-[#1E4334] text-[#F9E79F] rounded-xs">
                        {preview.pageLabel}
                      </div>
                      <div className="absolute top-1 right-1 text-[9px] font-retro-jp px-1 py-0.2 bg-[#EAE2CE] text-[#7A6958] rounded-xs">
                        {preview.badge}
                      </div>

                      {/* Stylized Manga Cover Frame */}
                      <div className="my-4 pt-2 pb-1 border-y border-dashed border-[#D5C9AF]">
                        <div className="text-[10px] font-pixel text-[#8C7A68] tracking-widest uppercase">
                          進撃の巨人 · LEVI × HANGE
                        </div>
                        <div className="font-pixel text-xs sm:text-sm font-black text-[#1E3A2B] my-1 tracking-wide line-clamp-1">
                          {preview.title}
                        </div>
                        <div className="text-[10px] font-retro-jp text-[#B7791F] font-bold">
                          {preview.chapter}
                        </div>
                      </div>

                      {/* Manga Quote Snippet */}
                      <p className="text-[10px] font-retro-jp text-[#5D4E41] italic line-clamp-2 px-1">
                        {preview.sampleQuotes}
                      </p>
                    </div>

                    <p className="text-[11px] font-retro-jp text-[#6B5A4B] leading-relaxed">
                      {preview.desc}
                    </p>
                  </div>

                  {/* Actions for this preview */}
                  <div className="mt-3 pt-2 border-t border-dashed border-[#D5C9AF] flex items-center justify-between gap-1.5 text-xs font-retro-jp">
                    <button
                      onClick={() => setSelectedPreview(preview)}
                      className="text-[11px] text-[#1E4334] hover:text-[#2A5C47] font-bold underline cursor-pointer"
                    >
                      🔍 预览大图
                    </button>
                    <a
                      href={preview.bucketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#1E4334] hover:bg-[#2B5E4A] text-[#F9E79F] font-pixel text-[10px] rounded-xs transition-all shadow-2xs"
                    >
                      <span>直达存储桶 ↗</span>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 2. Controls Bar: Category Filters & Search */}
          <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-md p-2.5 sm:p-3 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
            {/* Categories */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'all', label: '全部作品' },
                { key: 'canon', label: '📖 原作深度向' },
                { key: 'serious', label: '⚔️ 严肃正剧' },
                { key: 'sweet', label: '☕ 治愈日常' },
                { key: 'au', label: '🌆 现代平行AU' },
                { key: 'artbook', label: '🎨 全彩画集特典' },
              ].map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => {
                    soundManager.playBlip();
                    setCategoryFilter(cat.key as typeof categoryFilter);
                  }}
                  className={`px-2.5 py-1 text-xs font-retro-jp rounded-xs border transition-all cursor-pointer ${
                    categoryFilter === cat.key
                      ? 'bg-[#5B3F8A] text-[#F9E79F] border-[#5B3F8A] font-bold shadow-xs'
                      : 'bg-[#FAF5E8] text-[#5B4636] border-[#D5C9AF] hover:bg-[#F3EAD5]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="搜索名称/作者/来源/汉化/嵌字..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-2.5 py-1 text-xs font-retro-jp bg-[#FAF5E8] border border-[#BFA985] rounded-xs w-full sm:w-56 focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-xs text-[#8C7A68] hover:text-[#1E4334] px-1 cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* 3. Book Cards Grid: Every file module explicitly writes: 名称、作者、来源、汉化、嵌字 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filteredBooks.map((book) => (
              <div
                key={book.id}
                className="bg-[#FFFEEF] border-2 border-[#D5C9AF] hover:border-[#5B3F8A] rounded-sm p-3.5 sm:p-4 flex flex-col justify-between transition-all hover:shadow-xs space-y-3"
              >
                <div className="space-y-2.5">
                  {/* Top Badges */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-pixel text-[10px] bg-[#5B3F8A] text-[#F9E79F] px-2 py-0.5 rounded-xs font-bold">
                        {book.coverTag}
                      </span>
                      <span className="font-retro-jp text-[11px] bg-[#FAF5E8] text-[#6B5A4B] border border-[#D5C9AF] px-1.5 py-0.2 rounded-xs">
                        {book.format}
                      </span>
                      {book.pages && (
                        <span className="font-retro-jp text-[10px] text-[#8C7A68]">
                          {book.pages}
                        </span>
                      )}
                    </div>

                    <span
                      className={`text-[10px] font-retro-jp px-1.5 py-0.5 rounded-xs shrink-0 ${
                        book.platform === '百度网盘'
                          ? 'bg-[#EBF5FB] text-[#2980B9] border border-[#AED6F1]'
                          : 'bg-[#FEF9E7] text-[#B7950B] border border-[#F9E79F]'
                      }`}
                    >
                      {book.platform}
                    </span>
                  </div>

                  {/* 5 Required File Module Fields: 名称、作者、来源、汉化、嵌字 */}
                  <div className="bg-[#FAF5E8] border border-[#E0D5BE] rounded-xs p-2.5 space-y-1.5 text-xs font-retro-jp">
                    <div className="flex items-start gap-1.5">
                      <span className="font-bold text-[#1E4334] shrink-0 w-12 text-right">【名称】</span>
                      <span className="font-bold text-[#1E3A2B] break-words flex-1">{book.title}</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="font-bold text-[#B7791F] shrink-0 w-12 text-right">【作者】</span>
                      <span className="text-[#5B4636] flex-1">{book.authorOrCircle}</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="font-bold text-[#7A6958] shrink-0 w-12 text-right">【来源】</span>
                      <span className="text-[#6B5A4B] flex-1">{book.source || '日本同人展会原刊 / 即卖会'}</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="font-bold text-[#27AE60] shrink-0 w-12 text-right">【汉化】</span>
                      <span className="text-[#2D5A3A] flex-1">{book.translator || '利韩土豆汉化组'}</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="font-bold text-[#8E44AD] shrink-0 w-12 text-right">【嵌字】</span>
                      <span className="text-[#5B3F8A] flex-1">{book.typesetter || '兵团精修嵌字工坊'}</span>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="font-retro-jp text-[11px] sm:text-xs text-[#5D4E41] leading-relaxed bg-[#FFFDF7] p-2 rounded-xs border border-[#EDE5D3]">
                    {book.description}
                  </p>
                </div>

                {/* Minimal Footer Action Bar with Auto-Jump & Bucket preview link */}
                <div className="pt-2.5 border-t border-dashed border-[#E0D5BE] flex items-center justify-between text-xs font-retro-jp">
                  <div className="flex items-center gap-1.5">
                    {book.code ? (
                      <span className="font-pixel text-[11px] text-[#B7791F] bg-[#FAF5E8] border border-[#EAE2CE] px-2 py-0.5 rounded-xs">
                        提取码 {book.code}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#A69B88]">免提取码</span>
                    )}

                    {book.bucketPreviewUrl && (
                      <a
                        href={book.bucketPreviewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-[#1E4334] hover:underline font-bold"
                        title="在存储桶中打开"
                      >
                        📦 存储桶直达
                      </a>
                    )}
                  </div>

                  <button
                    onClick={() => handleAutoJump(book.downloadUrl, book.code)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#1E4334] hover:bg-[#2B5E4A] text-[#FAF5E8] font-pixel text-xs rounded-xs cursor-pointer transition-all shadow-xs active:scale-95"
                  >
                    <span>跳转下载</span>
                    <span>↗</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {filteredBooks.length === 0 && (
            <div className="p-8 text-center bg-[#FFFEEF] border border-dashed border-[#D5C9AF] rounded-sm text-xs font-retro-jp text-[#8C7A68]">
              没有找到匹配的同人本，换个关键词搜搜看吧～（提示随时刷新）
            </div>
          )}

          {/* Bottom Copyright & Etiquette Pledge */}
          <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-sm p-3 text-[11px] font-retro-jp text-[#7A6958] leading-relaxed flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div>
              <span className="font-bold text-[#5B3F8A]">📖 读者公约：</span>
              本站所有资源收集自网络公开同好交流及群友私藏分享。原作《进击的巨人》版权归谏山创老师及讲谈社所有；同人志著作权归原作者与绘制社团所有；汉化精修嵌字归汉化同好所有。严禁倒卖商用！
            </div>
            <div className="shrink-0 text-[10px] text-[#8C7A68] italic">
              提示随时刷新 · 土豆粮仓驻地
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal for Full Manga First Page Preview */}
      {selectedPreview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3">
          <div className="bg-[#FFFEEF] border-4 border-[#1E4334] rounded-md max-w-lg w-full p-4 sm:p-5 shadow-2xl relative space-y-3 font-retro-jp">
            <button
              onClick={() => setSelectedPreview(null)}
              className="absolute top-2 right-2 text-[#5B4636] hover:text-[#1E4334] font-bold text-sm px-2 py-1 cursor-pointer"
            >
              ✕ 关闭
            </button>

            <div className="text-center border-b border-dashed border-[#D5C9AF] pb-2">
              <span className="text-[10px] font-pixel px-2 py-0.5 bg-[#1E4334] text-[#F9E79F] rounded-xs">
                {selectedPreview.pageLabel}
              </span>
              <h3 className="font-pixel text-sm sm:text-base font-black text-[#1E3A2B] mt-1">
                {selectedPreview.title}
              </h3>
              <p className="text-xs text-[#B7791F] font-bold mt-0.5">
                {selectedPreview.chapter}
              </p>
            </div>

            <div className="bg-[#FAF5E8] border border-[#C5B495] rounded-xs p-4 text-center space-y-2">
              <div className="text-xs text-[#5D4E41] leading-relaxed">
                {selectedPreview.desc}
              </div>
              <div className="p-3 bg-[#FFFEEF] border border-dashed border-[#D5C9AF] rounded-xs italic text-xs text-[#2D5A3A]">
                {selectedPreview.sampleQuotes}
              </div>
              <div className="text-[10px] text-[#8C7A68]">
                云端存储桶完整原件包含全部页面、跨页插图及日文原版对比。
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-dashed border-[#D5C9AF]">
              <span className="text-[11px] text-[#7A6958]">提示随时刷新</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedPreview(null)}
                  className="px-3 py-1.5 bg-[#FAF5E8] hover:bg-[#EAE2CE] text-[#5B4636] border border-[#D5C9AF] rounded-xs text-xs cursor-pointer"
                >
                  关闭预览
                </button>
                <a
                  href={selectedPreview.bucketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1E4334] hover:bg-[#2B5E4A] text-[#F9E79F] font-pixel text-xs rounded-xs cursor-pointer"
                >
                  <span>直达存储桶浏览 ↗</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
