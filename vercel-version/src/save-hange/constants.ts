/**
 * SAVE HANGE 核心常量
 *
 * 该文件必须保持「零依赖纯 TS」：gameLogic / levels 与关卡验证脚本
 * （scripts/verify-save-hange-levels.ts）都直接依赖它，Node 原生 TS 运行时
 * 只能剥离类型语法，无法处理 JSX / 图片导入 / React。
 */

/** 棋盘宽度（格） */
export const BOARD_WIDTH = 4;

/** 棋盘高度（格） */
export const BOARD_HEIGHT = 5;

/** 唯一救援目标棋子的 id */
export const TARGET_PIECE_ID = 'hange';

/**
 * 出口坐标（韩吉 2×2 的左顶点）。
 * 占据 x = 1~2 且 y = 3~4，即棋盘底部中央两列，与棋盘 UI 上的飞机门完全重合。
 */
export const EXIT_X = 1;
export const EXIT_Y = 3;

/** Bauklötze 终曲资源路径（相对部署子路径，拼接 import.meta.env.BASE_URL 使用） */
export const BGM_ASSET_PATH = 'assets/bauklotze.mp3';

/**
 * 音频元数据尚未就绪时的兜底时长（秒）。
 * 真实对局时间永远取自 audio.currentTime / audio.duration，
 * 该常量只用于「音频还没加载完」时把 UI 初始值显示成终曲全长（3:56）。
 */
export const FALLBACK_TRACK_SECONDS = 236;

/** 与宿主 TatakaruGame 约定的对局 BGM 通知协议（不可改名） */
export const HOST_BGM_MESSAGE_TYPE = 'save-hange-bgm';

/**
 * 与宿主约定的对局结果通知协议。
 * 只有「绝境」难度突围成功才上报 —— 头号玩家只收录绝境难度。
 * 载荷：{ type, difficulty: 'hard', moves, timeUsedSeconds, duration }
 */
export const HOST_RESULT_MESSAGE_TYPE = 'save-hange-result';

/** 唯一进入头号玩家的难度 */
export const RANKED_DIFFICULTY = 'hard';

/** 一次拖拽/点击/按键操作，无论滑动几格，都只记为 1 次移动 */
export const MOVES_PER_OPERATION = 1;
