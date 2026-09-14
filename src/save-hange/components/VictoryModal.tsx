import React, { useEffect, useState } from 'react';
import planeBg from '../assets/images/plane_sunset_1789352611027.jpg';
import mangaPage1 from '../assets/images/manga_rescue_1.jpg';
import mangaPage2 from '../assets/images/manga_rescue_2.jpg';
import { soundManager } from '../audio/soundManager';
import { X, ChevronLeft, ChevronRight, Sparkles, BookOpen, ArrowRight } from 'lucide-react';

interface VictoryModalProps {
  timeUsedSeconds: number;
  moves: number;
  onRestart: () => void;
  onClose?: () => void;
}

/**
 * 利威尔胜利台词池
 */
export const LEVI_QUOTES = [
  '“啧，总算把你送上飞机了。……做得好，韩吉。”',
  '“献出心脏——这是调查兵团式的告别，也是最高的致敬。”',
  '“剩下的路，连同你那一份，一起走完。”',
  '“别回头。前方是自由之翼要去的方向。”',
];

// 漫画画卷数据
const MANGA_PAGES = [
  {
    src: mangaPage1,
    title: '第一幕：断后的告白',
    sub: '地鸣的兽群汹涌而至，韩吉独自留下断后，为同伴们争取登上飞机的时间。',
  },
  {
    src: mangaPage2,
    title: '第二幕：目送与启程',
    sub: '飞机升空，利威尔将徽章握进手心。那道身影化作光，目送众人飞向自由。',
  },
];

interface FireworkParticle {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  color: string;
  size: number;
}

export const VictoryModal: React.FC<VictoryModalProps> = ({
  timeUsedSeconds,
  moves,
  onRestart,
  onClose,
}) => {
  // 阶段状态：'manga' 先浮动展示史诗漫画剧情，'card' 随后升华跳出通关胜利结算卡片
  const [stage, setStage] = useState<'manga' | 'card'>('manga');
  const [quote, setQuote] = useState<string>('');
  const [currentMangaIndex, setCurrentMangaIndex] = useState<number>(0);
  const [particles, setParticles] = useState<FireworkParticle[]>([]);

  // 阶段一启动：播放震撼深情的漫画揭晓音效（心跳重音 + 救赎和弦 + 蒸汽泄压）
  useEffect(() => {
    soundManager.playMangaSwellSound();

    const randomQuote = LEVI_QUOTES[Math.floor(Math.random() * LEVI_QUOTES.length)];
    setQuote(randomQuote);

    // 生成像素烟花粒子
    const colors = ['#34d399', '#4ade80', '#facc15', '#fbbf24', '#60a5fa', '#f43f5e', '#a855f7'];
    const newParticles: FireworkParticle[] = [];

    const centers = [
      { x: 15, y: 25 },
      { x: 85, y: 20 },
      { x: 50, y: 15 },
      { x: 25, y: 75 },
      { x: 75, y: 70 },
    ];

    let pid = 0;
    centers.forEach((center) => {
      const burstColor = colors[Math.floor(Math.random() * colors.length)];
      for (let i = 0; i < 14; i++) {
        const angle = (Math.PI * 2 * i) / 14;
        const speed = 1.0 + Math.random() * 2.2;
        newParticles.push({
          id: pid++,
          x: center.x,
          y: center.y,
          dx: Math.cos(angle) * speed,
          dy: Math.sin(angle) * speed,
          color: Math.random() > 0.3 ? burstColor : '#fef08a',
          size: Math.floor(Math.random() * 4) + 3,
        });
      }
    });

    setParticles(newParticles);
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  const nextManga = () => {
    soundManager.playPageTurnSound();
    setCurrentMangaIndex((prev) => (prev + 1) % MANGA_PAGES.length);
  };

  const prevManga = () => {
    soundManager.playPageTurnSound();
    setCurrentMangaIndex((prev) => (prev - 1 + MANGA_PAGES.length) % MANGA_PAGES.length);
  };

  // 从漫画剧情切入胜利结算卡片，并播放胜利号角与烟花
  const handleProceedToCard = () => {
    soundManager.playVictorySound();
    setStage('card');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/85 backdrop-blur-md animate-fadeIn overflow-y-auto">
      {/* 像素烟花背景粒子 */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {particles.map((p) => (
          <div
            key={p.id}
            className="absolute animate-pixelFirework"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              backgroundColor: p.color,
              boxShadow: `0 0 6px ${p.color}, 0 0 12px ${p.color}`,
              transform: `translate(${p.dx * 26}px, ${p.dy * 26}px)`,
              transition: 'transform 1.2s cubic-bezier(0.1, 0.8, 0.3, 1), opacity 1.2s ease-out',
            }}
          />
        ))}
      </div>

      {/* 
        阶段一：【先浮动浮现漫画剧情画卷】
        带轻柔浮动(animate-gentleFloat)、电影感黑金光晕与深刻的再会剧情
      */}
      {stage === 'manga' && (
        <div className="relative z-10 w-full max-w-[430px] bg-[#0c1611]/95 border-3 border-[#214332] rounded-2xl shadow-[0_0_60px_rgba(0,0,0,0.95),0_0_30px_rgba(52,211,153,0.3)] p-4 sm:p-5 text-[#f0fdf4] animate-floatMangaIn overflow-hidden my-auto">
          {/* 夕阳救赎飞机背景微光 */}
          <div
            className="absolute inset-0 bg-cover bg-center filter brightness-[0.25] contrast-110 saturate-90 pointer-events-none opacity-40"
            style={{ backgroundImage: `url(${planeBg})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#09150e]/95 via-[#0c1a13]/85 to-[#050c08]/95 pointer-events-none" />

          {/* 右上角关闭按钮 */}
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-3 right-3 z-20 w-6 h-6 flex items-center justify-center rounded-full bg-[#0a1610]/80 border border-[#274b39] text-[#86efac] hover:text-white hover:bg-[#1a3828] transition-colors cursor-pointer"
              title="关闭预览"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* 剧情顶栏徽章 */}
          <div className="relative z-10 flex items-center justify-between mb-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-[#173827] border border-[#2e6347] text-[#34d399] font-mono text-[10px] sm:text-xs font-black tracking-wider uppercase rounded-full shadow-inner">
              <Sparkles className="w-3 h-3 text-[#facc15] animate-pulse" />
              SPECIAL EPILOGUE • 特别救赎篇章
            </span>
            <span className="text-[10px] font-mono text-[#86efac] px-2 py-0.5 bg-black/60 rounded border border-[#204030]">
              {currentMangaIndex + 1} / {MANGA_PAGES.length}
            </span>
          </div>

          {/* 漫画大图交互展示区（伴随微弱浮动感） */}
          <div className="relative z-10 my-2 bg-black/70 border-2 border-[#2b5941] rounded-xl p-2 shadow-2xl overflow-hidden animate-gentleFloat">
            <div className="relative w-full h-56 sm:h-64 rounded-lg overflow-hidden flex items-center justify-center bg-[#070e0a]">
              <img
                src={MANGA_PAGES[currentMangaIndex].src}
                alt={MANGA_PAGES[currentMangaIndex].title}
                className="w-full h-full object-contain filter contrast-105 brightness-100 transition-all duration-300"
              />

              {/* 左切换 */}
              <button
                onClick={prevManga}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-black/80 hover:bg-[#1e4632] border border-[#34d399]/60 text-white hover:text-[#34d399] transition-all cursor-pointer shadow-lg active:scale-90"
                title="上一页"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              {/* 右切换 */}
              <button
                onClick={nextManga}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-black/80 hover:bg-[#1e4632] border border-[#34d399]/60 text-white hover:text-[#34d399] transition-all cursor-pointer shadow-lg active:scale-90"
                title="下一页"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* 剧情旁白与角色台词 */}
            <div className="mt-2 text-left px-1">
              <div className="flex items-center justify-between">
                <h3 className="text-xs sm:text-sm font-black text-[#86efac] font-mono">
                  {MANGA_PAGES[currentMangaIndex].title}
                </h3>
                <span className="text-[9px] text-[#64748b]">图源网络，侵删</span>
              </div>
              <p className="text-[11px] text-[#e2e8f0] font-serif leading-relaxed mt-0.5 italic">
                {MANGA_PAGES[currentMangaIndex].sub}
              </p>
            </div>
          </div>

          {/* 底部进入通关结算按钮 */}
          <button
            id="proceed-to-victory-card-btn"
            onClick={handleProceedToCard}
            className="relative z-10 w-full mt-2 py-3 px-5 bg-[#34d399] hover:bg-[#4ade80] text-[#052014] font-black text-xs sm:text-sm tracking-widest uppercase rounded-xl transition-all duration-150 shadow-[0_4px_16px_rgba(52,211,153,0.4)] active:translate-y-0.5 cursor-pointer font-mono flex items-center justify-center gap-2 group"
          >
            <span>查看战报与利威尔寄语</span>
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </button>
        </div>
      )}

      {/* 
        阶段二：【随后跳出成功卡片】（带轻微像素抖动标题、利威尔说话框、数据统计栏与再救一次）
      */}
      {stage === 'card' && (
        <div className="relative z-10 w-full max-w-[425px] bg-[#111e17]/95 border-3 border-[#1d3b2b] rounded-2xl shadow-[0_0_55px_rgba(0,0,0,0.95),0_0_24px_rgba(52,211,153,0.3)] p-4 sm:p-5 text-center text-[#f0fdf4] animate-slideUp overflow-hidden my-auto">
          {/* 夕阳救赎飞机背景 */}
          <div
            className="absolute inset-0 bg-cover bg-center filter brightness-[0.28] contrast-110 saturate-90 pointer-events-none opacity-40"
            style={{ backgroundImage: `url(${planeBg})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0e1f16]/90 via-[#102219]/80 to-[#07110c]/95 pointer-events-none" />

          {/* 右上角关闭 */}
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-3 right-3 z-20 w-6 h-6 flex items-center justify-center rounded-full bg-[#0a1610]/80 border border-[#274b39] text-[#86efac] hover:text-white hover:bg-[#1a3828] transition-colors cursor-pointer"
              title="关闭预览"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* 顶部标题区 */}
          <div className="relative z-10 flex flex-col items-center mb-2.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-[#173324]/90 border border-[#2d5c44] text-[#34d399] font-mono text-[10px] sm:text-xs font-black tracking-widest uppercase rounded-full mb-1.5 shadow-inner">
              <span className="w-1.5 h-1.5 rounded-full bg-[#34d399] animate-ping" />
              ★ MISSION CLEAR • 突围成功 ★
            </div>

            <h2 className="text-xl sm:text-2xl font-black tracking-wider text-[#34d399] uppercase font-mono drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] animate-pixelShake inline-block">
              突围成功！
            </h2>
            <p className="text-[11px] font-bold tracking-wide text-[#a7f3d0] mt-0.5">
              韩吉已成功登机，地鸣的追击被留在了身后！
            </p>
          </div>

          {/* 漫画缩略回放条（支持点击返回全景漫画或手动切换） */}
          <div className="relative z-10 my-2 bg-[#09130d]/90 border border-[#254a37] rounded-xl p-2 shadow-inner overflow-hidden flex flex-col items-center">
            <div className="relative w-full h-36 sm:h-40 bg-black/60 rounded-lg overflow-hidden flex items-center justify-center border border-[#1b3829]">
              <img
                src={MANGA_PAGES[currentMangaIndex].src}
                alt={MANGA_PAGES[currentMangaIndex].title}
                className="w-full h-full object-contain filter contrast-105 brightness-95 transition-all duration-300"
              />

              <button
                onClick={prevManga}
                className="absolute left-1.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-black/75 hover:bg-[#1a3828] border border-[#2e5d43] text-white hover:text-[#34d399] transition-all cursor-pointer shadow-lg active:scale-90"
                title="上一页"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={nextManga}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-black/75 hover:bg-[#1a3828] border border-[#2e5d43] text-white hover:text-[#34d399] transition-all cursor-pointer shadow-lg active:scale-90"
                title="下一页"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              {/* 回顾画卷全景快捷键 */}
              <button
                onClick={() => setStage('manga')}
                className="absolute top-1.5 left-1.5 px-2 py-0.5 bg-black/80 hover:bg-[#183827] rounded text-[9px] font-mono text-[#86efac] border border-[#2e5d43] flex items-center gap-1 cursor-pointer transition-colors"
                title="重温救赎画卷"
              >
                <BookOpen className="w-2.5 h-2.5 text-[#34d399]" />
                <span>重温漫画</span>
              </button>

              <div className="absolute bottom-1 right-2 px-1.5 py-0.5 bg-black/80 rounded text-[9px] font-mono text-[#86efac] border border-[#264b38]">
                {currentMangaIndex + 1} / {MANGA_PAGES.length}
              </div>
            </div>

            <div className="w-full flex items-center justify-between mt-1 px-1 text-[9px] text-[#94a3b8]">
              <span className="font-bold text-[#cbd5e1]">
                {MANGA_PAGES[currentMangaIndex].title}
              </span>
              <span className="text-[8.5px] text-[#64748b]">图源网络，侵删</span>
            </div>
          </div>

          {/* 利威尔说话气泡框 */}
          <div className="relative z-10 my-2 p-2.5 sm:p-3 bg-[#13251c]/90 border border-[#2b5941] rounded-lg text-left shadow-md backdrop-blur-sm">
            <div className="flex items-start gap-2">
              <span className="text-sm">💬</span>
              <div className="flex-1">
                <span className="text-[11px] font-black text-[#fef08a] block mb-0.5 tracking-wide font-mono">
                  利威尔·阿克曼：
                </span>
                <p className="text-xs font-serif font-bold text-[#f0fdf4] leading-relaxed italic">
                  {quote}
                </p>
              </div>
            </div>
          </div>

          {/* 数据统计栏 */}
          <div className="relative z-10 grid grid-cols-2 gap-2 my-2 bg-[#0a150f]/80 p-2 border border-[#203e2e] rounded-lg">
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-bold text-[#86efac] uppercase tracking-wider">
                消耗时间
              </span>
              <span className="text-base sm:text-lg font-mono font-black text-[#facc15]">
                {formatTime(timeUsedSeconds)}
              </span>
            </div>
            <div className="flex flex-col items-center border-l border-[#203e2e]">
              <span className="text-[10px] font-bold text-[#86efac] uppercase tracking-wider">
                总步数
              </span>
              <span className="text-base sm:text-lg font-mono font-black text-white">
                {moves} 步
              </span>
            </div>
          </div>

          {/* 操作按钮：再救一次 */}
          <button
            id="victory-restart-btn"
            onClick={onRestart}
            className="relative z-10 w-full mt-1.5 py-2.5 px-5 bg-[#34d399] hover:bg-[#4ade80] text-[#052014] font-black text-xs sm:text-sm tracking-widest uppercase rounded-lg transition-all duration-150 shadow-[0_3px_12px_rgba(52,211,153,0.35)] active:translate-y-0.5 cursor-pointer font-mono"
          >
            再救一次
          </button>
        </div>
      )}
    </div>
  );
};
export default VictoryModal;
