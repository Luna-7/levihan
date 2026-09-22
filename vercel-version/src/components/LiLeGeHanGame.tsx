import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { soundManager } from '../utils/audio';
import { RotateCcw, Undo2, Shuffle, PackagePlus } from 'lucide-react';
import {
  LIHAN_SPRITE_SRC,
  LIHAN_TILE_SPRITE_SRC,
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
  backgroundImage: `url(${LIHAN_TILE_SPRITE_SRC})`,
  backgroundSize: `${SPRITE_BG_SIZE.x}% ${SPRITE_BG_SIZE.y}%`,
  backgroundPosition: `${pos.x}% ${pos.y}%`,
  backgroundRepeat: 'no-repeat' as const,
});

const TileFace: React.FC<{ cardInfo: CardType; exposure?: number; hiddenInPile?: boolean }> = ({
  cardInfo, exposure = 1, hiddenInPile = false,
}) => {
  const idx = Math.max(0, CARD_TYPES.findIndex((c) => c.id === cardInfo.id));
  const pos = CARD_SPRITE_POS[idx] ?? CARD_SPRITE_POS[0];
  const covered = exposure < EXPOSED_THRESHOLD;
  const isBadge = idx >= 12;
  return (
    <div
      className={`relative w-full h-full overflow-hidden rounded-[4px] ${covered ? 'shadow-[1px_1px_0px_#233D12]' : 'shadow-[1px_3px_2px_#233D12]'}`}
      aria-label={hiddenInPile ? '未翻开的牌' : cardInfo.name}
    >
      {/* 方块底（雪碧图切片，比例与元素一致无拉伸） */}
      <div className="absolute inset-0" style={spriteCellStyle(BLOCK_SPRITE_POS)} />
      <div className={isBadge ? 'absolute inset-[18%]' : 'absolute inset-[8%]'} style={spriteCellStyle(pos)} />
      {/* 遮罩覆盖整张彩色牌；露出的任何边缘仍可看到图案。 */}
      {covered && <div className="absolute inset-0 rounded-[4px] bg-black/45 pointer-events-none" />}
    </div>
  );
};

export interface CardInstance {
  id: number;
  typeId: string;
  x: number;
  y: number;
  layer: number;
  pile?: 'left' | 'right';
  state: 'board' | 'tray' | 'staging' | 'eliminated';
  originBoardState?: { x: number; y: number; layer: number };
}

interface Props {
  onBack: () => void;
  onShowToast: (msg: string) => void;
  isFullscreen?: boolean;
}

const CARD_W = 48;
const CARD_H = 56;
const BOARD_W = 360;
const BOARD_H = 620;
const TRAY_CAPACITY = 7;
const EXPOSED_THRESHOLD = 0.95;

// 一局总牌数。⚠️ 必须是 3 的倍数：三张一组才能消除，总数除不尽就必然剩牌 ⇒ 死局。
// 350 % 3 = 2 不成立，故取最近的合法值 351 = 117 组三消（比 350 只多 1 张）。
const TOTAL_CARDS = 351;
// 暗牌的错位步进（羊了个羊同款砖块堆叠）：半张牌 = 横 24 / 纵 28，四步一循环。
// 第 1 步往右、第 2 步往下、第 3 步右下，再深的牌回到第 0 步原位——所以堆多深都不会越堆越远，
// 视觉上永远是「上层压住下层一半、下层露出半张脸」，看得见但点不了。
const STACK_STEPS: [number, number][] = [
  [0, 0],
  [24, 0],
  [0, 28],
  [24, 28],
];
// 位点的基础层号乘以它，保证暗堆内部的层不会和别的一组混在一起（保持原有遮挡顺序）。
const LAYER_BAND = 8;

const calculateExposureMap = (cards: CardInstance[]): Map<number, number> => {
  const map = new Map<number, number>();
  const active = cards.filter((card) => card.state === 'board');
  for (const card of active) {
    const blockers = active.filter((other) => other.layer > card.layer &&
      other.x < card.x + CARD_W && other.x + CARD_W > card.x &&
      other.y < card.y + CARD_H && other.y + CARD_H > card.y);
    if (card.pile && blockers.some((other) => other.pile === card.pile)) {
      map.set(card.id, 0);
      continue;
    }
    if (blockers.length === 0) {
      map.set(card.id, 1);
      continue;
    }
    let visible = 0;
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 6; col++) {
        const x = card.x + (col + 0.5) * CARD_W / 6;
        const y = card.y + (row + 0.5) * CARD_H / 6;
        if (!blockers.some((other) => x >= other.x && x < other.x + CARD_W && y >= other.y && y < other.y + CARD_H)) visible++;
      }
    }
    map.set(card.id, visible / 36);
  }
  return map;
};

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
  const trayRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number>(1);

  // 音效防抖
  const soundThrottleRef = useRef<number>(0);

  const cardTypeMap = useMemo(() => {
    const map = new Map<string, CardType>();
    CARD_TYPES.forEach((ct) => map.set(ct.id, ct));
    return map;
  }, []);

  // 351 张 = 117 组三消：68 个布局位点（倒三角牌阵 52 + 两侧盲盒柱 14 + 顶部辅助牌 2）。
  // 行数往下越来越窄、每行越摞越深，差额补在最底下一行 ⇒ 「上易下难、最底层重叠最多」。
  const generateHardestDeck = useCallback((): CardInstance[] => {
    const newCards: CardInstance[] = [];
    let idCounter = 1;

    // 每种图案的张数也必须是 3 的倍数，否则该花色永远清不完。
    // 11 种 × 21 张 + 5 种 × 24 张 = 351（哪 5 种多给一组随机决定）。
    const counts = CARD_TYPES.map(() => 21);
    const lottery = CARD_TYPES.map((_, i) => i);
    for (let i = lottery.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lottery[i], lottery[j]] = [lottery[j], lottery[i]];
    }
    const extraGroups = (TOTAL_CARDS - counts.length * 21) / 3;
    lottery.slice(0, extraGroups).forEach((i) => { counts[i] += 3; });

    const deck: string[] = [];
    counts.forEach((count, index) => {
      for (let i = 0; i < count; i++) deck.push(CARD_TYPES[index].id);
    });

    // 随机充分洗牌
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    // 布局参考羊了个羊：行数往下越来越窄（整体是个倒三角），行内的位点越往下摞得越深，
    // 所以最底层重叠的最多。每行位点最上面那张都没有遮挡——开局仍是一大片可点的简单区。
    type Pos = { x: number; y: number; layer: number; depth: number; pile?: 'left' | 'right' };
    const ROW_SHAPE: [number, number][] = [
      // [这一行几个位点, 每个位点摞几张]，从上往下
      [7, 1], [7, 1], [7, 2], [7, 4], [6, 6], [6, 9], [5, 12], [4, 16], [3, 20],
    ];
    const PITCH_X = 46;
    const PITCH_Y = 52;
    const Y0 = 110;
    // 砖块步进只往右下长，所以整片牌阵要预先左移半个步进的一半，视觉上才是居中的。
    const BAND_INSET_X = STACK_STEPS[1][0] / 2;

    const gridPos: Pos[] = [];
    ROW_SHAPE.forEach(([cols, depth], row) => {
      const rowWidth = (cols - 1) * PITCH_X + CARD_W;
      const left = (BOARD_W - rowWidth) / 2 - BAND_INSET_X;
      for (let col = 0; col < cols; col++) {
        gridPos.push({ x: left + col * PITCH_X, y: Y0 + row * PITCH_Y, layer: 4, depth });
      }
    });

    // 两侧盲盒柱：开局就能点，但点下去才知道是什么——纯粹的赌。保持单张。
    // y=52 时下沿 108，正好落在牌阵第一排（y=110）上方，不压住任何一张牌。
    const pilePos: Pos[] = [];
    for (const pile of ['left', 'right'] as const) {
      for (let i = 0; i < 7; i++) {
        pilePos.push({ x: pile === 'left' ? 12 + i * 10 : 296 - i * 10, y: 52, layer: 10 + i, depth: 1, pile });
      }
    }

    // 顶部两张悬空辅助牌：不压任何牌、随时可点（tray 快满时最后的确定逃生项）。
    // x 必须落在左右盲盒柱之间的空档（120~236）里，否则会盖住盲盒柱顶端那张，让它点不了。
    const helperPos: Pos[] = [132, 180].map((x) => ({ x, y: 52, layer: 20, depth: 1 }));

    // 凑满总牌数：差额全部补在牌阵上，且从最底下一行往上轮流加（越下面越深）。
    let deficit = TOTAL_CARDS - (pilePos.length + helperPos.length)
      - gridPos.reduce((sum, p) => sum + p.depth, 0);
    let growIdx = gridPos.length - 1;
    while (deficit > 0 && gridPos.length > 0) {
      gridPos[growIdx].depth += 1;
      deficit -= 1;
      growIdx = growIdx > 0 ? growIdx - 1 : gridPos.length - 1;
    }
    while (deficit < 0) {
      const target = gridPos.find((p) => p.depth > 1);
      if (!target) break;
      target.depth -= 1;
      deficit += 1;
    }

    const allPos: Pos[] = [...gridPos, ...pilePos, ...helperPos];

    let cursor = 0;
    allPos.forEach((pos) => {
      for (let k = 0; k < pos.depth; k++) {
        // k=0 是这一堆的顶层：停在原位、层号统一，所以全盘顶层互不遮挡——开局就是一大片可点区。
        // 下面的暗牌按半张牌步进错开（右 / 下 / 右下，四步一循环），层号依次递减：
        // 上层压住下层一半，下层露出的那半张既是线索（认得出图案）又点不了（还是被压着）。
        const [dx, dy] = STACK_STEPS[k % STACK_STEPS.length];
        const x = pos.x + dx;
        const y = pos.y + dy;
        const layer = pos.layer * LAYER_BAND - k;
        newCards.push({
          id: idCounter++,
          typeId: deck[cursor++],
          x,
          y,
          layer,
          pile: pos.pile,
          state: 'board',
          originBoardState: { x, y, layer },
        });
      }
    });

    // 开局那片简单区铺足十二组三消，让上手阶段真的有得消；越往下越不预排，逐步变成纯赌。
    const initialExposure = calculateExposureMap(newCards);
    const firstLayer = newCards.filter((card) => (initialExposure.get(card.id) ?? 0) >= EXPOSED_THRESHOLD);
    for (let i = firstLayer.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [firstLayer[i], firstLayer[j]] = [firstLayer[j], firstLayer[i]];
    }
    firstLayer.length = Math.min(firstLayer.length, 36);
    const starterTypes = [...CARD_TYPES];
    for (let i = starterTypes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [starterTypes[i], starterTypes[j]] = [starterTypes[j], starterTypes[i]];
    }
    const reserved = new Set<number>();
    firstLayer.forEach((target, index) => {
      const typeId = starterTypes[Math.floor(index / 3)]?.id;
      if (!typeId) return;
      const targetIndex = newCards.findIndex((card) => card.id === target.id);
      const donorIndex = newCards.findIndex((card, i) => card.typeId === typeId && !reserved.has(i));
      if (donorIndex < 0) return;
      [newCards[targetIndex].typeId, newCards[donorIndex].typeId] = [newCards[donorIndex].typeId, newCards[targetIndex].typeId];
      reserved.add(targetIndex);
    });

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

  // 以卡槽内宽作为牌面尺寸上限，棋盘与卡槽里的牌保持一致。
  useEffect(() => {
    const board = boardAreaRef.current;
    const trayElement = trayRef.current;
    if (!board || !trayElement) return;
    const updateScale = () => {
      const width = board.clientWidth;
      const height = board.clientHeight;
      const slotWidth = trayElement.clientWidth * TRAY_SLOTS[0].width / 100;
      if (width <= 0 || height <= 0 || slotWidth <= 0) return;
      const nextScale = Math.min((width - 16) / BOARD_W, (height - 28) / BOARD_H, slotWidth * 1.2 / CARD_W, 1.6);
      setScale(Math.max(0.1, nextScale));
    };
    const ro = new ResizeObserver(updateScale);
    ro.observe(board);
    ro.observe(trayElement);
    updateScale();
    return () => ro.disconnect();
  }, []);

  // 真正位于最上方的牌没有阻挡者，始终以原色显示。
  const exposureMap = useMemo(() => calculateExposureMap(cards), [cards]);

  // 点击卡牌移入槽位
  const handleCardClick = (card: CardInstance) => {
    if (card.state !== 'board') return;
    if ((exposureMap.get(card.id) ?? 1) < EXPOSED_THRESHOLD) return;
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

  // 点击卡槽上方那排临时牌，重新放回槽位
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
    onShowToast('📦 已移出卡牌，暂放在卡槽上方');
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
        className="relative flex-1 min-h-0 w-full overflow-hidden select-none flex items-start justify-center pt-[14px]"
      >
        {/* 重整按钮居中放在牌阵上方，避免挡住右上角的辅助牌。 */}
        <button
          onClick={restartGame}
          className="absolute top-2 left-1/2 -translate-x-1/2 z-40 px-2.5 py-1 bg-[#46751E]/90 hover:bg-[#5D8A28] text-[#F5FFCD] border-2 border-[#254312] shadow-[2px_2px_0px_#254312] cursor-pointer flex items-center gap-1 text-[11px] font-bold backdrop-blur-xs"
          title="重新开始"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>重整</span>
        </button>

        {/* 虚拟画布保留牌阵比例，外层按手机宽高动态缩放 */}
        <div className="relative shrink-0" style={{ width: BOARD_W * scale, height: BOARD_H * scale }}>
          <div
            style={{
              position: 'absolute',
              width: `${BOARD_W}px`,
              height: `${BOARD_H}px`,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
          {cards
            .filter((card) => card.state === 'board')
            .sort((a, b) => a.layer - b.layer || a.id - b.id)
            .map((card) => {
              const cardInfo = cardTypeMap.get(card.typeId) || CARD_TYPES[0];
              const exposure = exposureMap.get(card.id) ?? 1;
              const isCovered = exposure < EXPOSED_THRESHOLD;
              const hiddenInPile = Boolean(card.pile && cards.some((other) =>
                other.state === 'board' && other.pile === card.pile && other.layer > card.layer));

              return (
                <button
                  key={card.id}
                  type="button"
                  disabled={isCovered}
                  aria-label={hiddenInPile ? '未翻开的牌' : cardInfo.name}
                  onClick={() => handleCardClick(card)}
                  style={{
                    position: 'absolute',
                    left: `${card.x}px`,
                    top: `${card.y}px`,
                    width: `${CARD_W}px`,
                    height: `${CARD_H}px`,
                    zIndex: card.layer * 10,
                    touchAction: 'manipulation',
                  }}
                  className={`p-0 border-0 bg-transparent transition-transform duration-150 select-none ${
                    isCovered
                      ? 'cursor-default'
                      : 'cursor-pointer hover:scale-108 active:scale-95 -translate-y-px'
                  }`}
                >
                  <TileFace cardInfo={cardInfo} exposure={exposure} hiddenInPile={hiddenInPile} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 底部 7 格麻将收集槽（卡槽图为雪碧图切片，卡牌按实测内槽位置叠加）。
          移出/救援出来的牌不再单独占一行「备战」栏，而是直接浮在卡槽上方，牌面尺寸不缩小。 */}
      <div
        ref={trayRef}
        className="relative z-[1700] w-full max-w-[440px] mx-auto shrink-0 select-none scale-[1.03]"
        style={{
          aspectRatio: '3 / 1',
          boxSizing: 'content-box',
          paddingBottom: '2px',
          backgroundImage: `url(${LIHAN_SPRITE_SRC})`,
          // 雪碧图底部 690×230 才是卡槽；按原始比例铺图并对齐底边，裁掉上方人物素材。
          backgroundSize: '100% auto',
          backgroundPosition: 'center bottom',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {stagingArea.length > 0 && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-40 flex items-end gap-1.5">
            {stagingArea.map((card) => {
              const cardInfo = cardTypeMap.get(card.typeId) || CARD_TYPES[0];
              return (
                <div
                  key={card.id}
                  onClick={() => handleStagedCardClick(card)}
                  className="w-12 h-14 shrink-0 cursor-pointer hover:scale-105 active:scale-95 transition-transform"
                  title="点一下放回卡槽"
                >
                  <TileFace cardInfo={cardInfo} />
                </div>
              );
            })}
          </div>
        )}
        {tray.map((card, index) => {
          const slot = TRAY_SLOTS[index] ?? TRAY_SLOTS[TRAY_SLOTS.length - 1];
          const cardInfo = cardTypeMap.get(card.typeId) || CARD_TYPES[0];
          const isEliminating = eliminatingIds.includes(card.id);

          return (
            <div
              key={card.id}
              className="absolute flex items-center justify-center"
              style={{
                left: `${slot.left}%`,
                top: `calc(${slot.top}% - 1px)`,
                width: `${slot.width}%`,
                height: `${slot.height}%`,
              }}
            >
              {/* 卡牌按槽宽等比缩放，牌面不溢出卡槽。 */}
              <div
                className={`relative w-full max-h-full transition-all duration-150 ${
                  isEliminating ? 'scale-125 animate-ping' : 'animate-scaleUp'
                }`}
                style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }}
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
          title="移出 3 张暂放到卡槽上方"
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
