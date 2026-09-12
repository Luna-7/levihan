import React, { useState } from 'react';
import { DOUJINSHI_BOOKS } from '../data/initialData';
import { DoujinshiBook } from '../types';
import { soundManager } from '../utils/audio';

interface Props {
  onCopyCode: (code: string) => void;
  onShowToast: (msg: string) => void;
}

export const DoujinshiArchive: React.FC<Props> = ({ onCopyCode, onShowToast }) => {
  const [unlocked, setUnlocked] = useState(true);
  const [passkeyInput, setPasskeyInput] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'canon' | 'sweet' | 'serious' | 'au' | 'artbook'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const handleUnlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = passkeyInput.trim().toLowerCase();
    if (['1225', '0905', '1209', 'lh99', '土豆', '利韩', '心臓を捧げよ', 'levihan', 'rivahan'].includes(code)) {
      soundManager.playFanfare();
      setUnlocked(true);
      onShowToast('🎉 暗号核验通过！欢迎进入利韩同人本藏书阁！');
    } else {
      soundManager.playBlip();
      onShowToast('暗号有误，请尝试兵长生日(1225)、韩吉生日(0905)或暗号“土豆”');
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
                  利韩同人本专区
                </h2>
                <span className="bg-[#5B3F8A] text-[#F9E79F] text-[10px] font-pixel px-2 py-0.5 rounded-xs">
                  TOP SECRET
                </span>
              </div>
              <p className="font-retro-jp text-xs text-[#7A6958] mt-0.5">
                汉化精修同人本合集 · 全彩画集特典 · 珍藏正剧扫描库
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!unlocked ? (
              <button
                onClick={() => {
                  soundManager.playCoin();
                  setUnlocked(true);
                  onShowToast('已为群友开启免密浏览模式');
                }}
                className="text-xs font-retro-jp px-2.5 py-1 bg-[#EAE2CE] hover:bg-[#DDD3BD] border border-[#BFA985] rounded-xs cursor-pointer"
              >
                群友免密直达 🗝️
              </button>
            ) : (
              <span className="text-xs font-pixel text-[#27AE60] bg-[#E8F8F5] border border-[#A2D9CE] px-2 py-1 rounded-xs">
                已安全认证 ✓
              </span>
            )}
          </div>
        </div>

        {/* Protection / Anti-resell Notice */}
        <div className="p-2.5 bg-[#FBF0EE] border-l-4 border-[#C0392B] rounded-r-xs font-retro-jp text-xs text-[#900C3F] space-y-1">
          <div className="font-bold flex items-center gap-1.5">
            <span>⚠️</span>
            <span>【绝对禁令】严禁商用倒卖与公开二次传播：</span>
          </div>
          <p className="leading-relaxed">
            本区收录的汉化作品为利韩同好自发翻译与精修，<b>严禁上传至闲鱼/拼多多/微店有偿贩卖</b>，严禁搬运至外网公开社交平台打扰原作者。
          </p>
        </div>

        {/* Lock / Passkey Verification Box if locked */}
        {!unlocked && (
          <div className="mt-4 p-4 bg-[#FFFEEF] border border-[#D5C9AF] rounded-sm text-center">
            <h3 className="font-pixel text-xs sm:text-sm text-[#5B3F8A] font-bold mb-2">
              请输入调查暗号解锁同人本完整下载链接
            </h3>
            <form onSubmit={handleUnlockSubmit} className="max-w-md mx-auto flex flex-wrap justify-center gap-2">
              <input
                type="text"
                value={passkeyInput}
                onChange={(e) => setPasskeyInput(e.target.value)}
                placeholder="暗号提示：兵长生日 1225 / 土豆 / 1209"
                className="px-3 py-1.5 text-xs font-retro-jp bg-[#FAF5E8] border border-[#BFA985] rounded-xs w-64 focus:outline-none focus:ring-1 focus:ring-[#5B3F8A]"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-[#5B3F8A] hover:bg-[#4A2D78] text-[#F9E79F] font-pixel text-xs rounded-xs border border-[#3E2266] cursor-pointer transition-all shadow-xs"
              >
                解锁阅读 🗝️
              </button>
            </form>
          </div>
        )}
      </section>

      {/* Book List Content when unlocked */}
      {unlocked && (
        <div className="space-y-3">
          {/* Controls Bar: Category Filters & Search */}
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
                placeholder="搜索同人本/社团作者..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-2.5 py-1 text-xs font-retro-jp bg-[#FAF5E8] border border-[#BFA985] rounded-xs w-full sm:w-48 focus:outline-none"
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

          {/* Book Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredBooks.map((book) => (
              <div
                key={book.id}
                className="bg-[#FFFEEF] border-2 border-[#D5C9AF] hover:border-[#5B3F8A] rounded-sm p-3 flex flex-col justify-between transition-all hover:shadow-sm"
              >
                <div>
                  {/* Top Badges */}
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-pixel text-[10px] bg-[#5B3F8A] text-[#F9E79F] px-2 py-0.5 rounded-xs font-bold">
                        {book.coverTag}
                      </span>
                      <span className="font-retro-jp text-[11px] bg-[#FAF5E8] text-[#6B5A4B] border border-[#D5C9AF] px-1.5 py-0.2 rounded-xs">
                        {book.format}
                      </span>
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

                  {/* Title & Author */}
                  <h3 className="font-retro-jp text-sm sm:text-base font-bold text-[#1E3A2B] leading-snug">
                    {book.title}
                  </h3>
                  {book.originalTitle && (
                    <div className="font-pixel text-[10px] text-[#8C7A68] mt-0.5">
                      {book.originalTitle}
                    </div>
                  )}

                  <div className="font-retro-jp text-xs text-[#B7791F] mt-1 flex items-center gap-1">
                    <span>✍️</span>
                    <span>社团/作者：{book.authorOrCircle}</span>
                  </div>

                  {/* Description */}
                  <p className="font-retro-jp text-xs text-[#5D4E41] mt-2 leading-relaxed bg-[#FAF5E8] p-2 rounded-xs border border-[#EAE2CE]">
                    {book.description}
                  </p>
                </div>

                {/* Minimal Footer Action Bar with Auto-Jump */}
                <div className="mt-3 pt-2 border-t border-dashed border-[#E0D5BE] flex items-center justify-between text-xs font-retro-jp">
                  <div>
                    {book.code ? (
                      <span className="font-pixel text-[11px] text-[#B7791F] bg-[#FAF5E8] border border-[#EAE2CE] px-2 py-0.5 rounded-xs">
                        提取码 {book.code}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#A69B88]">免提取码</span>
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
              没有找到匹配的同人本，换个关键词搜搜看吧～
            </div>
          )}

          {/* Bottom Copyright & Etiquette Pledge */}
          <div className="bg-[#FFFEEF] border border-[#D5C9AF] rounded-sm p-3 text-[11px] font-retro-jp text-[#7A6958] leading-relaxed">
            <span className="font-bold text-[#5B3F8A]">📖 读者公约：</span>
            本站所有资源收集自网络公开同好交流及群友私藏分享。原作《进击的巨人》版权归谏山创老师及讲谈社所有；同人志著作权归原作者与绘制社团所有；汉化精修嵌字归汉化同好所有。请大家文明阅读，严禁倒卖商用，违者必究！
          </div>
        </div>
      )}
    </div>
  );
};
