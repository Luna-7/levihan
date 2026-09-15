import React, { useEffect, useState } from 'react';
import { submitToInbox } from '../utils/submissionInbox';
import { soundManager } from '../utils/audio';

interface TreeHoleNote {
  id: string;
  sender: string;
  mood: string;
  content: string;
  timestamp: string;
  potatoes: number;
  isCustom?: boolean;
}

const INITIAL_NOTES: TreeHoleNote[] = [
  {
    id: 'note-1',
    sender: '红茶品鉴家',
    mood: '☕ 一杯红茶',
    content: '如果身处没有巨人的和平时代，利威尔应该会开一间安静的红茶店，而韩吉一定会在店后堆满古怪奇妙的机械发明，下雨天一起喝热红茶。',
    timestamp: '第57次壁外调查前夕',
    potatoes: 104,
  },
  {
    id: 'note-2',
    sender: '护目镜修理工',
    mood: '💚 守护利韩',
    content: '“韩吉，把心脏献给我吧。”这一句话，超越了生死、时间与所有的遗憾。他们是彼此眼底唯一完整的风景。',
    timestamp: '地鸣前夜',
    potatoes: 140,
  },
  {
    id: 'note-3',
    sender: '玛利亚之墙哨兵',
    mood: '🍠 偷吃土豆',
    content: '今天巡逻时又在土豆仓发现了一颗刚烤好的土豆，肯定是分队长悄悄留下的。给兵长倒了新进的大吉岭红茶，兵长今天眉头舒展了一点点。',
    timestamp: '托洛斯特区复兴期',
    potatoes: 88,
  },
  {
    id: 'note-4',
    sender: '匿名调查兵',
    mood: '✨ 战友深情',
    content: '十三年后的今天，我们依然在这个温暖的小小土豆仓里热烈地爱着他们。只要还有一个人记得他们的羁绊，这段誓言就永远不朽。',
    timestamp: '现代 · 兵团纪念馆',
    potatoes: 120,
  },
];

const PRESET_SENDERS = [
  '匿名调查兵',
  '红茶爱好者',
  '护目镜修理工',
  '玛利亚之墙哨兵',
  '驻扎兵团摸鱼官',
  '利韩唯粉士兵',
];

const MOOD_OPTIONS = [
  '💚 守护利韩',
  '🍠 偷吃土豆',
  '☕ 一杯红茶',
  '✨ 战友深情',
  '🌸 现世安好',
  '⚔️ 献出心脏',
  '🛡️ 罗塞之墙',
];

const STORAGE_KEY = 'levihan_tree_hole_notes_v1';

interface Props {
  onShowToast: (msg: string) => void;
}

export const TreeHoleModule: React.FC<Props> = ({ onShowToast }) => {
  const [notes, setNotes] = useState<TreeHoleNote[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          return [...parsed, ...INITIAL_NOTES];
        }
      } catch {
        // fallback
      }
    }
    return INITIAL_NOTES;
  });

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [sender, setSender] = useState<string>('匿名调查兵');
  const [mood, setMood] = useState<string>('💚 守护利韩');
  const [content, setContent] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const toggleDropdown = () => {
    soundManager.playBlip();
    setIsOpen((prev) => !prev);
  };

  useEffect(() => {
    fetch('https://levihan-1325571558.cos-website.ap-nanjing.myqcloud.com/treehole.json', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : [])
      .then((published) => {
        if (Array.isArray(published)) setNotes((current) => [...published, ...current.filter((n) => !published.some((p) => p.id === n.id))]);
      }).catch(() => {});
  }, []);

  const handlePostNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      onShowToast('树洞纸条内容不能为空哦 🍃');
      return;
    }
    setIsSubmitting(true);
    try {
      await submitToInbox('submitTreehole', { sender: sender.trim(), mood, content: content.trim() });
      soundManager.playCoin();
      setContent('');
      onShowToast('纸条已进入云端待审收件箱；审核通过后才会公开 📮');
    } catch (error) {
      onShowToast((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddPotato = (noteId: string) => {
    soundManager.playBlip();
    setNotes((prev) =>
      prev.map((n) => {
        if (n.id === noteId) {
          return { ...n, potatoes: n.potatoes + 1 };
        }
        return n;
      })
    );
    onShowToast('为这段心声递上了一颗烤土豆 🍠');
  };

  const handleCopyNote = (text: string) => {
    soundManager.playCoin();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => onShowToast('树洞纸条已复制到剪贴板 📋'),
        () => onShowToast('纸条内容：' + text)
      );
    } else {
      onShowToast('纸条内容：' + text);
    }
  };

  const handleDeleteCustomNote = (noteId: string) => {
    soundManager.playBlip();
    const updated = notes.filter((n) => n.id !== noteId);
    setNotes(updated);
    try {
      const customOnly = updated.filter((n) => n.isCustom);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customOnly));
    } catch {
      // ignored
    }
    onShowToast('已从树洞信箱中取回该纸条 🍃');
  };

  return (
    <section
      id="tree-hole-section"
      className="bg-[#FDF6E3] border-2 border-[#8C6C47] shadow-[2px_2px_0px_#261307] select-none relative overflow-hidden"
    >
      {/* 下拉款信箱头部条 (可点击展开/收起，带有 :active 震动位移增强触感) */}
      <div
        id="tree-hole-dropdown-header"
        onClick={toggleDropdown}
        className={`relative z-10 cursor-pointer p-2.5 sm:p-3 bg-gradient-to-r from-[#F5ECDB] via-[#FAF4E5] to-[#F5ECDB] flex items-center justify-between gap-2 hover:bg-[#F0E6D2] transition-transform duration-75 active:[transform:translate(-2px,2px)] ${
          isOpen ? 'border-b-2 border-[#8C6C47]' : ''
        }`}
      >
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 bg-[#1E4334] text-[#F9E79F] border-2 border-[#153025] flex items-center justify-center text-base sm:text-lg shadow-xs shrink-0">
            📮
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <h3 className="font-pixel text-xs sm:text-sm font-bold text-[#1E4334] tracking-wide truncate">
                兵团树洞 · 利韩同好心声投递箱
              </h3>
              <span className="font-pixel text-[9px] text-[#8C6C47] px-1.5 py-0.2 bg-[#FAF4E5] border border-[#8C6C47]/50 shrink-0 hidden xs:inline-block">
                POSTBOX
              </span>
            </div>
            <p className="font-retro-jp text-[10px] sm:text-[11px] text-[#7A614A] mt-0.5 truncate">
              写下藏在心底的话语、同好碎碎念或对两人的祝福
            </p>
          </div>
        </div>

        {/* 右侧：计数徽章与优化为单一箭头的展开/收起按钮 */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <span className="font-pixel text-[10px] text-[#1E4334] bg-[#E8F8F5] border border-[#1E4334]/30 px-1.5 py-0.5 font-bold hidden sm:inline-block">
            {notes.length} 条心声
          </span>
          <div
            className="w-7 h-7 sm:w-8 sm:h-8 bg-[#1E4334] hover:bg-[#285A46] text-[#F9E79F] border border-[#153025] shadow-xs flex items-center justify-center font-pixel text-xs sm:text-sm select-none transition-transform duration-75 active:[transform:translate(-2px,2px)]"
            title={isOpen ? '收起' : '展开'}
            aria-label={isOpen ? '收起' : '展开'}
          >
            <span className={`inline-block transition-transform duration-200 ${isOpen ? 'rotate-0' : 'rotate-180'}`}>
              ▲
            </span>
          </div>
        </div>
      </div>

      {/* 下拉主体内容 (同人图征集告示 + 投递表单 + 纸条列表) */}
      {isOpen && (
        <div className="relative z-10 space-y-3.5 p-3 sm:p-4 animate-fadeIn">
          {/* 树洞研发与同人图征集说明 (替换原“信口”button) */}
          <div className="w-full bg-[#FAF0D7] border-2 border-[#8C6C47] p-2.5 sm:p-3 shadow-[1px_1px_0px_#261307] text-[#4A3828] font-retro-jp text-xs sm:text-[13px] leading-relaxed flex items-start gap-2.5 select-text">
            <span className="text-base shrink-0 mt-0.5 select-none animate-pulse">🎨</span>
            <p className="flex-1 text-[#3E2E20]">
              树洞正在研发中，现征集同好绘画利韩同人图作为树洞交互页，要求元素有：树林、树洞、夜晚、利韩双人，像素图，若有意向可联络
            </p>
          </div>

          {/* 纸条投递表单 */}
          <form
            onSubmit={handlePostNote}
            className="p-3 sm:p-4 bg-[#FAF4E5] border-2 border-[#8C6C47] shadow-[1px_1px_0px_#261307] space-y-3"
          >
            {/* 投递身份 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-retro-jp text-xs font-bold text-[#4A3828] flex items-center gap-1">
                  <span>🏷️</span>
                  <span>投递身份：</span>
                </label>
                <span className="font-retro-jp text-[10px] text-[#8C7A68]">
                  可直接点击选择或自由编辑
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {PRESET_SENDERS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      soundManager.playBlip();
                      setSender(preset);
                    }}
                    className={`text-[10px] px-2 py-0.5 font-retro-jp border cursor-pointer transition-colors ${
                      sender === preset
                        ? 'bg-[#1E4334] text-[#F9E79F] border-[#153025] font-bold'
                        : 'bg-[#FFFDF5] text-[#5C4A3A] border-[#D5C7A9] hover:bg-[#F3EAD5]'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                maxLength={20}
                placeholder="自定义你的称呼或士兵代号..."
                className="w-full px-2.5 py-1.5 text-xs bg-[#FFFDF5] border border-[#8C6C47] text-[#2C241D] font-retro-jp focus:outline-none focus:border-[#1E4334]"
              />
            </div>

            {/* 心情印章 */}
            <div>
              <label className="block font-retro-jp text-xs font-bold text-[#4A3828] mb-1">
                <span>✨</span>
                <span> 心情印章：</span>
              </label>
              <div className="flex flex-wrap gap-1">
                {MOOD_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      soundManager.playBlip();
                      setMood(opt);
                    }}
                    className={`text-[10px] px-2 py-0.5 font-retro-jp border cursor-pointer transition-colors ${
                      mood === opt
                        ? 'bg-[#B7791F] text-[#FAF5E8] border-[#8E5109] font-bold'
                        : 'bg-[#FFFDF5] text-[#5C4A3A] border-[#D5C7A9] hover:bg-[#F3EAD5]'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* 纸条内容 */}
            <div>
              <label className="block font-retro-jp text-xs font-bold text-[#4A3828] mb-1">
                <span>📝</span>
                <span> 纸条留言：</span>
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder="写下你想对利韩说的某句话、今天的小确幸，或是同好秘密..."
                className="w-full p-2.5 text-xs bg-[#FFFDF5] border border-[#8C6C47] text-[#2C241D] font-retro-jp focus:outline-none focus:border-[#1E4334] resize-none leading-relaxed"
              />
              <div className="flex items-center justify-between text-[10px] text-[#8C7A68] mt-0.5">
                <span>纸条将送入管理员待审收件箱；通过后会公开</span>
                <span>{content.length} / 300</span>
              </div>
            </div>

            {/* 投递纸条按钮 */}
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={isSubmitting || !content.trim()}
                className="px-4 py-2 bg-[#1E4334] text-[#F9E79F] font-retro-jp text-xs sm:text-sm font-bold border border-[#153025] shadow-[1px_1px_0px_#261307] hover:bg-[#285A46] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none transition-all"
              >
                <span>📮</span>
                <span>塞进树洞 · 投递纸条</span>
              </button>
            </div>
          </form>

          {/* 纸条列表 (删除筛选功能，直观完整展示所有纸条) */}
          <div className="space-y-2.5">
            {notes.map((note) => (
              <div
                key={note.id}
                className="bg-[#FFFDF5] border-2 border-[#8C6C47] shadow-[1px_1px_0px_#261307] p-3 font-retro-jp relative group"
              >
                {/* 纸条头部 */}
                <div className="flex items-center justify-between gap-2 border-b border-dashed border-[#8C6C47]/40 pb-1.5 mb-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-bold text-xs text-[#1E4334] truncate">
                      {note.sender}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.2 bg-[#FAF4E5] border border-[#8C6C47]/40 text-[#B7791F] font-bold shrink-0">
                      {note.mood}
                    </span>
                    {note.isCustom && (
                      <span className="text-[9px] px-1 py-0.2 bg-[#E8F8F5] text-[#27AE60] border border-[#27AE60]/40 font-pixel shrink-0">
                        我的纸条
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] text-[#8C7A68] shrink-0">
                    {note.timestamp}
                  </span>
                </div>

                {/* 纸条正文 */}
                <p className="text-xs sm:text-[13px] text-[#3D2F23] leading-relaxed whitespace-pre-wrap">
                  {note.content}
                </p>

                {/* 纸条互动操作栏 */}
                <div className="flex items-center justify-between pt-2 mt-2 border-t border-dashed border-[#8C6C47]/30 text-[11px]">
                  <button
                    type="button"
                    onClick={() => handleAddPotato(note.id)}
                    className="flex items-center gap-1 px-2 py-0.5 bg-[#FEF9E7] border border-[#C29D38] text-[#7D6608] hover:bg-[#FDF3D0] active:scale-95 cursor-pointer font-bold text-[10px] sm:text-[11px]"
                    title="递上一颗烤土豆"
                  >
                    <span>🍠</span>
                    <span>递土豆 ({note.potatoes})</span>
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleCopyNote(note.content)}
                      className="text-[10px] text-[#8C7A68] hover:text-[#1E4334] px-1.5 py-0.5 border border-transparent hover:border-[#8C6C47]/40 cursor-pointer"
                      title="复制纸条内容"
                    >
                      📋 复制
                    </button>

                    {note.isCustom && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomNote(note.id)}
                        className="text-[10px] text-[#C0392B] hover:text-[#962D22] px-1.5 py-0.5 border border-transparent hover:border-[#C0392B]/40 cursor-pointer"
                        title="从树洞中取回"
                      >
                        🗑️ 取回
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
