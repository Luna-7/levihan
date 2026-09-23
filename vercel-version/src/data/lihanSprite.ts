// 卡槽只加载原图底部实际使用的 690×230 区域，避免解码上方未显示的人物素材。
export const LIHAN_TRAY_SPRITE_SRC = '/images/lihan/lihan-tray.webp';
export const LIHAN_TILE_SPRITE_SRC = '/images/lihan/lihan-tiles-clean.webp';

// 卡牌/方块单元格的 background-size（百分比）
export const SPRITE_BG_SIZE = { x: 552.174, y: 433.333 };

// 16 张卡牌的 background-position（百分比），顺序与 CARD_TYPES 对应
export const CARD_SPRITE_POS: { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 25, y: 0 },
  { x: 50, y: 0 },
  { x: 75, y: 0 },
  { x: 0, y: 33.333 },
  { x: 25, y: 33.333 },
  { x: 50, y: 33.333 },
  { x: 75, y: 33.333 },
  { x: 0, y: 66.667 },
  { x: 25, y: 66.667 },
  { x: 50, y: 66.667 },
  { x: 75, y: 66.667 },
  { x: 0, y: 100 },
  { x: 25, y: 100 },
  { x: 50, y: 100 },
  { x: 75, y: 100 },
];

// 方块底（block）的 background-position
export const BLOCK_SPRITE_POS = { x: 100, y: 0 };

// 卡槽 7 个内槽的位置（相对卡槽图百分比）
export const TRAY_SLOTS: { left: number; top: number; width: number; height: number }[] = [
  { left: 5.36, top: 44, width: 10.43, height: 49 },
  { left: 18.12, top: 44, width: 10.87, height: 49 },
  { left: 31.45, top: 44, width: 10.58, height: 49 },
  { left: 44.35, top: 44, width: 10.87, height: 49 },
  { left: 57.54, top: 44, width: 10.72, height: 49 },
  { left: 70.72, top: 44, width: 10.58, height: 49 },
  { left: 83.62, top: 44, width: 10.87, height: 49 },
];
