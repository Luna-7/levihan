import React, { useState, useEffect } from 'react';
import { ResourceLink, PixivArtist } from '../types';
import { RESOURCE_LINKS, PIXIV_ARTISTS_DATA } from '../data/initialData';
import { soundManager } from '../utils/audio';

interface Props {
  onCopyCode: (code: string) => void;
  onShowToast: (msg: string) => void;
  onGoToDoujin?: () => void;
}

// Pastel Palette for Pixiv Chips
const PALETTE = [
  ['#FFF1E0', '#E2A86B'],
  ['#FDE7E7', '#D98A8A'],
  ['#E7F3E0', '#8FB877'],
  ['#E6EEF8', '#7FA3CF'],
  ['#F4E7F6', '#B486C4'],
  ['#F7F1D6', '#C9A94E'],
  ['#E2F4F2', '#6FB6AE'],
  ['#FBE6D8', '#D99E72'],
  ['#ECE6F7', '#9B86C9'],
];

function hashCode(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

export const ResourceHub: React.FC<Props> = ({
  onCopyCode,
  onShowToast,
  onGoToDoujin,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'anime' | 'creative' | 'manga' | 'ao3' | 'pixiv' | 'doujin'>('all');
  const [selectedArtists, setSelectedArtists] = useState<Set<string>>(new Set());
  const [visitedArtists, setVisitedArtists] = useState<Set<string>>(new Set());
  const [pixivSearch, setPixivSearch] = useState('');

  // Load visited Pixiv artists from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pixivwall:visited');
      if (saved) {
        setVisitedArtists(new Set(JSON.parse(saved)));
      }
    } catch {
      // ignore
    }
  }, []);

  const saveVisited = (newSet: Set<string>) => {
    setVisitedArtists(newSet);
    try {
      localStorage.setItem('pixivwall:visited', JSON.stringify(Array.from(newSet)));
    } catch {
      // ignore
    }
  };

  const handleAutoJump = (url: string, code?: string) => {
    soundManager.playCoin();
    if (code) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(
          () => onShowToast(`已自动复制提取码【${code}】并为你跳转网盘！📋`),
          () => onShowToast(`提取码为：${code}`)
        );
      } else {
        onShowToast(`提取码为：${code}`);
      }
    } else {
      onShowToast('正在为您打开网盘... ↗');
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleToggleArtist = (idOrUrl: string) => {
    soundManager.playBlip();
    const next = new Set(selectedArtists);
    if (next.has(idOrUrl)) {
      next.delete(idOrUrl);
    } else {
      next.add(idOrUrl);
    }
    setSelectedArtists(next);
  };

  const handleOpenSelected = () => {
    if (selectedArtists.size === 0) {
      onShowToast('先点击画师卡片多选几个吧～');
      return;
    }
    let opened = 0;
    const nextVisited = new Set<string>(visitedArtists);

    PIXIV_ARTISTS_DATA.forEach((a) => {
      const key = a.id || a.url;
      if (selectedArtists.has(key) && a.url) {
        const w = window.open(a.url, '_blank');
        if (w) {
          opened++;
          nextVisited.add(key);
          try {
            w.opener = null;
          } catch {
            // ignore
          }
        }
      }
    });

    saveVisited(nextVisited);
    setSelectedArtists(new Set<string>());
    soundManager.playCoin();
    if (opened) {
      onShowToast(`已批量打开 ${opened} 位画师主页，并标记为已读！`);
    } else {
      onShowToast('弹出窗口被浏览器拦截，请在地址栏允许弹出窗口后重试');
    }
  };

  const handleSelectAllPixiv = () => {
    soundManager.playBlip();
    const next = new Set<string>();
    PIXIV_ARTISTS_DATA.forEach((a) => next.add(a.id || a.url));
    setSelectedArtists(next);
    onShowToast(`已全选 ${next.size} 位画师！`);
  };

  const handleResetDonePixiv = () => {
    soundManager.playBlip();
    saveVisited(new Set<string>());
    onShowToast('已重置画师「已读」标记');
  };

  const filteredArtists = PIXIV_ARTISTS_DATA.filter((a) =>
    a.name.toLowerCase().includes(pixivSearch.toLowerCase())
  );

  const animeLinks = RESOURCE_LINKS.filter((r) => r.category === 'anime');
  const creativeLinks = RESOURCE_LINKS.filter((r) => r.category === 'creative');
  const mangaLinks = RESOURCE_LINKS.filter((r) => r.category === 'manga' || r.category === 'link');

  const renderResourceGrid = (links: ResourceLink[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {links.map((item) => (
        <div
          key={item.id}
          onClick={() => handleAutoJump(item.url, item.code)}
          className="bg-[#FFFEEF] border-2 border-[#D5C9AF] hover:border-[#1E4334] rounded-sm p-3 flex flex-col justify-between cursor-pointer transition-all hover:shadow-sm group active:scale-[0.99]"
          title="点击即可自动复制提取码并打开网盘"
        >
          <div>
            {/* Top Badges */}
            <div className="flex items-center justify-between gap-2 mb-2">
              <span
                className={`text-[11px] px-2 py-0.5 rounded-xs font-retro-jp font-bold ${
                  item.platform === '百度网盘'
                    ? 'bg-[#EBF5FB] text-[#2980B9] border border-[#AED6F1]'
                    : item.platform === '夸克网盘'
                    ? 'bg-[#FEF9E7] text-[#B7950B] border border-[#F9E79F]'
                    : 'bg-[#FADBD8] text-[#922B21] border border-[#F5B7B1]'
                }`}
              >
                {item.platform}
              </span>

              {item.code ? (
                <span className="font-pixel text-[11px] text-[#B7791F] bg-[#FAF5E8] border border-[#D4AC0D] px-2 py-0.5 rounded-xs font-bold flex items-center gap-1">
                  <span>📋 提取码</span>
                  <span>{item.code}</span>
                </span>
              ) : (
                <span className="font-retro-jp text-[11px] text-[#27AE60] bg-[#E8F8F5] border border-[#A2D9CE] px-1.5 py-0.5 rounded-xs">
                  免提取码
                </span>
              )}
            </div>

            {/* Title - Fully visible with clean text wrapping */}
            <h3 className="font-bold font-retro-jp text-xs sm:text-sm text-[#2D2319] group-hover:text-[#1E4334] leading-relaxed break-words">
              {item.title}
            </h3>

            {item.description && (
              <p className="text-[11px] font-retro-jp text-[#7A6958] mt-1.5 leading-relaxed">
                {item.description}
              </p>
            )}
          </div>

          {/* Action Hint */}
          <div className="mt-2.5 pt-2 border-t border-dashed border-[#E8E1CE] flex items-center justify-between text-[11px] font-retro-jp text-[#7A6958] group-hover:text-[#1E4334]">
            <span className="flex items-center gap-1">
              <span>🚀</span>
              <span>点击直接跳转下载</span>
            </span>
            <span className="font-bold">↗</span>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="relative bg-[#FAF5E8] border-2 border-[#1E3A2B] rounded-md p-3.5 sm:p-4 my-3 shadow-sm text-[#2C241D]">
      {/* Ribbon Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-3 border-b-2 border-dashed border-[#D5C9AF]">
        <div className="flex items-center gap-2">
          <div className="bg-[#1E4334] text-[#F9E79F] px-2.5 py-0.5 text-xs font-pixel rounded-xs tracking-wider">
            RESOURCE ARCHIVES
          </div>
          <span className="text-xs font-retro-jp text-[#5B4636] font-bold">
            📚 利韩粮仓 · 资源导航
          </span>
        </div>

        {/* Tab Filters */}
        <div className="flex flex-wrap gap-1">
          {[
            { key: 'all', label: '全部' },
            { key: 'anime', label: '📺 动漫原片' },
            { key: 'creative', label: '🎬 二创素材' },
            { key: 'manga', label: '📖 漫画/资料' },
            { key: 'ao3', label: '🌐 AO3镜像' },
            { key: 'pixiv', label: '🎨 PIXIV墙' },
            { key: 'doujin', label: '🔒 同人本专区' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                soundManager.playBlip();
                if (tab.key === 'doujin' && onGoToDoujin) {
                  onGoToDoujin();
                } else {
                  setActiveTab(tab.key as typeof activeTab);
                }
              }}
              className={`px-2 py-0.5 text-xs font-retro-jp rounded-xs border transition-all cursor-pointer ${
                activeTab === tab.key
                  ? 'bg-[#1E4334] text-[#F9E79F] border-[#1E4334] font-bold'
                  : 'bg-[#FFFEEF] text-[#5B4636] border-[#D1C5AD] hover:bg-[#F3EAD5]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* AO3 SECTION */}
      {(activeTab === 'all' || activeTab === 'ao3') && (
        <div className="mb-4 bg-[#FFFEEF] border border-[#D5C9AF] rounded-sm p-3">
          <div className="flex items-center gap-2 text-xs font-pixel text-[#1E4334] font-bold mb-2">
            <span>🌐 AO3 访问 / 镜像速查</span>
          </div>

          <div className="p-2 bg-[#FBEDE9] border border-[#E74C3C] rounded-xs text-xs font-retro-jp text-[#900C3F] mb-3 leading-relaxed">
            ⚠️ <b>OTW 官方提醒</b>：官网以外的镜像站都是第三方运营，在镜像站登录可能泄露账号密码。官方主站永远只认 <b>archiveofourown.org</b>。
          </div>

          <div className="space-y-3 text-xs font-retro-jp">
            <div>
              <span className="font-bold text-[#1E4334] block mb-1">★ 官方主站入口:</span>
              <a
                href="https://archiveofourown.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1E4334] text-[#F9E79F] font-pixel text-xs rounded-xs hover:bg-[#2A5C47] transition-all shadow-xs"
              >
                <span>archiveofourown.org ↗</span>
              </a>
              <span className="text-[11px] text-[#7A6958] ml-2">最安全最全，部分网络需梯子/代理</span>
            </div>

            <div>
              <span className="font-bold text-[#5B4636] block mb-1">官方安全备用域名:</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'https://archiveofourown.com/',
                  'https://archiveofourown.net/',
                  'https://ao3.org/',
                  'https://archiveofourown.gay/',
                  'https://ao3.gay/',
                  'https://archive.transformativeworks.org/',
                ].map((url) => {
                  const domain = url.replace('https://', '').replace('/', '');
                  return (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 py-1 bg-[#FAF5E8] border border-[#BFA985] rounded-xs text-[#4A3828] hover:bg-[#F3EAD5] hover:text-[#1E4334] transition-all"
                    >
                      {domain}
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 1: 📺 动漫原片 */}
      {(activeTab === 'all' || activeTab === 'anime') && animeLinks.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-pixel text-[#1E4334] font-bold mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span>📺</span>
              <span>动漫原片全集</span>
            </span>
            <span className="text-[11px] font-retro-jp text-[#7A6958]">
              点击直接复制提取码并跳转
            </span>
          </div>
          {renderResourceGrid(animeLinks)}
        </div>
      )}

      {/* SECTION 2: 🎬 二创素材 (Cut & MMD) */}
      {(activeTab === 'all' || activeTab === 'creative') && creativeLinks.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-pixel text-[#1E4334] font-bold mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span>🎬</span>
              <span>二创素材 ( Cut 剪辑与 MMD 模型包 )</span>
            </span>
            <span className="text-[11px] font-retro-jp text-[#7A6958]">
              点击直接复制提取码并跳转
            </span>
          </div>
          {renderResourceGrid(creativeLinks)}
        </div>
      )}

      {/* SECTION 3: 📖 漫画与原画资料 */}
      {(activeTab === 'all' || activeTab === 'manga') && mangaLinks.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-pixel text-[#1E4334] font-bold mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span>📖</span>
              <span>漫画全集、手稿与资料</span>
            </span>
            <span className="text-[11px] font-retro-jp text-[#7A6958]">
              点击直接复制提取码并跳转
            </span>
          </div>
          {renderResourceGrid(mangaLinks)}
        </div>
      )}

      {/* PIXIV JUMP WALL */}
      {(activeTab === 'all' || activeTab === 'pixiv') && (
        <div className="mb-4 bg-[#FFFEEF] border border-[#D5C9AF] rounded-sm p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-[#E8E1CE]">
            <div className="flex items-center gap-2">
              <span className="font-pixel text-xs text-[#1E4334] font-bold">
                🎨 PIXIV 关注画师跳转墙 ({filteredArtists.length} 位)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={pixivSearch}
                onChange={(e) => setPixivSearch(e.target.value)}
                placeholder="搜索画师名称..."
                className="px-2 py-1 text-xs font-retro-jp bg-[#FAF5E8] border border-[#D5C9AF] rounded-xs focus:outline-none w-32 sm:w-40"
              />
              <button
                onClick={handleSelectAllPixiv}
                className="px-2 py-1 bg-[#EAE2CE] hover:bg-[#DDD3BD] text-[#4A3828] text-xs font-retro-jp rounded-xs border border-[#C5B495] cursor-pointer"
              >
                全选
              </button>
              <button
                onClick={handleOpenSelected}
                className="px-2.5 py-1 bg-[#1E4334] hover:bg-[#2A5C47] text-[#F9E79F] text-xs font-pixel rounded-xs cursor-pointer shadow-xs"
              >
                批量打开 ({selectedArtists.size})
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-80 overflow-y-auto pr-1">
            {filteredArtists.map((artist) => {
              const key = artist.id || artist.url;
              const isSelected = selectedArtists.has(key);
              const isVisited = visitedArtists.has(key);
              const idx = hashCode(artist.name) % PALETTE.length;
              const [bg, border] = PALETTE[idx];

              return (
                <div
                  key={key}
                  onClick={() => handleToggleArtist(key)}
                  style={{
                    backgroundColor: isSelected ? '#1E4334' : bg,
                    borderColor: isSelected ? '#1E4334' : border,
                    color: isSelected ? '#F9E79F' : '#2C241D',
                  }}
                  className={`px-2 py-1 text-xs font-retro-jp rounded-xs border cursor-pointer transition-all flex items-center gap-1 select-none ${
                    isVisited ? 'opacity-60 grayscale-[30%]' : ''
                  }`}
                >
                  <span className="text-[10px]">{isSelected ? '✓' : isVisited ? '👁️' : '✦'}</span>
                  <span>{artist.name}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-2 text-right">
            <button
              onClick={handleResetDonePixiv}
              className="text-[11px] font-retro-jp text-[#8C7A68] hover:underline cursor-pointer"
            >
              重置画师已读标记
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
