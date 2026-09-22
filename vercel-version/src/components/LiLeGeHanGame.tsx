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
const BOARD_H = 500;
const TRAY_CAPACITY = 7;
const EXPOSED_THRESHOLD = 0.95;

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

  // 108 张：外层可见牌 54 + 后期环形叠层 36 + 两侧牌堆 14 + 辅助牌 4。
  const generateHardestDeck = useCallback((): CardInstance[] => {
    const newCards: CardInstance[] = [];
    let idCounter = 1;

    const deck: string[] = [];
    CARD_TYPES.forEach((ct, index) => {
      for (let i = 0; i < (index < 12 ? 6 : 9); i++) deck.push(ct.id);
    });

    // 随机充分洗牌
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    const allPos: { x: number; y: number; layer: number; pile?: 'left' | 'right' }[] = [];

    // 开局先露出六列六排及几张分散的上层牌，保留较多选择。
    const layers = [
      { cols: 6, rows: 6, x: 37, y: 99 },
      { cols: 4, rows: 3, x: 83, y: 126 },
    ] as const;
    layers.forEach(({ cols, rows, x, y }, layerIndex) => {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          allPos.push({ x: x + col * 47, y: y + row * 48, layer: layerIndex + 4 });
        }
      }
    });
    for (const [x, y] of [[107, 180], [201, 180], [107, 270], [201, 270]]) {
      allPos.push({ x, y, layer: 6 });
    }
    for (const [x, y] of [[152, 207], [152, 255]]) {
      allPos.push({ x, y, layer: 7 });
    }

    // 四边环埋在外层下方；越往后越集中，最后才逐圈揭开紧密叠牌。
    for (const [layer, dx, dy] of [[1, 0, 0], [2, 12, 12], [3, -12, 24]] as const) {
      const xs = Array.from({ length: 4 }, (_, i) => 70 + i * 50 + dx);
      const top = 140 + dy;
      const bottom = 284 + dy;
      xs.forEach((x) => allPos.push({ x, y: top, layer }));
      for (const y of [top + 48, top + 96]) allPos.push({ x: xs[3], y, layer });
      xs.forEach((x) => allPos.push({ x, y: bottom, layer }));
      for (const y of [top + 48, top + 96]) allPos.push({ x: xs[0], y, layer });
    }

    // 两侧横向牌堆与参考图一致：下层边缘沿水平方向依次露出。
    for (const pile of ['left', 'right'] as const) {
      for (let i = 0; i < 7; i++) {
        allPos.push({ x: pile === 'left' ? 12 + i * 10 : 296 - i * 10, y: 52, layer: 10 + i, pile });
      }
    }

    // 下方四张辅助牌分散摆放，形成前后纵深。
    for (const [x, y] of [[12, 390], [296, 390], [100, 429], [214, 429]]) {
      allPos.push({ x, y, layer: 20 });
    }

    for (let i = 0; i < deck.length && i < allPos.length; i++) {
      newCards.push({
        id: idCounter++,
        typeId: deck[i],
        x: allPos[i].x,
        y: allPos[i].y,
        layer: allPos[i].layer,
        pile: allPos[i].pile,
        state: 'board',
        originBoardState: { x: allPos[i].x, y: allPos[i].y, layer: allPos[i].layer },
      });
    }

    // 开局露出的牌安排八组三消；深层不预排，逐步增加选择压力。
    const initialExposure = calculateExposureMap(newCards);
    const firstLayer = newCards.filter((card) => (initialExposure.get(card.id) ?? 0) >= EXPOSED_THRESHOLD);
    for (let i = firstLayer.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [firstLayer[i], firstLayer[j]] = [firstLayer[j], firstLayer[i]];
    }
    firstLayer.length = Math.min(firstLayer.length, 24);
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
        ref={trayRef}
        className="relative w-full max-w-[440px] mx-auto shrink-0 select-none scale-[1.03]"
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
