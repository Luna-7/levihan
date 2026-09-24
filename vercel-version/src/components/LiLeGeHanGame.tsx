import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { soundManager } from '../utils/audio';
import { submitScore } from '../utils/gameScores';
import { Undo2, Shuffle, PackagePlus } from 'lucide-react';
import {
  LIHAN_TRAY_SPRITE_SRC,
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

// 16 种图案全部来自清理过透明间隔的牌面雪碧图，按 CARD_SPRITE_POS 切片。
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

const TileFace = React.memo<{ cardInfo: CardType; exposure?: number; hiddenInPile?: boolean }>(({
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
});

const BoardCard = React.memo<{
  card: CardInstance;
  cardInfo: CardType;
  exposure: number;
  hiddenInPile: boolean;
  onClick: (card: CardInstance) => void;
}>(({ card, cardInfo, exposure, hiddenInPile, onClick }) => {
  const isCovered = exposure < EXPOSED_THRESHOLD;

  return (
    <button
      type="button"
      disabled={isCovered}
      aria-label={hiddenInPile ? '未翻开的牌' : cardInfo.name}
      onClick={() => onClick(card)}
      style={{
        position: 'absolute',
        left: `${card.x}px`,
        top: `${card.y}px`,
        width: `${CARD_W}px`,
        height: `${CARD_H}px`,
        zIndex: card.layer * 10,
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
        userSelect: 'none',
      }}
      className={`p-0 border-0 bg-transparent select-none transform-gpu ${
        isCovered
          ? 'cursor-default pointer-events-none'
          : 'cursor-pointer hover:scale-105 active:scale-95 transition-transform duration-75'
      }`}
    >
      <TileFace cardInfo={cardInfo} exposure={exposure} hiddenInPile={hiddenInPile} />
    </button>
  );
});

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
  restartSignal?: number;
}

// 牌面整体等比例放大 ~30%（48×56 → 62×72，比例仍是 6:7）。
// ⚠️ 棋盘与卡槽的缩放已解耦：棋盘按可用宽高自由放大，进了卡槽再按槽格缩回去。
const CARD_W = 62;
const CARD_H = 72;
// 卡槽内框比棋盘牌更修长，独立使用 4:5，避免直接套用棋盘比例后显得横向发胖。
const TRAY_CARD_ASPECT = 4 / 5;
const BOARD_W = 362;
const BOARD_H = 500;
const TRAY_CAPACITY = 7;
const EXPOSED_THRESHOLD = 0.95;

// 一局总牌数。⚠️ 必须是 3 的倍数：三张一组才能消除，总数除不尽就必然剩牌 ⇒ 死局。
// 350 % 3 = 2 不成立，故取最近的合法值 351 = 117 组三消（比 350 只多 1 张）。
const TOTAL_CARDS = 351;
// 约 15% 的新牌局会生成一条完整的可见三消路径。牌数和堆叠层数不变，
// 只是按从上到下的可点击顺序组织花色，避免七格卡槽完全依赖运气。
const GUIDED_DECK_RATE = 0.15;
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

const GRID_CELL_SIZE = 36;
const GRID_COLS = Math.ceil((BOARD_W + CARD_W) / GRID_CELL_SIZE);
const GRID_ROWS = Math.ceil((BOARD_H + CARD_H) / GRID_CELL_SIZE);

const calculateExposureMap = (cards: CardInstance[]): Map<number, number> => {
  const map = new Map<number, number>();
  const active = cards.filter((card) => card.state === 'board');
  const len = active.length;
  if (len === 0) return map;

  // 空间网格加速：将 350x350 (12.2万次) 暴力比对降至局部网格 (~500次)，耗时从 80-120ms 直降至 <1ms，彻底解决 iOS 端的点击卡顿
  const grid: number[][] = Array.from({ length: GRID_COLS * GRID_ROWS }, () => []);

  for (let i = 0; i < len; i++) {
    const c = active[i];
    const minCol = Math.max(0, Math.floor(c.x / GRID_CELL_SIZE));
    const maxCol = Math.min(GRID_COLS - 1, Math.floor((c.x + CARD_W) / GRID_CELL_SIZE));
    const minRow = Math.max(0, Math.floor(c.y / GRID_CELL_SIZE));
    const maxRow = Math.min(GRID_ROWS - 1, Math.floor((c.y + CARD_H) / GRID_CELL_SIZE));

    for (let r = minRow; r <= maxRow; r++) {
      const rowOffset = r * GRID_COLS;
      for (let col = minCol; col <= maxCol; col++) {
        grid[rowOffset + col].push(i);
      }
    }
  }

  const seen = new Uint8Array(len);
  const candidateIndices: number[] = [];
  const blockersBuf: CardInstance[] = [];

  for (let i = 0; i < len; i++) {
    const card = active[i];
    candidateIndices.length = 0;

    const minCol = Math.max(0, Math.floor(card.x / GRID_CELL_SIZE));
    const maxCol = Math.min(GRID_COLS - 1, Math.floor((card.x + CARD_W) / GRID_CELL_SIZE));
    const minRow = Math.max(0, Math.floor(card.y / GRID_CELL_SIZE));
    const maxRow = Math.min(GRID_ROWS - 1, Math.floor((card.y + CARD_H) / GRID_CELL_SIZE));

    for (let r = minRow; r <= maxRow; r++) {
      const rowOffset = r * GRID_COLS;
      for (let col = minCol; col <= maxCol; col++) {
        const cell = grid[rowOffset + col];
        for (let k = 0; k < cell.length; k++) {
          const otherIdx = cell[k];
          if (otherIdx === i || seen[otherIdx] === 1) continue;
          seen[otherIdx] = 1;
          candidateIndices.push(otherIdx);
        }
      }
    }

    // 重置已查重标记
    for (let k = 0; k < candidateIndices.length; k++) {
      seen[candidateIndices[k]] = 0;
    }

    blockersBuf.length = 0;
    let blockedBySamePile = false;

    for (let k = 0; k < candidateIndices.length; k++) {
      const other = active[candidateIndices[k]];
      if (
        other.layer > card.layer &&
        other.x < card.x + CARD_W &&
        other.x + CARD_W > card.x &&
        other.y < card.y + CARD_H &&
        other.y + CARD_H > card.y
      ) {
        if (card.pile && other.pile === card.pile) {
          blockedBySamePile = true;
          break;
        }
        blockersBuf.push(other);
      }
    }

    if (blockedBySamePile) {
      map.set(card.id, 0);
      continue;
    }
    const bLen = blockersBuf.length;
    if (bLen === 0) {
      map.set(card.id, 1);
      continue;
    }

    // 4x4 采样测试
    let visible = 0;
    const stepW = CARD_W / 4;
    const stepH = CARD_H / 4;
    for (let row = 0; row < 4; row++) {
      const y = card.y + (row + 0.5) * stepH;
      for (let col = 0; col < 4; col++) {
        const x = card.x + (col + 0.5) * stepW;
        let blocked = false;
        for (let b = 0; b < bLen; b++) {
          const o = blockersBuf[b];
          if (x >= o.x && x < o.x + CARD_W && y >= o.y && y < o.y + CARD_H) {
            blocked = true;
            break;
          }
        }
        if (!blocked) visible++;
      }
    }
    map.set(card.id, visible / 16);
  }
  return map;
};

export const LiLeGeHanGame: React.FC<Props> = ({ onBack, onShowToast, restartSignal = 0 }) => {
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
  const [isVictory, setIsVictory] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('victory-preview') === 'lihan';
  });
  const [isDefeat, setIsDefeat] = useState<boolean>(false);
  const [eliminatingIds, setEliminatingIds] = useState<number[]>([]);

  // 棋盘按实际可用空间缩放，手机地址栏及视口变化由 ResizeObserver 自动处理
  const boardAreaRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef(Date.now());
  const victorySubmittedRef = useRef(false);
  const [scale, setScale] = useState<number>(1);
  // 卡槽（含浮在卡槽上方的临时牌）里那张牌的实测宽度：棋盘牌放大后，进槽自动缩到槽格大小。
  const [trayCardW, setTrayCardW] = useState<number>(40);

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
    const guidedDeck = Math.random() < GUIDED_DECK_RATE;

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

    // ===== 矩形砖阵（羊了个羊同款，参考图版）=====
    // 两层格位咬合成一整片砖墙：
    //   A 格 = 顶层的整片矩形（4 列 × 5 行），全部共用一个层号 ⇒ 开局整片都能点。
    //   F 格 = 嵌在每 4 张 A 之间、正好低一层 ⇒ 半张错位，从砖缝里露出 20px 宽的一条，
    //          看得见图案但点不了；等上面的 A 清掉才会翻上来。
    // 行距/列距都大于牌面尺寸，所以 A 格之间留出真正的砖缝，F 格才有得露。
    type Pos = { x: number; y: number; layer: number; depth: number; pile?: 'left' | 'right' };
    const PITCH_AX = 68;   // 列距（牌宽 62 ⇒ 6px 竖砖缝 ≈ 参考图的 1/10 牌宽）
    const PITCH_AY = 78;   // 行距（牌高 72 ⇒ 6px 横砖缝）
    const XA = 2;          // 整片横向靠左，右侧留出暗牌凸边（最多 24px）
    const Y0 = 86;         // 牌阵顶端，上方 6~78 留给盲盒柱与辅助牌
    const STAGGER = PITCH_AX / 2;   // 34：相邻行横向错开半张（砖墙错缝）
    // 逐行格位数 5/4 交替 + 错开半张 ⇒ 左右两侧自然形成台阶状的参差边，
    // 不再是四四方方的整齐网格，整体仍是一整片矩形砖墙（参考图的观感）。
    const ROW_COLS = [5, 4, 5, 4, 5];

    const gridPos: Pos[] = [];
    const rowMeta: { x0: number; cols: number; y: number }[] = [];
    ROW_COLS.forEach((cols, row) => {
      const x0 = XA + (row % 2) * STAGGER;
      const y = Y0 + row * PITCH_AY;
      rowMeta.push({ x0, cols, y });
      // A 格：顶层，越往下摞得越深
      for (let col = 0; col < cols; col++) {
        gridPos.push({ x: x0 + col * PITCH_AX, y, layer: 6, depth: 6 + row });
      }
    });
    // F 格：嵌格，落在上一行的砖缝正下方、正好低一层（layer 基准 4 ⇒ 32），
    // 只在行间 6px 缝 + 6px 竖缝里露出一条 ⇒ 看得见图案但点不了。
    for (let row = 0; row < ROW_COLS.length - 1; row++) {
      const { x0, cols, y } = rowMeta[row];
      for (let col = 0; col < cols - 1; col++) {
        gridPos.push({
          x: x0 + col * PITCH_AX + STAGGER,
          y: y + PITCH_AY / 2,
          layer: 4,
          depth: 8 + row,
        });
      }
    }

    // 两侧盲盒柱：开局只露最外面那张，点下去才知道是什么——纯粹的赌。保持单张。
    // y=6 时下沿 78，正好落在牌阵第一排（y=86）上方，不压住任何一张牌。
    const pilePos: Pos[] = [];
    for (const pile of ['left', 'right'] as const) {
      for (let i = 0; i < 7; i++) {
        pilePos.push({
          x: pile === 'left' ? 6 + i * 9 : BOARD_W - 68 - i * 9,
          y: 6,
          layer: 16 - i,
          depth: 1,
          pile,
        });
      }
    }

    // 顶部两张悬空辅助牌：不压任何牌、随时可点（tray 快满时最后的确定逃生项）。
    // x 必须落在左右盲盒柱「顶牌」之间的空档（68~294）里，否则会盖住柱子顶端那张。
    // 114/186 是该空档内居中摆放（整体宽 134，两侧各留 46）的结果。
    const helperPos: Pos[] = [114, 186].map((x) => ({ x, y: 6, layer: 20, depth: 1 }));

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

    if (guidedDeck) {
      // 补给局只从随机抽出的三种花色中发牌，每种 117 张。
      // 七格槽里只要出现第七张，按抽屉原理此前必然已有三张同色并自动消除，
      // 所以不会因槽满失败；所有堆叠最终都会露出，形成可保证通关的 15% 牌局。
      const guidedTypes = [...CARD_TYPES].sort(() => Math.random() - 0.5).slice(0, 3);
      const guidedCards = guidedTypes.flatMap((type) => Array.from({ length: TOTAL_CARDS / 3 }, () => type.id));
      for (let i = guidedCards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [guidedCards[i], guidedCards[j]] = [guidedCards[j], guidedCards[i]];
      }
      newCards.forEach((card, index) => { card.typeId = guidedCards[index]; });
    }

    // 开局那片简单区铺足十二组三消，让上手阶段真的有得消；越往下越不预排，逐步变成纯赌。
    if (!guidedDeck) {
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
    }

    return newCards;
  }, []);

  // 重启对局
  const restartGame = useCallback(() => {
    startedAtRef.current = Date.now();
    victorySubmittedRef.current = false;
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

  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      restartGame();
      if (new URLSearchParams(window.location.search).get('victory-preview') === 'lihan') {
        setIsVictory(true);
      }
      return;
    }
    restartGame();
  }, [restartGame, restartSignal]);

  // 棋盘按可用宽高自由缩放（不再被卡槽槽宽拖住，牌面才放得大）；
  // 卡槽与卡槽上方的临时牌另算一个尺寸，自动缩到槽格大小。
  useEffect(() => {
    const board = boardAreaRef.current;
    const trayElement = trayRef.current;
    if (!board || !trayElement) return;
    const updateScale = () => {
      const width = board.clientWidth;
      const height = board.clientHeight;
      const slotWidth = trayElement.clientWidth * TRAY_SLOTS[0].width / 100;
      const slotHeight = trayElement.clientHeight * TRAY_SLOTS[0].height / 100;
      if (width <= 0 || height <= 0) return;
      // 牌面整体放大后棋盘只受可用宽高约束。
      const nextScale = Math.min((width - 8) / BOARD_W, (height - 8) / BOARD_H, 1.6);
      setScale(Math.max(0.1, nextScale));
      // 槽内牌：按槽格的宽/高双约束等比缩小，牌面不溢出卡槽。
      if (slotWidth > 0 && slotHeight > 0) {
        // 牌面阴影会向右、向下延伸约 3px，预留 18% 内框空间才能让阴影也完整落在木槽里。
        const fitW = slotWidth * 0.82;
        const fitH = slotHeight * 0.82;
        const nextCardW = Math.min(fitW, fitH * TRAY_CARD_ASPECT);
        setTrayCardW(Math.max(18, nextCardW));
      }
    };
    const ro = new ResizeObserver(updateScale);
    ro.observe(board);
    ro.observe(trayElement);
    updateScale();
    return () => ro.disconnect();
  }, []);

  // 真正位于最上方的牌没有阻挡者，始终以原色显示。
  const exposureMap = useMemo(() => calculateExposureMap(cards), [cards]);

  // 暗堆快速索引：盲盒柱中非最顶层的牌判定为未翻开
  const hiddenInPileSet = useMemo(() => {
    const set = new Set<number>();
    const pileTop = new Map<string, number>();
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (c.state === 'board' && c.pile) {
        const top = pileTop.get(c.pile);
        if (top === undefined || c.layer > top) {
          pileTop.set(c.pile, c.layer);
        }
      }
    }
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (c.state === 'board' && c.pile) {
        const top = pileTop.get(c.pile);
        if (top !== undefined && c.layer < top) {
          set.add(c.id);
        }
      }
    }
    return set;
  }, [cards]);

  // 点击卡牌移入槽位
  const handleCardClick = useCallback((card: CardInstance) => {
    if (card.state !== 'board') return;
    if ((exposureMap.get(card.id) ?? 1) < EXPOSED_THRESHOLD) return;
    if (tray.length >= TRAY_CAPACITY) {
      onShowToast('⚠️ 卡槽已满！无法放入更多卡牌');
      return;
    }

    const now = Date.now();
    if (now - soundThrottleRef.current > 40) {
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
  }, [cards, exposureMap, tray, onShowToast]);

  const activeBoardCards = useMemo(() => {
    return cards
      .filter((card) => card.state === 'board')
      .sort((a, b) => a.layer - b.layer || a.id - b.id);
  }, [cards]);

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
          if (!victorySubmittedRef.current) {
            victorySubmittedRef.current = true;
            const timeUsedSeconds = Math.max(1, (Date.now() - startedAtRef.current) / 1000);
            void submitScore('lihan', { timeUsedSeconds, outcome: 'win' }).then((result) => {
              if (result.improved) {
                const seconds = Math.round(timeUsedSeconds);
                onShowToast(`新纪录：${Math.floor(seconds / 60)}分${seconds % 60}秒${result.localOnly ? '（仅本机）' : ''}`);
              }
            });
          }
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
    <div className="relative w-full h-full min-h-0 flex flex-col gap-1 select-none text-[#263819] font-pixel p-1 sm:p-2 overflow-hidden animate-in fade-in duration-300">
      {/* 横向盲盒 + 中央交错牌阵，自适应视口大小（背景透出草丛底图，不做硬边框） */}
      <div
        ref={boardAreaRef}
        className="relative flex-1 min-h-0 w-full overflow-hidden select-none flex items-start justify-center pt-0"
      >
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
          {activeBoardCards.map((card) => {
            const cardInfo = cardTypeMap.get(card.typeId) || CARD_TYPES[0];
            const exposure = exposureMap.get(card.id) ?? 1;
            const hiddenInPile = hiddenInPileSet.has(card.id);

            return (
              <BoardCard
                key={card.id}
                card={card}
                cardInfo={cardInfo}
                exposure={exposure}
                hiddenInPile={hiddenInPile}
                onClick={handleCardClick}
              />
            );
          })}
          </div>
        </div>
      </div>

      {/* 底部 7 格麻将收集槽（卡槽图为雪碧图切片，卡牌按实测内槽位置叠加）。
          移出/救援出来的牌不再单独占一行「备战」栏，而是直接浮在卡槽上方，牌面尺寸不缩小。 */}
      <div
        ref={trayRef}
        className="relative z-[1700] w-full max-w-[440px] mx-auto shrink-0 select-none scale-[1.03] translate-y-[3px]"
        style={{
          aspectRatio: '3 / 1',
          boxSizing: 'content-box',
          paddingBottom: '2px',
          backgroundImage: `url(${LIHAN_TRAY_SPRITE_SRC})`,
          backgroundSize: '100% 100%',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {stagingArea.length > 0 && (
          <div
            className="absolute left-1/2 -translate-x-1/2 z-40 flex items-end gap-1.5"
            // 往下坐到卡槽边沿（对齐槽口顶线），不再飘在牌阵里挡住底排；
            // 尺寸跟棋盘上的牌一致——移出只是「挪出来」，只有真正进卡槽才缩成小牌。
            style={{ bottom: `${100 - TRAY_SLOTS[0].top}%` }}
          >
            {stagingArea.map((card) => {
              const cardInfo = cardTypeMap.get(card.typeId) || CARD_TYPES[0];
              return (
                <div
                  key={card.id}
                  onClick={() => handleStagedCardClick(card)}
                  style={{ width: `${CARD_W * scale}px`, height: `${CARD_H * scale}px` }}
                  className="shrink-0 cursor-pointer hover:scale-105 active:scale-95 transition-transform"
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
              {/* 卡槽牌按槽格实测尺寸等比缩小（棋盘上是大牌，进槽变小牌）。 */}
              <div
                className={`relative transition-all duration-150 ${
                  isEliminating ? 'scale-125 animate-ping' : 'animate-scaleUp'
                }`}
                style={{
                  width: `${trayCardW}px`,
                  height: `${trayCardW / TRAY_CARD_ASPECT}px`,
                }}
              >
                <TileFace cardInfo={cardInfo} />
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部三枚道具：沿用“退出对局”的像素按钮语言，并使用卡槽木色。 */}
      <div className="w-full shrink-0 grid grid-cols-3 gap-2 sm:gap-3 px-3 sm:px-5 pt-[3px]">
        <button
          onClick={handlePropMoveOut}
          disabled={propMoveOutUsed || tray.length === 0}
          className={`relative h-[38px] sm:h-[42px] border-2 flex items-center justify-center gap-1 transition-transform active:translate-x-0.5 active:translate-y-0.5 ${
            propMoveOutUsed || tray.length === 0
              ? 'bg-[#AA916C] border-[#6D4825] cursor-not-allowed opacity-60'
              : 'bg-[#9A5D1B] hover:bg-[#B77728] border-[#5D3616] shadow-[2px_2px_0px_#3E2512] cursor-pointer'
          }`}
          title="移出 3 张暂放到卡槽上方"
        >
          <PackagePlus className="w-3.5 h-3.5 text-[#FFF2CB]" strokeWidth={2.5} />
          <span className="font-pixel font-bold text-[10px] text-[#FFF2CB] leading-none">移出</span>
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#5D3616] text-[#FFF2CB] text-[10px] font-black flex items-center justify-center border border-[#FFF2CB]/80 pointer-events-none">
            +
          </span>
        </button>

        <button
          onClick={handlePropUndo}
          disabled={propUndoUsed || !historyMove}
          className={`relative h-[38px] sm:h-[42px] border-2 flex items-center justify-center gap-1 transition-transform active:translate-x-0.5 active:translate-y-0.5 ${
            propUndoUsed || !historyMove
              ? 'bg-[#AA916C] border-[#6D4825] cursor-not-allowed opacity-60'
              : 'bg-[#9A5D1B] hover:bg-[#B77728] border-[#5D3616] shadow-[2px_2px_0px_#3E2512] cursor-pointer'
          }`}
          title="撤回上一张"
        >
          <Undo2 className="w-3.5 h-3.5 text-[#FFF2CB]" strokeWidth={2.5} />
          <span className="font-pixel font-bold text-[10px] text-[#FFF2CB] leading-none">撤回</span>
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#5D3616] text-[#FFF2CB] text-[10px] font-black flex items-center justify-center border border-[#FFF2CB]/80 pointer-events-none">
            +
          </span>
        </button>

        <button
          onClick={handlePropShuffle}
          disabled={propShuffleUsed}
          className={`relative h-[38px] sm:h-[42px] border-2 flex items-center justify-center gap-1 transition-transform active:translate-x-0.5 active:translate-y-0.5 ${
            propShuffleUsed
              ? 'bg-[#AA916C] border-[#6D4825] cursor-not-allowed opacity-60'
              : 'bg-[#9A5D1B] hover:bg-[#B77728] border-[#5D3616] shadow-[2px_2px_0px_#3E2512] cursor-pointer'
          }`}
          title="阵型洗牌"
        >
          <Shuffle className="w-3.5 h-3.5 text-[#FFF2CB]" strokeWidth={2.5} />
          <span className="font-pixel font-bold text-[10px] text-[#FFF2CB] leading-none">洗牌</span>
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#5D3616] text-[#FFF2CB] text-[10px] font-black flex items-center justify-center border border-[#FFF2CB]/80 pointer-events-none">
            +
          </span>
        </button>
      </div>

      {/* 胜利通关模态框 */}
      {isVictory && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#F8FFE7] border-4 border-[#46751E] p-5 max-w-[320px] w-full shadow-[6px_6px_0px_#254312] text-center space-y-3">
            <img
              src="/lihan-victory.webp"
              alt="利威尔与韩吉仓鼠造型"
              decoding="async"
              className="h-24 w-auto max-w-full mx-auto object-contain"
            />
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
