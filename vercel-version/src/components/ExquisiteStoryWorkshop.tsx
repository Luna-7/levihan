import React, { useState, useEffect, useRef } from 'react';
import { Feather, BookOpen, Sparkles, RefreshCw, Copy, Check, ArrowLeft, Users, Dice5, History, Send, Trash2 } from 'lucide-react';
import { soundManager } from '../utils/audio';
import { CardPatternOverlay } from './CardPatternOverlay';

interface Props {
  onBack?: () => void;
  onShowToast: (msg: string) => void;
}

interface SavedStory {
  id: string;
  title: string;
  prompt: string;
  sentences: { text: string; author: string }[];
  fullText: string;
  authors: string[];
  createdAt: string;
}

const PROMPT_CHARACTERS = ['利威尔', '韩吉', '艾尔文', '萨沙', '让', '阿尔敏', '三笠', '莫布利特'];
const PROMPT_LOCATIONS = ['巨树森林深处', '调查兵团旧本部地下室', '玛利亚之墙顶端日落时', '兵长专用茶室', '暴雨夜的特训营地', '特罗斯特区旧书肆', '雪山补给哨所'];
const PROMPT_ITEMS = ['一罐特调红茶罐', '一本泛黄的巨人实验手稿', '一副备用护目镜', '一个热气腾腾的烤土豆', '一枚磨损的自由之翼徽章', '一封未寄出的密信'];
const PROMPT_EVENTS = ['突发暴雨被困在木屋里', '不小心打翻了实验溶剂', '发现了一张神秘的壁外藏宝地图', '被要求一起整理一整间档案室', '深夜在屋顶偶遇看星空'];

const INITIAL_STORIES: SavedStory[] = [
  {
    id: 'story-1',
    title: '雨夜茶室奇遇',
    prompt: '【利威尔】在【兵长专用茶室】发现了【一罐特调红茶罐】',
    sentences: [
      { author: '作者 1', text: '窗外雷声大作，利威尔蹙着眉将刚泡好的红茶端至桌前。' },
      { author: '作者 2', text: '门突然被猛地撞开，浑身湿透的韩吉眼镜上全是一层白雾，手里还攥着刚采集的样本。' },
      { author: '作者 3', text: '“喂，四眼，先把水擦干净再踏进我的地板。”利威尔递过去一条干毛巾，语气虽冷淡却顺手推过了一杯热茶。' },
      { author: '作者 4', text: '韩吉咧嘴笑了起来，接过茶杯时两人的指尖在微烫的瓷杯上轻触，雨声似乎在这一刻变得格外温柔。' },
    ],
    fullText: '窗外雷声大作，利威尔蹙着眉将刚泡好的红茶端至桌前。 门突然被猛地撞开，浑身湿透的韩吉眼镜上全是一层白雾，手里还攥着刚采集的样本。 “喂，四眼，先把水擦干净再踏进我的地板。”利威尔递过去一条干毛巾，语气虽冷淡却顺手推过了一杯热茶。 韩吉咧嘴笑了起来，接过茶杯时两人的指尖在微烫的瓷杯上轻触，雨声似乎在这一刻变得格外温柔。',
    authors: ['利威尔的小茶杯', '韩吉的护目镜', '壁外调查员', '驻屯兵团老兵'],
    createdAt: '2026-09-17 14:30',
  },
];

export const ExquisiteStoryWorkshop: React.FC<Props> = ({ onBack, onShowToast }) => {
  const [activeTab, setActiveTab] = useState<'game' | 'prompts' | 'history'>('game');

  // Game Setup State
  const [playerCount, setPlayerCount] = useState<number>(3);
  const [playerNames, setPlayerNames] = useState<string[]>(['调查兵 A', '调查兵 B', '调查兵 C']);
  const [currentPrompt, setCurrentPrompt] = useState<string>('【利威尔】与【韩吉】在【巨树森林深处】遇到了【一本泛黄的巨人实验手稿】');
  const [gameStarted, setGameStarted] = useState<boolean>(false);

  // Gameplay State
  const [currentTurn, setCurrentTurn] = useState<number>(0);
  const [sentences, setSentences] = useState<{ text: string; author: string }[]>([]);
  const [currentInput, setCurrentInput] = useState<string>('');
  const [isRevealed, setIsRevealed] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Saved History
  const [savedStories, setSavedStories] = useState<SavedStory[]>(() => {
    try {
      const cached = localStorage.getItem('exquisite_stories');
      return cached ? JSON.parse(cached) : INITIAL_STORIES;
    } catch {
      return INITIAL_STORIES;
    }
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync player name inputs when player count changes
  useEffect(() => {
    setPlayerNames((prev) => {
      const next = [...prev];
      while (next.length < playerCount) {
        next.push(`调查兵 ${String.fromCharCode(65 + next.length)}`);
      }
      return next.slice(0, playerCount);
    });
  }, [playerCount]);

  const generateRandomPrompt = () => {
    soundManager.playWoodTap();
    const char1 = PROMPT_CHARACTERS[Math.floor(Math.random() * PROMPT_CHARACTERS.length)];
    const char2 = PROMPT_CHARACTERS[Math.floor(Math.random() * PROMPT_CHARACTERS.length)];
    const loc = PROMPT_LOCATIONS[Math.floor(Math.random() * PROMPT_LOCATIONS.length)];
    const item = PROMPT_ITEMS[Math.floor(Math.random() * PROMPT_ITEMS.length)];
    const evt = PROMPT_EVENTS[Math.floor(Math.random() * PROMPT_EVENTS.length)];
    
    const p = char1 === char2
      ? `【${char1}】在【${loc}】带着【${item}】，准备【${evt}】。`
      : `【${char1}】与【${char2}】在【${loc}】围绕【${item}】，因为【${evt}】。`;
    setCurrentPrompt(p);
  };

  const handleStartGame = () => {
    soundManager.playScrollOpen();
    setSentences([]);
    setCurrentTurn(0);
    setCurrentInput('');
    setIsRevealed(false);
    setGameStarted(true);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 150);
  };

  const handleNextTurn = () => {
    if (!currentInput.trim()) {
      onShowToast('请输入这一棒的故事内容再传递给下一位！✍️');
      return;
    }

    soundManager.playPageTurn();
    const author = playerNames[currentTurn] || `接棒者 ${currentTurn + 1}`;
    const newSentences = [...sentences, { text: currentInput.trim(), author }];
    setSentences(newSentences);
    setCurrentInput('');

    if (currentTurn + 1 >= playerCount) {
      // Completed! Reveal full story
      setIsRevealed(true);
      soundManager.playFanfare();
      // Auto save
      const fullText = newSentences.map((s) => s.text).join(' ');
      const newStory: SavedStory = {
        id: `story-${Date.now()}`,
        title: `接龙篇章 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
        prompt: currentPrompt,
        sentences: newSentences,
        fullText,
        authors: playerNames.slice(0, playerCount),
        createdAt: new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      };
      const updated = [newStory, ...savedStories];
      setSavedStories(updated);
      try {
        localStorage.setItem('exquisite_stories', JSON.stringify(updated));
      } catch {}
      onShowToast('🎉 故事接龙圆满成篇！已揭开完整羊皮纸手稿！');
    } else {
      setCurrentTurn(currentTurn + 1);
      onShowToast(`已封存上一棒！请【${playerNames[currentTurn + 1]}】接棒撰写 📜`);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  };

  const handleCopyStory = (text: string) => {
    soundManager.playCopySuccess();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          setCopied(true);
          onShowToast('已将完整接龙手稿复制到剪贴板！📋');
          setTimeout(() => setCopied(false), 2000);
        },
        () => onShowToast('复制失败，请手动长按复制')
      );
    }
  };

  const handleDeleteSaved = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    soundManager.playWoodTap();
    const updated = savedStories.filter((s) => s.id !== id);
    setSavedStories(updated);
    try {
      localStorage.setItem('exquisite_stories', JSON.stringify(updated));
    } catch {}
    onShowToast('已移除该篇手稿记录');
  };

  return (
    <div className="w-full h-full min-h-0 flex flex-col bg-[#FAF6ED] text-[#16273B] select-none overflow-hidden relative">
      {/* 顶部标题栏 */}
      <header className="shrink-0 w-full px-3 py-2 bg-[#FAF5EA]/95 border-b border-[#E5DACE] flex items-center justify-between z-20">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={() => {
                soundManager.playWoodTap();
                onBack();
              }}
              className="p-1 rounded-lg hover:bg-[#EBE2D3] transition-colors text-[#544331] cursor-pointer"
              title="返回驻地"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-base">📜</span>
            <div>
              <h1 className="font-serif-title text-sm sm:text-base font-black text-[#16273B] leading-none">
                故事工坊
              </h1>
              <p className="text-[10px] text-[#8C6226] font-medium leading-none mt-0.5">
                Exquisite Corpse · 同人接龙撰文
              </p>
            </div>
          </div>
        </div>

        {/* 顶部三态切换按键 */}
        <div className="flex items-center bg-[#EADBBA]/60 p-0.5 rounded-lg border border-[#D5C19A]">
          <button
            type="button"
            onClick={() => {
              soundManager.playWoodTap();
              setActiveTab('game');
            }}
            className={`px-2 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
              activeTab === 'game'
                ? 'bg-[#16273B] text-[#FAF5EA] shadow-xs'
                : 'text-[#544331] hover:text-[#16273B]'
            }`}
          >
            ✍️ 接龙
          </button>
          <button
            type="button"
            onClick={() => {
              soundManager.playWoodTap();
              setActiveTab('prompts');
            }}
            className={`px-2 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
              activeTab === 'prompts'
                ? 'bg-[#16273B] text-[#FAF5EA] shadow-xs'
                : 'text-[#544331] hover:text-[#16273B]'
            }`}
          >
            🎲 灵感骰
          </button>
          <button
            type="button"
            onClick={() => {
              soundManager.playWoodTap();
              setActiveTab('history');
            }}
            className={`px-2 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
              activeTab === 'history'
                ? 'bg-[#16273B] text-[#FAF5EA] shadow-xs'
                : 'text-[#544331] hover:text-[#16273B]'
            }`}
          >
            📚 手稿馆
          </button>
        </div>
      </header>

      {/* 主体滚动视图 */}
      <main className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 max-w-xl w-full mx-auto pb-20">
        {/* ====================================================
            TAB 1: 核心接龙模式 (GAME)
           ==================================================== */}
        {activeTab === 'game' && (
          <div className="space-y-3">
            {!gameStarted ? (
              /* 开始前设定面板 */
              <div className="bg-[#FFFFFF]/90 rounded-2xl p-3.5 sm:p-4 border border-[#D5C19A] shadow-xs relative overflow-hidden">
                <CardPatternOverlay opacity={0.12} />
                <div className="relative z-10 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#EADBBA] pb-2">
                    <div className="flex items-center gap-1.5">
                      <Feather className="w-4 h-4 text-[#8C6226]" />
                      <h2 className="font-serif-title text-xs sm:text-sm font-black text-[#16273B]">
                        发起同人接力创作
                      </h2>
                    </div>
                    <span className="text-[10px] text-[#8C6226] bg-[#F4EADB] px-2 py-0.5 rounded-full font-bold">
                      单机/轮流执笔
                    </span>
                  </div>

                  {/* 灵感起手式 Prompt */}
                  <div className="bg-[#FAF5EA] p-2.5 rounded-xl border border-[#E5DACE]">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-[#8C6226] font-bold flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-[#A67C33]" />
                        本期起手灵感题干
                      </span>
                      <button
                        type="button"
                        onClick={generateRandomPrompt}
                        className="text-[10px] text-[#16273B] hover:text-[#285A46] font-bold flex items-center gap-0.5 cursor-pointer"
                      >
                        <RefreshCw className="w-2.5 h-2.5" />
                        换一题
                      </button>
                    </div>
                    <p className="text-xs text-[#2D241E] font-medium leading-relaxed bg-white/70 p-2 rounded-lg border border-[#EADBBA]">
                      {currentPrompt}
                    </p>
                  </div>

                  {/* 接龙人数设定 */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-[#544331] flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-[#8C6226]" />
                        参与棒次 / 作者人数: <span className="text-[#16273B]">{playerCount} 人</span>
                      </label>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {[2, 3, 4, 5, 6].map((num) => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => {
                            soundManager.playWoodTap();
                            setPlayerCount(num);
                          }}
                          className={`py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            playerCount === num
                              ? 'bg-[#16273B] text-[#FAF5EA] shadow-xs'
                              : 'bg-[#FAF5EA] text-[#715431] hover:bg-[#EADBBA] border border-[#D5C19A]'
                          }`}
                        >
                          {num} 棒
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 作者昵称 */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-[#715431]">
                      各棒次代号（可自定义）:
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {playerNames.map((name, idx) => (
                        <input
                          key={idx}
                          type="text"
                          value={name}
                          maxLength={10}
                          onChange={(e) => {
                            const next = [...playerNames];
                            next[idx] = e.target.value;
                            setPlayerNames(next);
                          }}
                          className="px-2 py-1 bg-white border border-[#D5C19A] rounded-lg text-xs text-[#16273B] focus:outline-none focus:border-[#8C6226]"
                          placeholder={`第 ${idx + 1} 棒`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* 开始接龙按键 */}
                  <button
                    type="button"
                    onClick={handleStartGame}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#16273B] to-[#285A46] text-[#FAF5EA] font-serif-title text-xs sm:text-sm font-bold shadow-md hover:brightness-110 active:scale-98 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Feather className="w-4 h-4 text-[#E5DACE]" />
                    <span>展开羊皮纸 · 执笔开篇 ➜</span>
                  </button>
                </div>
              </div>
            ) : !isRevealed ? (
              /* 进行中：撰写界面 */
              <div className="bg-[#FFFFFF]/95 rounded-2xl p-3.5 sm:p-4 border border-[#D5C19A] shadow-xs relative overflow-hidden space-y-3">
                <CardPatternOverlay opacity={0.12} />
                
                {/* 顶部进度 */}
                <div className="relative z-10 flex items-center justify-between border-b border-[#EADBBA] pb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#2ECC71] animate-pulse" />
                    <span className="text-xs font-bold text-[#16273B]">
                      当前执笔：<span className="text-[#8C6226] font-black">{playerNames[currentTurn]}</span>
                    </span>
                  </div>
                  <span className="text-[10px] text-[#715431] bg-[#F4EADB] px-2 py-0.5 rounded-full font-bold">
                    第 {currentTurn + 1} / {playerCount} 棒
                  </span>
                </div>

                {/* 盲盒上一棒提示 (只露出上一句，营造 Exquisite Corpse 的奇妙反转感) */}
                <div className="relative z-10 bg-[#FAF5EA] p-3 rounded-xl border border-[#E5DACE]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-[#8C6226] font-bold flex items-center gap-1">
                      📖 {currentTurn === 0 ? '灵感开篇导引' : '上一棒传递的信息（仅可见此句）:'}
                    </span>
                    <span className="text-[9px] text-[#A67C33]">
                      {currentTurn === 0 ? '开篇' : `由 ${playerNames[currentTurn - 1]} 留笔`}
                    </span>
                  </div>
                  <div className="bg-white/80 p-2.5 rounded-lg border border-[#EADBBA] text-xs sm:text-sm font-serif-title font-medium text-[#2D241E] leading-relaxed">
                    {currentTurn === 0
                      ? currentPrompt
                      : sentences[currentTurn - 1]?.text}
                  </div>
                </div>

                {/* 当前输入区域 */}
                <div className="relative z-10 space-y-1.5">
                  <label className="text-xs font-bold text-[#16273B] flex items-center gap-1">
                    <Feather className="w-3.5 h-3.5 text-[#8C6226]" />
                    请承接上一句，续写这一棒（1~2句话）:
                  </label>
                  <textarea
                    ref={textareaRef}
                    rows={3}
                    value={currentInput}
                    onChange={(e) => setCurrentInput(e.target.value)}
                    placeholder="在此挥洒你的灵感...（按回车或点击下方按键完成传递）"
                    className="w-full p-2.5 bg-white border border-[#D5C19A] rounded-xl text-xs sm:text-sm text-[#16273B] focus:outline-none focus:border-[#8C6226] leading-relaxed resize-none shadow-inner"
                  />
                </div>

                {/* 操作按键 */}
                <div className="relative z-10 flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playWoodTap();
                      setGameStarted(false);
                    }}
                    className="text-[11px] text-[#8C6226] hover:underline cursor-pointer"
                  >
                    放弃重设
                  </button>
                  <button
                    type="button"
                    onClick={handleNextTurn}
                    className="px-4 py-2 rounded-xl bg-[#16273B] hover:bg-[#285A46] text-[#FAF5EA] font-serif-title text-xs font-bold shadow-md active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <span>{currentTurn + 1 >= playerCount ? '🎉 封卷揭晓！' : '传递给下一位 ➜'}</span>
                  </button>
                </div>
              </div>
            ) : (
              /* 完成状态：羊皮纸手稿揭晓！ */
              <div className="bg-[#FAF5EA] rounded-2xl p-4 border-2 border-[#C5A059] shadow-lg relative overflow-hidden space-y-3.5 animate-in fade-in zoom-in-95 duration-300">
                <CardPatternOverlay opacity={0.16} />
                <div className="relative z-10 flex items-center justify-between border-b border-[#D5C19A] pb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg">📜</span>
                    <h2 className="font-serif-title text-sm sm:text-base font-black text-[#16273B]">
                      调查兵团接龙手稿 · 终篇揭晓
                    </h2>
                  </div>
                  <span className="text-[10px] text-[#8C6226] font-bold bg-white/80 px-2 py-0.5 rounded-full border border-[#D5C19A]">
                    共 {sentences.length} 棒共创
                  </span>
                </div>

                {/* 起手设定 */}
                <div className="relative z-10 text-[11px] text-[#715431] bg-[#F4EADB]/60 p-2 rounded-lg border border-[#E5DACE]">
                  <span className="font-bold text-[#8C6226]">起手灵感：</span>
                  {currentPrompt}
                </div>

                {/* 完整文章呈现 */}
                <div className="relative z-10 bg-white/90 p-3 sm:p-4 rounded-xl border border-[#D5C19A] shadow-inner space-y-2">
                  <p className="font-serif-title text-xs sm:text-sm text-[#1A1817] leading-relaxed tracking-wide">
                    {sentences.map((s, idx) => (
                      <span key={idx} className="inline mr-1 group relative">
                        <span>{s.text}</span>
                        <span className="text-[9px] text-[#8C6226] font-sans font-bold opacity-60 ml-0.5 select-none">
                          [{s.author}]
                        </span>{' '}
                      </span>
                    ))}
                  </p>
                </div>

                {/* 创作者列表 */}
                <div className="relative z-10 flex items-center gap-1 flex-wrap text-[10px] text-[#715431]">
                  <span className="font-bold text-[#8C6226]">联合作者：</span>
                  {playerNames.slice(0, playerCount).map((name, i) => (
                    <span key={i} className="bg-[#EADBBA]/60 px-1.5 py-0.5 rounded-md border border-[#D5C19A]">
                      {name}
                    </span>
                  ))}
                </div>

                {/* 功能操作按键 */}
                <div className="relative z-10 flex items-center justify-between gap-2 pt-1 border-t border-[#D5C19A]">
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playWoodTap();
                      setGameStarted(false);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[#8C6226] text-[#8C6226] hover:bg-[#F4EADB] text-xs font-bold transition-colors cursor-pointer"
                  >
                    再来一局 🎲
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyStory(
                        `【调查兵团同人接龙手稿】\n起手设定：${currentPrompt}\n\n${sentences
                          .map((s) => s.text)
                          .join(' ')}\n\n—— 创作者：${playerNames.slice(0, playerCount).join('、')}`
                      )
                    }
                    className="px-4 py-1.5 rounded-xl bg-[#16273B] hover:bg-[#285A46] text-[#FAF5EA] text-xs font-bold shadow-xs active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-[#2ECC71]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? '已复制' : '复制整篇手稿'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ====================================================
            TAB 2: 灵感骰子生成器 (PROMPTS)
           ==================================================== */}
        {activeTab === 'prompts' && (
          <div className="space-y-3">
            <div className="bg-[#FFFFFF]/90 rounded-2xl p-4 border border-[#D5C19A] shadow-xs relative overflow-hidden">
              <CardPatternOverlay opacity={0.12} />
              <div className="relative z-10 space-y-3">
                <div className="flex items-center justify-between border-b border-[#EADBBA] pb-2">
                  <div className="flex items-center gap-1.5">
                    <Dice5 className="w-4 h-4 text-[#8C6226]" />
                    <h2 className="font-serif-title text-xs sm:text-sm font-black text-[#16273B]">
                      利韩 · 调查兵团灵感骰子
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={generateRandomPrompt}
                    className="px-2.5 py-1 rounded-lg bg-[#16273B] text-[#FAF5EA] text-[11px] font-bold flex items-center gap-1 hover:bg-[#285A46] transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>摇动灵感骰</span>
                  </button>
                </div>

                <div className="bg-[#FAF5EA] p-3.5 rounded-xl border border-[#D5C19A] text-center space-y-2">
                  <span className="text-[10px] text-[#8C6226] font-bold uppercase tracking-wider">
                    🎲 今日随机生成情境
                  </span>
                  <p className="font-serif-title text-sm sm:text-base font-bold text-[#16273B] leading-relaxed px-2">
                    {currentPrompt}
                  </p>
                </div>

                {/* 词库拆解元素 */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[#F8F3E6] p-2 rounded-lg border border-[#EADBBA]">
                    <span className="font-bold text-[#8C6226] block mb-1">🎭 人物库:</span>
                    <p className="text-[11px] text-[#544331]">{PROMPT_CHARACTERS.join('、')}</p>
                  </div>
                  <div className="bg-[#F8F3E6] p-2 rounded-lg border border-[#EADBBA]">
                    <span className="font-bold text-[#8C6226] block mb-1">🏰 地点库:</span>
                    <p className="text-[11px] text-[#544331] truncate">巨树森林、地下室、墙头...</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('game');
                    handleStartGame();
                  }}
                  className="w-full py-2 rounded-xl bg-[#285A46] hover:bg-[#1E4334] text-[#FAF5EA] text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Feather className="w-3.5 h-3.5" />
                  <span>使用此灵感立即开篇 ➜</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================
            TAB 3: 手稿典藏馆 (HISTORY)
           ==================================================== */}
        {activeTab === 'history' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-[#544331] flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5 text-[#8C6226]" />
                已收录手稿 ({savedStories.length} 篇)
              </span>
            </div>

            {savedStories.length === 0 ? (
              <div className="p-8 text-center bg-white/70 rounded-xl border border-dashed border-[#D5C19A] text-[#8C7A65]">
                <p className="text-sm font-serif-title">暂无已收录的手稿</p>
                <p className="text-xs mt-1">快去接龙撰写第一篇兵团故事吧！</p>
              </div>
            ) : (
              savedStories.map((story) => (
                <div
                  key={story.id}
                  className="bg-white/95 rounded-xl p-3 border border-[#D5C19A] shadow-xs relative overflow-hidden space-y-2 group"
                >
                  <div className="flex items-center justify-between border-b border-[#F4EADB] pb-1.5">
                    <div>
                      <h3 className="font-serif-title text-xs sm:text-sm font-bold text-[#16273B]">
                        {story.title}
                      </h3>
                      <span className="text-[9px] text-[#8C7A65]">{story.createdAt}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleCopyStory(story.fullText)}
                        className="p-1 text-[#8C6226] hover:text-[#16273B] rounded hover:bg-[#FAF5EA] cursor-pointer"
                        title="复制整篇"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSaved(story.id, e)}
                        className="p-1 text-[#C0392B] hover:text-red-700 rounded hover:bg-red-50 cursor-pointer"
                        title="删除手稿"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-[#2D241E] leading-relaxed font-serif-title line-clamp-3">
                    {story.fullText}
                  </p>

                  <div className="flex items-center justify-between text-[9px] text-[#8C6226] pt-1">
                    <span>执笔：{story.authors.join('、')}</span>
                    <span>{story.sentences.length} 棒接力</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
};
