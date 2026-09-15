import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { soundManager } from '../utils/audio';
import { RotateCcw, Undo2, Shuffle, PackagePlus } from 'lucide-react';

export interface CardType {
  id: string;
  name: string;
  imageSrc: string;
}

const TILE_BG = '/images/lihan/block_bg.png';
const TILE_MASK = '/images/lihan/blackMask.png';

export const CARD_TYPES: CardType[] = Array.from({ length: 16 }, (_, index) => {
  const number = index + 1;
  return {
    id: `card-${number}`,
    name: `卡片${number}`,
    imageSrc: `/images/lihan/card-${number}.png`,
  };
});

const TileFace: React.FC<{ cardInfo: CardType; isCovered?: boolean }> = ({ cardInfo, isCovered = false }) => (
  <div
    className="relative w-full h-full overflow-hidden rounded-[4px] shadow-[1px_2px_0px_#233D12]"
    style={{ backgroundImage: `url(${TILE_BG})`, backgroundSize: '100% 100%' }}
    aria-label={isCovered ? '未揭开的麻将牌' : cardInfo.name}
  >
    {!isCovered && (
      <img
        src={cardInfo.imageSrc}
        alt=""
        className="absolute inset-[3px] w-[calc(100%-6px)] h-[calc(100%-8px)] object-contain pointer-events-none"
        draggable={false}
      />
    )}
    {isCovered && (
      <img src={TILE_MASK} alt="" className="absolute inset-0 w-full h-full pointer-events-none" draggable={false} />
    )}
  </div>
);

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

    // 参考图构图：顶部左右横向盲盒，中央五列交错牌阵，左右独立侧列。
    // 横向盲盒的牌底只露出窄边，末张正面朝外。
    for (let i = 0; i < 10; i++) {
      allPos.push({ x: 44 + i * 5, y: 16, layer: i + 2 });
      allPos.push({ x: 274 - i * 8, y: 16, layer: i + 2 });
    }

    // 中央 5 × 7 棋盘。微小交叠和前后层级形成参考图的灰色暗牌层。
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        allPos.push({
          x: 68 + col * 44,
          y: 82 + row * 43,
          layer: (row + col) % 2,
        });
      }
    }

    // 左右侧列留出空隙，形成参考图中的开阔轮廓。
    for (let row = 0; row < 7; row++) {
      allPos.push({ x: 12, y: 83 + row * 50, layer: 2 });
      allPos.push({ x: 263, y: 83 + row * 50, layer: 2 });
    }

    // 三张前景牌压在中央核心上，增加层叠的视觉焦点。
    allPos.push({ x: 108, y: 194, layer: 13 });
    allPos.push({ x: 152, y: 194, layer: 13 });
    allPos.push({ x: 196, y: 194, layer: 13 });

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
      const nextScale = Math.min((width - 12) / 320, (height - 16) / 445, 1.6);
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
      {/* 横向盲盒 + 中央交错牌阵，自适应视口大小 */}
      <div
        ref={boardAreaRef}
        className="relative flex-1 min-h-0 w-full border-2 sm:border-3 border-[#82B94D] overflow-hidden select-none flex items-center justify-center"
        style={{
          background: 'radial-gradient(circle at 50% 38%, #D0FFA5 0%, #B9FB84 72%, #A5E96F 100%)',
        }}
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
            height: '445px',
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
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

      {/* 底部 7 格麻将收集槽 */}
      <div className="w-full shrink-0 bg-[#9A632A] border-3 sm:border-4 border-[#704110] p-1 shadow-[3px_3px_0px_#704110]">
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1 bg-[#8B501C] border-2 border-[#C48332] p-0.5 sm:p-1 items-center"
          style={{ height: 'clamp(42px, 12vw, 66px)' }}>
          {Array.from({ length: TRAY_CAPACITY }).map((_, index) => {
            const card = tray[index];
            if (card) {
              const cardInfo = cardTypeMap.get(card.typeId) || CARD_TYPES[0];
              const isEliminating = eliminatingIds.includes(card.id);

              return (
                <div
                  key={card.id}
                  className={`w-full h-full select-none transition-all duration-150 ${
                    isEliminating ? 'scale-125 animate-ping' : 'animate-scaleUp'
                  }`}
                >
                  <TileFace cardInfo={cardInfo} />
                </div>
              );
            }

            return (
              <div
                key={`empty-${index}`}
                className="w-full h-full border border-dashed border-[#B47733] bg-[#6E3D16]/45"
              />
            );
          })}
        </div>
      </div>

      {/* 底部三大道具栏 (彻底删除所有类似 "悔棋1张 (1/1)", "空出3格 (1/1)", "打破死局 (1/1)" 等复杂副标题设计) */}
      <div className="w-full shrink-0 grid grid-cols-3 gap-1 sm:gap-2">
        <button
          onClick={handlePropMoveOut}
          disabled={propMoveOutUsed || tray.length === 0}
          className={`min-h-[40px] sm:min-h-[44px] py-1 px-1 border-2 flex items-center justify-center gap-1 transition-all ${
            propMoveOutUsed || tray.length === 0
              ? 'bg-[#263819] text-[#80936D] border-[#527729] cursor-not-allowed opacity-50'
              : 'bg-[#168DEB] hover:bg-[#33A3F0] text-white border-[#07539B] shadow-[2px_3px_0px_#163B2E] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer'
          }`}
          title="移出"
        >
          <PackagePlus className="w-4 h-4 text-[#FFC83D]" />
          <span className="font-bold text-xs">移出</span>
        </button>

        <button
          onClick={handlePropUndo}
          disabled={propUndoUsed || !historyMove}
          className={`min-h-[40px] sm:min-h-[44px] py-1 px-1 border-2 flex items-center justify-center gap-1 transition-all ${
            propUndoUsed || !historyMove
              ? 'bg-[#263819] text-[#80936D] border-[#527729] cursor-not-allowed opacity-50'
              : 'bg-[#168DEB] hover:bg-[#33A3F0] text-white border-[#07539B] shadow-[2px_3px_0px_#163B2E] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer'
          }`}
          title="撤回"
        >
          <Undo2 className="w-4 h-4 text-[#FFC83D]" />
          <span className="font-bold text-xs">撤回</span>
        </button>

        <button
          onClick={handlePropShuffle}
          disabled={propShuffleUsed}
          className={`min-h-[40px] sm:min-h-[44px] py-1 px-1 border-2 flex items-center justify-center gap-1 transition-all ${
            propShuffleUsed
              ? 'bg-[#263819] text-[#80936D] border-[#527729] cursor-not-allowed opacity-50'
              : 'bg-[#168DEB] hover:bg-[#33A3F0] text-white border-[#07539B] shadow-[2px_3px_0px_#163B2E] active:translate-x-0.5 active:translate-y-0.5 cursor-pointer'
          }`}
          title="洗牌"
        >
          <Shuffle className="w-4 h-4 text-[#FFC83D]" />
          <span className="font-bold text-xs">洗牌</span>
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
                onClick={onBack}
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
                onClick={onBack}
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
