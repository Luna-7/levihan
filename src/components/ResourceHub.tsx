import React, { useState, useEffect } from 'react';
import { ResourceLink, PixivArtist } from '../types';
import { RESOURCE_LINKS, PIXIV_ARTISTS_DATA } from '../data/initialData';
import { soundManager } from '../utils/audio';
import { AuNovelReader } from './AuNovelReader';

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
  const [activeTab, setActiveTab] = useState<'anime' | 'creative' | 'manga' | 'au-novel' | 'ao3' | 'pixiv' | 'doujin'>('anime');
  const [visitedArtists, setVisitedArtists] = useState<Set<string>>(new Set());
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

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

  // 点击卡片：直接在新标签页打开该画师的 Pixiv 主页
  const handleOpenArtist = (artist: PixivArtist) => {
    soundManager.playBlip();
    const key = artist.id || artist.url;
    const nextVisited = new Set<string>(visitedArtists);
    nextVisited.add(key);
    saveVisited(nextVisited);
    window.open(artist.url, '_blank', 'noopener,noreferrer');
  };

  const handleResetDonePixiv = () => {
    soundManager.playBlip();
    saveVisited(new Set<string>());
    onShowToast('已重置所有已读标记 👁️');
  };

  const animeLinks = RESOURCE_LINKS.filter((r) => r.category === 'anime');
  const creativeLinks = RESOURCE_LINKS.filter((r) => r.category === 'creative');
  const cutLinks = creativeLinks.filter((item) => item.title.toLowerCase().includes('cut'));
  const mmdLinks = creativeLinks.filter((item) => item.title.toLowerCase().includes('mmd') || item.title.includes('模型'));
  const mangaLinks = RESOURCE_LINKS.filter((r) => r.category === 'manga' || r.category === 'link');

  const renderResourceGrid = (links: ResourceLink[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
      {links.map((item) => (
        <div
          key={item.id}
          onClick={() => handleAutoJump(item.url, item.code)}
          className="relative bg-[#FFFDF5] border-2 border-[#1E4334] rounded-none p-3 flex flex-col justify-between cursor-pointer transition-all duration-75 shadow-none hover:bg-[#F9F5EA] hover:border-[#2A5C47] active:scale-[0.98] active:translate-y-0.5 active:bg-[#F0E8D5] group select-none"
          title="点击即可自动复制提取码并打开网盘"
        >
          {/* Pixel Corner Screws */}
          <span className="absolute top-1 left-1 w-1.5 h-1.5 bg-[#1E4334]/20 pointer-events-none" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[#1E4334]/20 pointer-events-none" />
          <span className="absolute bottom-1 left-1 w-1.5 h-1.5 bg-[#1E4334]/20 pointer-events-none" />
          <span className="absolute bottom-1 right-1 w-1.5 h-1.5 bg-[#1E4334]/20 pointer-events-none" />

          <div>
            {/* Top Badges */}
            <div className="flex items-center justify-between gap-2 mb-2">
              <span
                className={`text-[11px] px-2 py-0.5 rounded-none font-pixel font-bold border-2 ${
                  item.platform === '百度网盘'
                    ? 'bg-[#EBF5FB] text-[#1A5276] border-[#2980B9]'
                    : item.platform === '夸克网盘'
                    ? 'bg-[#FEF9E7] text-[#7D6608] border-[#B7950B]'
                    : 'bg-[#FADBD8] text-[#78281F] border-[#C0392B]'
                }`}
              >
                {item.platform}
              </span>

              {item.code ? (
                <span className="font-pixel text-[11px] text-[#7D6608] bg-[#FEF9E7] border-2 border-[#B7950B] px-2 py-0.5 rounded-none font-bold flex items-center gap-1 shadow-none">
                  <span>📋 提取码</span>
                  <span>{item.code}</span>
                </span>
              ) : (
                <span className="font-pixel text-[11px] text-[#1E8449] bg-[#E8F8F5] border-2 border-[#27AE60] px-2 py-0.5 rounded-none font-bold">
                  免提取码
                </span>
              )}
            </div>

            {/* Title */}
            <h3 className="font-bold font-retro-jp text-xs sm:text-sm text-[#2D2319] group-hover:text-[#1E4334] leading-relaxed break-words">
              {item.title}
            </h3>
          </div>

          {/* Action Hint */}
          <div className="mt-2.5 pt-1.5 border-t-2 border-dashed border-[#1E4334]/20 flex items-center justify-between text-[11px] font-pixel text-[#7A6958] group-hover:text-[#1E4334]">
            <span className="flex items-center gap-1">
              <span>🚀</span>
              <span>点击跳转网盘</span>
            </span>
            <span className="font-bold group-hover:translate-x-0.5 transition-transform">↗</span>
          </div>
        </div>
      ))}
    </div>
  );

  const tabsList = [
    { key: 'anime', label: '📺 动漫原片全集' },
    { key: 'creative', label: '🎬 二创剪辑/MMD素材' },
    { key: 'manga', label: '📖 漫画全集/手稿资料' },
    { key: 'au-novel', label: '📜 官方AU小说阅读' },
    { key: 'ao3', label: '🌐 AO3官方与镜像速查' },
    { key: 'pixiv', label: '🎨 PIXIV画师跳转墙' },
  ];

  return (
    <div className="relative bg-transparent p-0 sm:p-1 my-0 text-[#2C241D]">
      {/* 像素风主题自定义下拉导航控制栏 */}
      <div className="mb-4 pb-2 border-b-2 border-dashed border-[#1E4334]/25 bg-[#EAE2CE]/40 p-1.5 border-2 border-[#1E4334]">
        <div className="relative w-full max-w-sm">
          {/* 下拉菜单触发按钮 */}
          <button
            type="button"
            onClick={() => {
              soundManager.playBlip();
              setIsDropdownOpen(!isDropdownOpen);
            }}
            className="w-full bg-[#FFFDF5] text-[#1E4334] border-2 border-[#1E4334] font-pixel text-xs sm:text-sm py-2 px-3 rounded-none cursor-pointer flex items-center justify-between transition-all duration-75 hover:bg-[#FAF5E8] active:scale-[0.98] active:translate-y-0.5 focus:outline-none font-bold select-none"
          >
            <div className="flex items-center gap-2 truncate">
              <span className="text-[#B7791F]">▶</span>
              <span className="truncate">
                {tabsList.find((t) => t.key === activeTab)?.label || '选择分类'}
              </span>
            </div>
            <span className="text-[#1E4334] text-xs font-bold shrink-0 ml-2">
              {isDropdownOpen ? '▲' : '▼'}
            </span>
          </button>

          {/* 自定义复古像素主题下拉弹窗 */}
          {isDropdownOpen && (
            <>
              {/* 点击外部遮罩关闭 */}
              <div
                className="fixed inset-0 z-20"
                onClick={() => setIsDropdownOpen(false)}
              />
              <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-[#FFFDF5] border-2 border-[#1E4334] rounded-none shadow-[3px_3px_0px_#10241B] max-h-80 overflow-y-auto">
                {tabsList.map((t) => {
                  const isActive = activeTab === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => {
                        soundManager.playBlip();
                        setActiveTab(t.key as typeof activeTab);
                        setIsDropdownOpen(false);
                      }}
                      className={`w-full text-left py-2 px-3 border-b border-dashed border-[#1E4334]/20 transition-all duration-75 flex items-center justify-between cursor-pointer select-none active:scale-[0.98] ${
                        isActive
                          ? 'bg-[#1E4334] text-[#F9E79F] font-bold'
                          : 'bg-[#FFFDF5] text-[#2C241D] hover:bg-[#F3EAD5] hover:text-[#1E4334]'
                      }`}
                    >
                      <span className="font-pixel text-xs sm:text-sm tracking-wide truncate">
                        {t.label}
                      </span>
                      {isActive && (
                        <span className="font-pixel text-xs text-[#F9E79F] shrink-0 ml-2">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 📜 官方AU小说专区 */}
      {(activeTab === 'au-novel') && (
        <div className="mb-6">
          <AuNovelReader onShowToast={onShowToast} />
        </div>
      )}

      {/* AO3 SECTION (平面卡片) */}
      {(activeTab === 'ao3') && (
        <div className="mb-4 bg-[#FFFDF5] border-2 border-[#1E4334] rounded-none p-3.5 shadow-none">
          <div className="flex items-center gap-2 text-xs font-pixel text-[#1E4334] font-bold mb-2.5 pb-2 border-b-2 border-dashed border-[#1E4334]/20">
            <span>🌐</span>
            <span>AO3 访问 / 镜像速查</span>
          </div>

          <div className="p-2.5 bg-[#FBEDE9] border-2 border-[#C0392B] rounded-none text-xs font-retro-jp text-[#900C3F] mb-3 leading-relaxed shadow-none">
            ⚠️ <b>OTW 官方提醒</b>：官网以外的镜像站都是第三方运营，在镜像站登录可能泄露账号密码。官方主站永远只认 <b>archiveofourown.org</b>。
          </div>

          <div className="space-y-3 text-xs font-retro-jp">
            <div className="flex items-center justify-between gap-1.5 sm:gap-3 p-2.5 bg-[#EAF2EE] border-2 border-[#1E4334] rounded-none text-[11px] sm:text-xs font-retro-jp w-full shadow-none">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-bold text-[#1E4334] shrink-0 font-pixel">★ 官方主站入口</span>
                <span className="text-[10px] sm:text-[11px] text-[#7A6958] hidden xs:inline truncate">(最安全，部分网络需代理)</span>
              </div>
              <a
                href="https://archiveofourown.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#1E4334] text-[#F9E79F] font-pixel text-[10px] sm:text-xs rounded-none border-2 border-[#10241B] hover:bg-[#2A5C47] transition-all shadow-none shrink-0 font-bold"
              >
                <span>archiveofourown.org ↗</span>
              </a>
            </div>

            <div>
              <span className="font-bold text-[#5B4636] font-pixel block mb-1.5">官方安全备用域名:</span>
              <div className="flex flex-wrap gap-2">
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
                      className="px-2.5 py-1 bg-[#FAF5E8] border-2 border-[#1E4334] rounded-none text-[#4A3828] font-pixel text-[11px] shadow-none hover:bg-[#F3EAD5] hover:text-[#1E4334] transition-all"
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
      {(activeTab === 'anime') && animeLinks.length > 0 && (
        <div className="mb-4">
          <div className="text-xs sm:text-sm font-pixel text-[#1E4334] font-bold mb-3 flex items-center justify-between border-b-2 border-dashed border-[#1E4334]/25 pb-2">
            <span className="flex items-center gap-1.5">
              <span>📺</span>
              <span>动漫原片全集</span>
            </span>
          </div>
          {renderResourceGrid(animeLinks)}
        </div>
      )}

      {/* SECTION 2: 🎬 二创素材 (Cut & MMD Split) */}
      {(activeTab === 'creative') && creativeLinks.length > 0 && (
        <div className="space-y-6">
          {cutLinks.length > 0 && (
            <div>
              <div className="text-xs sm:text-sm font-pixel text-[#1E4334] font-bold mb-3 flex items-center justify-between border-b-2 border-dashed border-[#1E4334]/25 pb-2">
                <span className="flex items-center gap-1.5">
                  <span>🎬</span>
                  <span>Cut 剪辑素材</span>
                </span>
              </div>
              {renderResourceGrid(cutLinks)}
            </div>
          )}

          {mmdLinks.length > 0 && (
            <div>
              <div className="text-xs sm:text-sm font-pixel text-[#1E4334] font-bold mb-3 flex items-center justify-between border-b-2 border-dashed border-[#1E4334]/25 pb-2">
                <span className="flex items-center gap-1.5">
                  <span>📦</span>
                  <span>MMD 模型包</span>
                </span>
              </div>
              {renderResourceGrid(mmdLinks)}
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: 📖 漫画与原画资料 */}
      {(activeTab === 'manga') && mangaLinks.length > 0 && (
        <div className="mb-4">
          <div className="text-xs sm:text-sm font-pixel text-[#1E4334] font-bold mb-3 flex items-center justify-between border-b-2 border-dashed border-[#1E4334]/25 pb-2">
            <span className="flex items-center gap-1.5">
              <span>📖</span>
              <span>漫画全集、手稿与资料</span>
            </span>
          </div>
          {renderResourceGrid(mangaLinks)}
        </div>
      )}

      {/* PIXIV JUMP WALL (平面卡片) */}
      {(activeTab === 'pixiv') && (
        <div className="mb-4 bg-[#FFFDF5] border-2 border-[#1E4334] rounded-none p-3.5 shadow-none">
          <div className="pb-2.5 mb-3 border-b-2 border-dashed border-[#1E4334]/25 space-y-2">
            {/* Title */}
            <div className="flex items-center justify-between gap-2">
              <span className="font-pixel text-xs sm:text-sm text-[#1E4334] font-bold">
                🎨 PIXIV画师跳转墙
              </span>
            </div>

            {/* 已读记录操作 */}
            <div className="flex justify-end">
              <button
                onClick={handleResetDonePixiv}
                className="py-1 px-3 bg-[#FAF5E8] hover:bg-[#EAE2CE] text-[#1E4334] border-2 border-[#1E4334] text-xs font-pixel rounded-none shadow-none transition-all text-center flex items-center justify-center gap-1 cursor-pointer select-none"
              >
                <span>👁️</span> 重置已读
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 max-h-96 overflow-y-auto pr-1">
            {PIXIV_ARTISTS_DATA.map((artist) => {
              const key = artist.id || artist.url;
              const isVisited = visitedArtists.has(key);
              const idx = hashCode(artist.name) % PALETTE.length;
              const [bg, border] = PALETTE[idx];

              return (
                <div
                  key={key}
                  onClick={() => handleOpenArtist(artist)}
                  style={{ backgroundColor: bg, borderColor: border, color: '#2C241D' }}
                  className={`px-2.5 py-1 text-xs font-retro-jp rounded-none border-2 border-[#1E4334] shadow-none hover:bg-[#F3EAD5] cursor-pointer transition-all flex items-center gap-1.5 select-none ${
                    isVisited ? 'opacity-60 grayscale-[30%]' : ''
                  }`}
                  title={`点击直接在新标签打开 ${artist.name} 的 Pixiv 主页 ↗`}
                >
                  <span className="text-[10px]">{isVisited ? '👁️' : '✦'}</span>
                  <span className="font-medium">{artist.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
