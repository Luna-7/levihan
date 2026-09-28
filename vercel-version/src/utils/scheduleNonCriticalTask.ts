/**
 * 首页非关键任务统一调度器。
 * 所有任务共享一条队列，避免 iOS fallback timer 在接近时间集中触发。
 */
type NonCriticalTask = {
  id: number;
  priority: number;
  order: number;
  task: () => void | Promise<void>;
  cancelled: boolean;
};

const START_DELAY_MS = 650;
const TASK_GAP_MS = 420;
let nextId = 1;
let nextOrder = 1;
let startTimer: number | null = null;
let gapTimer: number | null = null;
let running = false;
const queue: NonCriticalTask[] = [];

const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
const clearScheduledTimer = () => {
  if (startTimer !== null) window.clearTimeout(startTimer);
  if (gapTimer !== null) window.clearTimeout(gapTimer);
  startTimer = null;
  gapTimer = null;
};

const pump = () => {
  if (running || !isVisible() || queue.length === 0) return;
  queue.sort((a, b) => a.priority - b.priority || a.order - b.order);
  const item = queue.shift();
  if (!item || item.cancelled) {
    pump();
    return;
  }
  running = true;
  Promise.resolve()
    .then(() => item.cancelled ? undefined : item.task())
    .catch(() => undefined)
    .finally(() => {
      running = false;
      if (isVisible() && queue.length > 0) {
        gapTimer = window.setTimeout(() => {
          gapTimer = null;
          pump();
        }, TASK_GAP_MS);
      }
    });
};

const resumeQueue = () => {
  if (!isVisible() || running || queue.length === 0 || startTimer !== null || gapTimer !== null) return;
  pump();
};

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', resumeQueue, { passive: true });
}

/**
 * priority 越小越早执行。旧 delay 参数保留兼容性，但不再为每个组件创建独立 timer。
 */
export function scheduleNonCriticalTask(
  task: () => void | Promise<void>,
  _delayMs = START_DELAY_MS,
  priority = 10,
): () => void {
  const item: NonCriticalTask = { id: nextId++, priority, order: nextOrder++, task, cancelled: false };
  queue.push(item);
  if (startTimer === null && gapTimer === null && !running) {
    startTimer = window.setTimeout(() => {
      startTimer = null;
      resumeQueue();
    }, START_DELAY_MS);
  }
  return () => {
    item.cancelled = true;
    const index = queue.findIndex((queued) => queued.id === item.id);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0 && !running) clearScheduledTimer();
  };
}
