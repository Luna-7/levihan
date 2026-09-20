import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { soundManager } from '../utils/audio';
import { RotateCcw, Undo2, Shuffle, PackagePlus } from 'lucide-react';
import {
  LIHAN_SPRITE_SRC,
  SPRITE_BG_SIZE,
  CARD_SPRITE_POS,
  BLOCK_SPRITE_POS,
  TRAY_SLOTS,
} from '../data/lihanSprite';

export interface CardType {
  id: string;
  name: string;
}

// 16 种图案全部来自单张雪碧图（lihan-sheet.webp），按 CARD_SPRITE_POS 切片
export const CARD_TYPES: CardType[] = Array.from({ length: 16 }, (_, index) => ({
  id: `card-${index + 1}`,
  name: `卡片${index + 1}`,
}));

const spriteCellStyle = (pos: { x: number; y: number }): React.CSSProperties => ({
  backgroundImage: `url(${LIHAN_SPRITE_SRC})`,
  backgroundSize: `${SPRITE_BG_SIZE.x}% ${SPRITE_BG_SIZE.y}%`,
  backgroundPosition: `${pos.x}% ${pos.y}%`,
  backgroundRepeat: 'no-repeat' as const,
});

const TileFace: React.FC<{ cardInfo: CardType; isCovered?: boolean }> = ({ cardInfo, isCovered = false }) => {
  const idx = Math.max(0, CARD_TYPES.findIndex((c) => c.id === cardInfo.id));
  const pos = CARD_SPRITE_POS[idx] ?? CARD_SPRITE_POS[0];
  return (
    <div
      className="relative w-full h-full overflow-hidden rounded-[4px] shadow-[1px_2px_0px_#233D12]"
      aria-label={cardInfo.name}
    >
      {/* 方块底（雪碧图切片，比例与元素一致无拉伸） */}
      <div className="absolute inset-0" style={spriteCellStyle(BLOCK_SPRITE_POS)} />
      {/* 图案始终渲染：羊了个羊规则里被压住的牌也露出图案，只是不可点击 */}
      <div className="absolute inset-0" style={spriteCellStyle(pos)} />
      {isCovered && (
        // 被压住时仅叠加一层浅暗化，提示不可点击（图案仍然可见）
        <div
          className="absolute inset-0 pointer-events-none rounded-[4px]"
          style={{ background: 'rgba(28,38,24,0.32)' }}
        />
      )}
    </div>
  );
};

export interface CardInstance {
  id: number;
  typeId: string;
  x: number;
  y: number;
  layer: number;
  state: 'board' | 'tray' | 'staging' | 'eliminated';
  originBoardState?: { x: number; y: number; layer: number };
}

interface Props {
  onBack: () => void;
  onShowToast: (msg: string) => void;
  isFullscreen?: boolean;
}

const CARD_W = 46;
const CARD_H = 54;
const TRAY_CAPACITY = 7;

// 灰色空底板（装饰用占位牌，无交互）：铺在牌阵下方，模拟羊了个羊的底图
const GHOST_TILES: { x: number; y: number }[] = (() => {
  const arr: { x: number; y: number }[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 7; c++) {
      const x = 17 + c * 46 + (r % 2) * 23;
      const y = 76 + r * 44;
      if (x + CARD_W <= 320 && y + CARD_H <= 310) arr.push({ x, y });
    }
  }
  return arr;
})();

export const LiLeGeHanGame: React.FC<Props> = ({ onBack, onShowToast }) => {
  // 仅保留最难关卡（玛利亚决战·极难迷阵）
  const [cards, setCards] = useState<CardInstance[]>([]);
  const [tray, setTray] = useState<CardInstance[]>([]);
  const [stagingArea, setStagingArea] = useState<CardInstance[]>([]);
  const [historyMove, setHistoryMove] = useState<number | null>(null);

  // 战术道具使用状态
  const [propMoveOutUsed, setPropMoveOutUsed] = useState<boolean>(false);
  const [propUndoUsed, setPropUndoUsed] = useState<boolean>(false);
  const [propShuffleUsed, setPropShuffleUsed] = useState<boolean>(false);
  const [hasRevived, setHasRevived] = useState<boolean>(false);

  // 弹窗状态
  const [isVictory, setIsVictory] = useState<boolean>(false);
  const [isDefeat, setIsDefeat] = useState<boolean>(false);
  const [eliminatingIds, setEliminatingIds] = useState<number[]>([]);

  // 棋盘按实际可用空间缩放，手机地址栏及视口变化由 ResizeObserver 自动处理
  const boardAreaRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number>(1);

  // 音效防抖
  const soundThrottleRef = useRef<number>(0);

  const cardTypeMap = useMemo(() => {
    const map = new Map<string, CardType>();
    CARD_TYPES.forEach((ct) => map.set(ct.id, ct));
    return map;
  }, []);

  // 16 种图案共 72 张，每种图案数量都是 3 的倍数
  const generateHardestDeck = useCallback((): CardInstance[] => {
    const newCards: CardInstance[] = [];
    let idCounter = 1;

    const deck: string[] = [];
    const bonusOrder = [...CARD_TYPES.keys()];
    for (let i = bonusOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bonusOrder[i], bonusOrder[j]] = [bonusOrder[j], bonusOrder[i]];
    }
    const bonusTypes = new Set(bonusOrder.slice(0, 8));
    CARD_TYPES.forEach((ct, index) => {
      const count = bonusTypes.has(index) ? 6 : 3;
      for (let i = 0; i < count; i++) deck.push(ct.id);
    });

    // 随机充分洗牌
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    const allPos: { x: number; y: number; layer: number }[] = [];

    // 参考羊了个羊构图：中央层叠牌阵（相邻行错位半张、逐层上叠，下层被压住呈灰色暗牌）
    // 第 1 层：4 行 × 5 列，奇数行右错半张
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 5; c++) {
        allPos.push({ x: 40 + c * 46 + (r % 2) * 23, y: 92 + r * 44, layer: 1 });
      }
    }

    // 第 2 层：4 行 × 4 列，继续错位压在第 1 层上
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        allPos.push({ x: 52 + c * 46 + (r % 2) * 23, y: 106 + r * 44, layer: 2 });
      }
    }

    // 第 3 层：2 行 × 4 列
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        allPos.push({ x: 75 + c * 46 + (r % 2) * 23, y: 120 + r * 44, layer: 3 });
      }
    }

    // 第 4 层：核心 1 行 × 4 列，形成层叠视觉焦点
    for (let c = 0; c < 4; c++) {
      allPos.push({ x: 98 + c * 46, y: 142, layer: 4 });
    }

    // 顶部左右横向牌堆：牌底只露出窄边，逐张叠高（参考图上方的堆叠横排）
    for (let i = 0; i < 7; i++) {
      allPos.push({ x: 36 + i * 7, y: 14, layer: 6 + i });
      allPos.push({ x: 236 - i * 7, y: 14, layer: 6 + i });
    }

    // 左右纵向牌堆：只露上边，压住牌阵两翼
    for (let i = 0; i < 5; i++) {
      allPos.push({ x: 14, y: 92 + i * 6, layer: 6 + i });
      allPos.push({ x: 260, y: 92 + i * 6, layer: 6 + i });
    }

    for (let i = 0; i < deck.length && i < allPos.length; i++) {
      newCards.push({
        id: idCounter++,
        typeId: deck[i],
        x: allPos[i].x,
        y: allPos[i].y,
        layer: allPos[i].layer,
        state: 'board',
        originBoardState: { x: allPos[i].x, y: allPos[i].y, layer: allPos[i].layer },
      });
    }

    return newCards;
  }, []);

  // 重启对局
  const restartGame = useCallback(() => {
    const generated = generateHardestDeck();
    setCards(generated);
    setTray([]);
    setStagingArea([]);
    setHistoryMove(null);
    setPropMoveOutUsed(false);
    setPropUndoUsed(false);
    setPropShuffleUsed(false);
    setHasRevived(false);
    setIsVictory(false);
    setIsDefeat(false);
    setEliminatingIds([]);
  }, [generateHardestDeck]);

  useEffect(() => {
    restartGame();
  }, [restartGame]);

  // 使用棋盘实际宽高，留出边缘余量，保证最外侧麻将始终在可点击范围内。
  useEffect(() => {
    const board = boardAreaRef.current;
    if (!board) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      const nextScale = Math.min((width - 12) / 320, (height - 16) / 310, 1.6);
      setScale(Math.max(0.1, nextScale));
    });
    ro.observe(board);
    return () => ro.disconnect();
  }, []);

  // 卡牌遮挡判定：若存在上层卡牌与当前卡牌发生空间重叠，则当前卡牌被遮挡不可点击
  const coveredSet = useMemo(() => {
    const set = new Set<number>();
    const activeBoardCards = cards.filter((c) => c.state === 'board');

    for (let i = 0; i < activeBoardCards.length; i++) {
      const cardA = activeBoardCards[i];
      for (let j = 0; j < activeBoardCards.length; j++) {
        if (i === j) continue;
        const cardB = activeBoardCards[j];
        if (cardA.layer > cardB.layer) {
          const overlapX = Math.abs(cardA.x - cardB.x) < CARD_W - 4;
          const overlapY = Math.abs(cardA.y - cardB.y) < CARD_H - 4;
          if (overlapX && overlapY) {
            set.add(cardB.id);
          }
        }
      }
    }
    return set;
  }, [cards]);

  // 点击卡牌移入槽位
  const handleCardClick = (card: CardInstance) => {
    if (card.state !== 'board') return;
    if (coveredSet.has(card.id)) return;
    if (tray.length >= TRAY_CAPACITY) {
      onShowToast('⚠️ 卡槽已满！无法放入更多卡牌');
      return;
    }

    const now = Date.now();
    if (now - soundThrottleRef.current > 60) {
      soundManager.playBlip();
      soundThrottleRef.current = now;
    }

    const updatedCards = cards.map((c) =>
      c.id === card.id ? { ...c, state: 'tray' as const } : c
    );
    setCards(updatedCards);

    const movedCard = { ...card, state: 'tray' as const };
    const nextTray = [...tray];
    let inserted = false;
    for (let i = nextTray.length - 1; i >= 0; i--) {
      if (nextTray[i].typeId === movedCard.typeId) {
        nextTray.splice(i + 1, 0, movedCard);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      nextTray.push(movedCard);
    }

    setHistoryMove(card.id);
    processTrayMatches(nextTray, updatedCards);
  };

  // 点击备战区卡牌重新放回槽位
  const handleStagedCardClick = (card: CardInstance) => {
    if (tray.length >= TRAY_CAPACITY) {
      onShowToast('⚠️ 卡槽已满！请先消除卡槽内的卡牌');
      return;
    }

    soundManager.playBlip();
    const updatedStaging = stagingArea.filter((c) => c.id !== card.id);
    setStagingArea(updatedStaging);

    const movedCard = { ...card, state: 'tray' as const };
    const nextTray = [...tray];
    let inserted = false;
    for (let i = nextTray.length - 1; i >= 0; i--) {
      if (nextTray[i].typeId === movedCard.typeId) {
        nextTray.splice(i + 1, 0, movedCard);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      nextTray.push(movedCard);
    }

    const updatedCards = cards.map((c) =>
      c.id === card.id ? { ...c, state: 'tray' as const } : c
    );
    setCards(updatedCards);
    processTrayMatches(nextTray, updatedCards);
  };

  // 槽位消除判定与输赢检测
  const processTrayMatches = (currentTray: CardInstance[], currentCards: CardInstance[]) => {
    const counts: Record<string, number> = {};
    currentTray.forEach((c) => {
      counts[c.typeId] = (counts[c.typeId] || 0) + 1;
    });

    let matchType: string | null = null;
    for (const [typeId, count] of Object.entries(counts)) {
      if (count >= 3) {
        matchType = typeId;
        break;
      }
    }

    if (matchType) {
      const matchedCards = currentTray.filter((c) => c.typeId === matchType).slice(0, 3);
      const matchedIds = matchedCards.map((c) => c.id);

      soundManager.playCoin();
      setEliminatingIds(matchedIds);

      setTimeout(() => {
        const remainingTray = currentTray.filter((c) => !matchedIds.includes(c.id));
        setTray(remainingTray);
        setEliminatingIds([]);

        const updatedCards = currentCards.map((c) =>
          matchedIds.includes(c.id) ? { ...c, state: 'eliminated' as const } : c
        );
        setCards(updatedCards);

        const remainingActive = updatedCards.filter((c) => c.state !== 'eliminated');
        if (remainingActive.length === 0) {
          soundManager.playFanfare();
          setIsVictory(true);
        }
      }, 190);
    } else {
      setTray(currentTray);

      if (currentTray.length >= TRAY_CAPACITY) {
        soundManager.playDefeat();
        setIsDefeat(true);
      }
    }
  };

  // 道具 1: 移出卡牌到暂存区
  const handlePropMoveOut = () => {
    if (propMoveOutUsed) return;
    if (tray.length === 0) {
      onShowToast('收集槽内暂无卡牌可移出');
      return;
    }

    soundManager.playChestOpen();
    const countToMove = Math.min(3, tray.length);
    const toMove = tray.slice(0, countToMove);
    const remainingTray = tray.slice(countToMove);

    setTray(remainingTray);
    setStagingArea([...stagingArea, ...toMove]);
    setPropMoveOutUsed(true);

    const movedIds = toMove.map((c) => c.id);
    setCards((prev) =>
      prev.map((c) => (movedIds.includes(c.id) ? { ...c, state: 'staging' as const } : c))
    );
    onShowToast('📦 已移出卡牌至备战区！');
  };

  // 道具 2: 战术撤回
  const handlePropUndo = () => {
    if (propUndoUsed) return;
    if (!historyMove) {
      onShowToast('暂无可撤回的最近步骤');
      return;
    }

    const targetCard = tray.find((c) => c.id === historyMove);
    if (!targetCard) {
      onShowToast('该卡牌已被消除或移动，无法撤回');
      return;
    }

    soundManager.playBlip();
    setTray(tray.filter((c) => c.id !== historyMove));
    setCards((prev) =>
      prev.map((c) => (c.id === historyMove ? { ...c, state: 'board' as const } : c))
    );
    setHistoryMove(null);
    setPropUndoUsed(true);
    onShowToast('↩️ 已撤回 1 张卡牌');
  };

  // 道具 3: 阵型洗牌
  const handlePropShuffle = () => {
    if (propShuffleUsed) return;
    const activeBoardCards = cards.filter((c) => c.state === 'board');
    if (activeBoardCards.length <= 1) {
      onShowToast('棋盘剩余卡牌过少');
      return;
    }

    soundManager.playShuffle();
    const types = activeBoardCards.map((c) => c.typeId);
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }

    const typeAssignmentMap = new Map<number, string>();
    activeBoardCards.forEach((c, idx) => {
      typeAssignmentMap.set(c.id, types[idx]);
    });

    setCards((prev) =>
      prev.map((c) =>
        typeAssignmentMap.has(c.id) ? { ...c, typeId: typeAssignmentMap.get(c.id)! } : c
      )
    );
    setPropShuffleUsed(true);
    onShowToast('🔀 阵列已重洗！');
  };

  // 绝境支援复活
  const handleRevive = () => {
    soundManager.playFanfare();
    setIsDefeat(false);
    setHasRevived(true);

    const toMove = tray.slice(0, 3);
    const remainingTray = tray.slice(3);
    setTray(remainingTray);
    setStagingArea([...stagingArea, ...toMove]);

    const movedIds = toMove.map((c) => c.id);
    setCards((prev) =>
      prev.map((c) => (movedIds.includes(c.id) ? { ...c, state: 'staging' as const } : c))
    );
    onShowToast('🛡️ 绝境支援！槽位已解围！');
  };

  return (
    <div className="relative w-full h-full min-h-0 flex flex-col gap-1 select-none text-[#263819] font-pixel p-1 sm:p-2 overflow-hidden">
      {/* 横向盲盒 + 中央交错牌阵，自适应视口大小（背景透出草丛底图，不做硬边框） */}
      <div
        ref={boardAreaRef}
        className="relative flex-1 min-h-0 w-full overflow-hidden select-none flex items-center justify-center"
      >
        {/* 浮动在背景图右上方的重整按钮 */}
        <button
          onClick={restartGame}
          className="absolute top-2 right-2 z-40 px-2.5 py-1 bg-[#46751E]/90 hover:bg-[#5D8A28] text-[#F5FFCD] border-2 border-[#254312] shadow-[2px_2px_0px_#254312] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer flex items-center gap-1 text-[11px] font-bold backdrop-blur-xs"
          title="重新开始"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>重整</span>
        </button>

        {/* 虚拟画布保留牌阵比例，外层按手机宽高动态缩放 */}
        <div
          style={{
            position: 'relative',
            width: '320px',
            height: '310px',
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
          {/* 灰色空底板装饰层（无交互，垫在所有真实卡牌下方） */}
          {GHOST_TILES.map((g, i) => (
            <div
              key={`ghost-${i}`}
              className="absolute rounded-[4px] pointer-events-none"
              style={{
                left: `${g.x}px`,
                top: `${g.y}px`,
                width: `${CARD_W}px`,
                height: `${CARD_H}px`,
                zIndex: 0,
                background: 'linear-gradient(180deg, #99A396 0%, #7C857A 100%)',
                boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.18), 0 2px 0 rgba(52,60,48,0.35)',
              }}
            />
          ))}

          {cards
            .filter((card) => card.state === 'board')
            .sort((a, b) => a.layer - b.layer || a.id - b.id)
            .map((card) => {
              const cardInfo = cardTypeMap.get(card.typeId) || CARD_TYPES[0];
              const isCovered = coveredSet.has(card.id);

              return (
                <div
                  key={card.id}
                  onClick={() => handleCardClick(card)}
                  style={{
                    position: 'absolute',
                    left: `${card.x}px`,
                    top: `${card.y}px`,
                    width: `${CARD_W}px`,
                    height: `${CARD_H}px`,
                    zIndex: card.layer * 10 + (isCovered ? 0 : 5),
                  }}
                  className={`transition-transform duration-150 select-none ${
                    isCovered
                      ? 'cursor-not-allowed pointer-events-auto'
                      : 'cursor-pointer hover:scale-108 active:scale-95'
                  }`}
                >
                  <TileFace cardInfo={cardInfo} isCovered={isCovered} />
                </div>
              );
            })}
        </div>
      </div>

      {/* 备战整备区 (移出道具触发后) */}
      {stagingArea.length > 0 && (
        <div className="w-full min-w-0 shrink-0 p-1 bg-[#3D5D24] border-2 border-[#233D12] shadow-[2px_2px_0px_#233D12] flex items-center gap-1.5 animate-fadeIn">
          <div className="shrink-0 text-[10px] text-[#F5FFCD] font-pixel flex items-center gap-1 pl-1">
            <span>📦 备战</span>
          </div>
          <div className="min-w-0 flex-1 flex items-center gap-1.5 overflow-x-auto overscroll-x-contain touch-pan-x">
            {stagingArea.map((card) => {
              const cardInfo = cardTypeMap.get(card.typeId) || CARD_TYPES[0];
              return (
                <div
                  key={card.id}
                  onClick={() => handleStagedCardClick(card)}
                  className="w-9 h-11 shrink-0 cursor-pointer hover:scale-108 active:scale-95 transition-transform"
                >
                  <TileFace cardInfo={cardInfo} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 底部 7 格麻将收集槽（卡槽图为雪碧图切片，卡牌按实测内槽位置叠加） */}
      <div
        className="relative w-full max-w-[440px] mx-auto shrink-0 select-none"
        style={{
          aspectRatio: '3 / 1',
          backgroundImage: `url(${LIHAN_SPRITE_SRC})`,
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {tray.map((card, index) => {
          const slot = TRAY_SLOTS[index] ?? TRAY_SLOTS[TRAY_SLOTS.length - 1];
          const cardInfo = cardTypeMap.get(card.typeId) || CARD_TYPES[0];
          const isEliminating = eliminatingIds.includes(card.id);

          return (
            <div
              key={card.id}
              className="absolute"
              style={{
                left: `${slot.left}%`,
                top: `${slot.top}%`,
                width: `${slot.width}%`,
                height: `${slot.height}%`,
              }}
            >
              {/* 卡牌锁定 46:54 比例、按槽高适配、槽内水平居中，避免被槽位比例拉伸 */}
              <div
                className={`relative mx-auto h-full transition-all duration-150 ${
                  isEliminating ? 'scale-125 animate-ping' : 'animate-scaleUp'
                }`}
                style={{ aspectRatio: '46 / 54' }}
              >
                <TileFace cardInfo={cardInfo} />
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部三大道具栏 (羊了个羊同款：蓝色圆角、图标在上文字在下、右上角 ⊕ 角标) */}
      <div className="w-full shrink-0 grid grid-cols-3 gap-2 sm:gap-3 px-0.5">
        <button
          onClick={handlePropMoveOut}
          disabled={propMoveOutUsed || tray.length === 0}
          className={`relative h-[50px] sm:h-[56px] rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 ${
            propMoveOutUsed || tray.length === 0
              ? 'bg-gradient-to-b from-[#C7CDD4] to-[#9AA3AD] border-[#7B848D] cursor-not-allowed opacity-70'
              : 'bg-gradient-to-b from-[#54C0FF] to-[#1B8FE8] border-[#0E6BB8] shadow-[0_3px_0px_#0E5E9E] hover:from-[#6BCBFF] hover:to-[#2F9EF2] cursor-pointer'
          }`}
          title="移出 3 张到备战区"
        >
          <PackagePlus className="w-4 h-4 text-white" strokeWidth={2.5} />
          <span className="font-bold text-[11px] text-white leading-none">移出</span>
          <span className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-[#17181C] text-white text-[11px] font-black flex items-center justify-center border-2 border-white/80 shadow-sm pointer-events-none">
            +
          </span>
        </button>

        <button
          onClick={handlePropUndo}
          disabled={propUndoUsed || !historyMove}
          className={`relative h-[50px] sm:h-[56px] rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 ${
            propUndoUsed || !historyMove
              ? 'bg-gradient-to-b from-[#C7CDD4] to-[#9AA3AD] border-[#7B848D] cursor-not-allowed opacity-70'
              : 'bg-gradient-to-b from-[#54C0FF] to-[#1B8FE8] border-[#0E6BB8] shadow-[0_3px_0px_#0E5E9E] hover:from-[#6BCBFF] hover:to-[#2F9EF2] cursor-pointer'
          }`}
          title="撤回上一张"
        >
          <Undo2 className="w-4 h-4 text-white" strokeWidth={2.5} />
          <span className="font-bold text-[11px] text-white leading-none">撤回</span>
          <span className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-[#17181C] text-white text-[11px] font-black flex items-center justify-center border-2 border-white/80 shadow-sm pointer-events-none">
            +
          </span>
        </button>

        <button
          onClick={handlePropShuffle}
          disabled={propShuffleUsed}
          className={`relative h-[50px] sm:h-[56px] rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 ${
            propShuffleUsed
              ? 'bg-gradient-to-b from-[#C7CDD4] to-[#9AA3AD] border-[#7B848D] cursor-not-allowed opacity-70'
              : 'bg-gradient-to-b from-[#54C0FF] to-[#1B8FE8] border-[#0E6BB8] shadow-[0_3px_0px_#0E5E9E] hover:from-[#6BCBFF] hover:to-[#2F9EF2] cursor-pointer'
          }`}
          title="阵型洗牌"
        >
          <Shuffle className="w-4 h-4 text-white" strokeWidth={2.5} />
          <span className="font-bold text-[11px] text-white leading-none">洗牌</span>
          <span className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-[#17181C] text-white text-[11px] font-black flex items-center justify-center border-2 border-white/80 shadow-sm pointer-events-none">
            +
          </span>
        </button>
      </div>

      {/* 胜利通关模态框 */}
      {isVictory && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#F8FFE7] border-4 border-[#46751E] p-5 max-w-[320px] w-full shadow-[6px_6px_0px_#254312] text-center space-y-3">
            <div className="text-4xl animate-bounce">🏆</div>
            <h3 className="text-base font-black text-[#46751E] font-pixel">
              奇迹！利了个韩 · 决战大捷！
            </h3>
            <p className="text-xs text-[#526548] font-retro-jp leading-relaxed">
              不可思议！你突破了层层遮挡的迷之阵列，成功夺还玛利亚之墙，荣获调查兵团特级荣誉勋章！
            </p>

            <div className="pt-2 flex flex-col gap-2">
              <button
                onClick={restartGame}
                className="w-full py-2 bg-[#46751E] hover:bg-[#5D8A28] text-[#F5FFCD] border-2 border-[#254312] shadow-[2px_2px_0px_#254312] font-bold text-xs cursor-pointer active:scale-95"
              >
                🔄 再次挑战
              </button>
              <button
                onClick={() => {
                  soundManager.playWoodTap();
                  onBack();
                }}
                className="w-full py-1.5 bg-[#EAECEE] hover:bg-[#D5D8DC] text-[#2C3E50] border-2 border-[#BDC3C7] text-xs font-bold cursor-pointer"
              >
                返回大厅
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 失败结算与绝境支援模态框 */}
      {isDefeat && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#F8FFE7] border-4 border-[#922B21] p-5 max-w-[320px] w-full shadow-[6px_6px_0px_#641E16] text-center space-y-3">
            <div className="text-4xl">⚠️</div>
            <h3 className="text-base font-black text-[#922B21] font-pixel">
              卡槽已满 · 战线受阻！
            </h3>
            <p className="text-xs text-[#526548] font-retro-jp leading-relaxed">
              7 个槽位已被填满且未能达成三连消除。
              {!hasRevived
                ? '利威尔与韩吉正从侧翼赶来，可申请一次「绝境支援」腾出卡槽继续作战！'
                : '整理行装重新发起冲锋吧！'}
            </p>

            <div className="pt-2 flex flex-col gap-2">
              {!hasRevived && (
                <button
                  onClick={handleRevive}
                  className="w-full py-2 bg-[#46751E] hover:bg-[#5D8A28] text-[#F5FFCD] border-2 border-[#254312] shadow-[2px_2px_0px_#254312] font-bold text-xs cursor-pointer active:scale-95"
                >
                  🛡️ 接受绝境救援 (移出3张)
                </button>
              )}
              <button
                onClick={restartGame}
                className="w-full py-2 bg-[#922B21] hover:bg-[#A93226] text-[#F8FFE7] border-2 border-[#641E16] shadow-[2px_2px_0px_#641E16] font-bold text-xs cursor-pointer active:scale-95"
              >
                🔄 重新开局
              </button>
              <button
                onClick={() => {
                  soundManager.playWoodTap();
                  onBack();
                }}
                className="w-full py-1.5 bg-[#EAECEE] hover:bg-[#D5D8DC] text-[#2C3E50] border-2 border-[#BDC3C7] text-xs font-bold cursor-pointer"
              >
                返回大厅
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
