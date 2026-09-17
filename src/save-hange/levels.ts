/**
 * SAVE HANGE 关卡定义
 *
 * 纯数据 + 纯类型，禁止引入 React / 图片资源，保证 BFS 验证脚本可以直接 import。
 */

export type PieceType = 'target' | 'horizontal' | 'vertical' | 'small';

export interface Piece {
  id: string;
  name: string;
  type: PieceType;
  /** 占位宽（格） */
  w: number;
  /** 占位高（格） */
  h: number;
  /** 左顶点 x（0 ~ 3） */
  x: number;
  /** 左顶点 y（0 ~ 4） */
  y: number;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyConfig {
  id: Difficulty;
  /** 中文难度名（UI 下拉菜单主标题） */
  name: string;
  /** 副标题 */
  sublabel: string;
  /** 英文标签（UI 右上角徽章） */
  tag: string;
  description: string;
  initialPieces: readonly Piece[];
}

/** 简单：韩吉位于中下部，路线较直观 */
export const EASY_LAYOUT: readonly Piece[] = [
  { id: 'hange', name: '韩吉', type: 'target', w: 2, h: 2, x: 1, y: 1 },
  { id: 'founding_eren', name: '始祖巨人', type: 'horizontal', w: 2, h: 1, x: 1, y: 3 },
  { id: 'eren', name: '艾伦', type: 'vertical', w: 1, h: 2, x: 0, y: 0 },
  { id: 'ymir', name: '尤弥尔', type: 'vertical', w: 1, h: 2, x: 3, y: 0 },
  { id: 'floch', name: '弗洛克', type: 'vertical', w: 1, h: 2, x: 0, y: 2 },
  { id: 'zeke', name: '吉克', type: 'vertical', w: 1, h: 2, x: 3, y: 2 },
  { id: 'titan_1', name: '超大型巨人', type: 'small', w: 1, h: 1, x: 1, y: 0 },
  { id: 'titan_2', name: '超大型巨人', type: 'small', w: 1, h: 1, x: 2, y: 0 },
  { id: 'titan_3', name: '超大型巨人', type: 'small', w: 1, h: 1, x: 0, y: 4 },
  { id: 'titan_4', name: '超大型巨人', type: 'small', w: 1, h: 1, x: 3, y: 4 },
];

/** 普通：双侧竖块交错，出口由横块与小块封锁 */
export const NORMAL_LAYOUT: readonly Piece[] = [
  { id: 'hange', name: '韩吉', type: 'target', w: 2, h: 2, x: 1, y: 1 },
  { id: 'founding_eren', name: '始祖巨人', type: 'horizontal', w: 2, h: 1, x: 1, y: 3 },
  { id: 'eren', name: '艾伦', type: 'vertical', w: 1, h: 2, x: 0, y: 0 },
  { id: 'ymir', name: '尤弥尔', type: 'vertical', w: 1, h: 2, x: 3, y: 1 },
  { id: 'floch', name: '弗洛克', type: 'vertical', w: 1, h: 2, x: 0, y: 3 },
  { id: 'zeke', name: '吉克', type: 'vertical', w: 1, h: 2, x: 3, y: 3 },
  { id: 'titan_1', name: '超大型巨人', type: 'small', w: 1, h: 1, x: 1, y: 0 },
  { id: 'titan_2', name: '超大型巨人', type: 'small', w: 1, h: 1, x: 2, y: 0 },
  { id: 'titan_3', name: '超大型巨人', type: 'small', w: 1, h: 1, x: 1, y: 4 },
  { id: 'titan_4', name: '超大型巨人', type: 'small', w: 1, h: 1, x: 2, y: 4 },
];

/** 困难：韩吉被压在左上角，出口附近封锁最重 */
export const HARD_LAYOUT: readonly Piece[] = [
  { id: 'hange', name: '韩吉', type: 'target', w: 2, h: 2, x: 0, y: 0 },
  { id: 'founding_eren', name: '始祖巨人', type: 'horizontal', w: 2, h: 1, x: 0, y: 2 },
  { id: 'eren', name: '艾伦', type: 'vertical', w: 1, h: 2, x: 2, y: 0 },
  { id: 'ymir', name: '尤弥尔', type: 'vertical', w: 1, h: 2, x: 3, y: 0 },
  { id: 'floch', name: '弗洛克', type: 'vertical', w: 1, h: 2, x: 2, y: 2 },
  { id: 'zeke', name: '吉克', type: 'vertical', w: 1, h: 2, x: 3, y: 2 },
  { id: 'titan_1', name: '超大型巨人', type: 'small', w: 1, h: 1, x: 0, y: 3 },
  { id: 'titan_2', name: '超大型巨人', type: 'small', w: 1, h: 1, x: 1, y: 3 },
  { id: 'titan_3', name: '超大型巨人', type: 'small', w: 1, h: 1, x: 0, y: 4 },
  { id: 'titan_4', name: '超大型巨人', type: 'small', w: 1, h: 1, x: 1, y: 4 },
];

export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: {
    id: 'easy',
    name: '简单',
    sublabel: '新兵突破',
    tag: 'EASY',
    description: '守备较为分散，适合快速熟悉突围路线',
    initialPieces: EASY_LAYOUT,
  },
  normal: {
    id: 'normal',
    name: '普通',
    sublabel: '经典阻击',
    tag: 'NORMAL',
    description: '双侧竖块交错，出口由横块与小块封锁',
    initialPieces: NORMAL_LAYOUT,
  },
  hard: {
    id: 'hard',
    name: '困难',
    sublabel: '绝境地鸣',
    tag: 'HARD',
    description: '绝境布局封锁最重，时长同样以终曲为准',
    initialPieces: HARD_LAYOUT,
  },
};

export const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** 每次开新局都从模板深拷贝，避免任何一层意外共享引用 */
export function clonePieces(pieces: readonly Piece[]): Piece[] {
  return pieces.map((piece) => ({ ...piece }));
}
