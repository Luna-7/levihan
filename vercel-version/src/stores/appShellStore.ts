import { create } from 'zustand';
import type { NavigationTab } from '../types';

/**
 * 应用外壳层共享状态：当前分区、跨分区跳转意图、全局 toast、登录弹窗动作。
 *
 * 这是报告里「多份状态各自维护 + 隐式事件通信」治理的第 2 步：
 * 用单一 store 取代 window.dispatchEvent 的隐式事件，让调用方与接收方
 * 拥有类型约束，重构名称或调整挂载时机不再会静默失效。
 *
 * 边界原则：
 * - 切页动画的临时计时状态（departingTab 等）仍留在 App 布局组件；
 * - 音频静音状态由 soundManager 承担，本 store 不复制一份（避免不同步）；
 * - 网络请求仍走各自 API 服务，本 store 不碰数据。
 */

const VALID_TABS: NavigationTab[] = ['home', 'resources', 'doujinshi', 'dispatch'];

function resolveInitialTab(): NavigationTab {
  if (typeof window === 'undefined') return 'home';
  const tab = new URLSearchParams(window.location.search).get('tab');
  return tab && (VALID_TABS as string[]).includes(tab) ? (tab as NavigationTab) : 'home';
}

type AppShellState = {
  activeTab: NavigationTab;
  /** 跨分区跳转意图：接龙合订本 → 巨树餐厅（典藏阁） */
  pendingDoujinOpen: number;
  /** 跳转意图：首页「今日上新」→ 切到「小说本」分类 */
  pendingNovelCategory: number;
  /** 需要自动打开的指定合订本 ID */
  pendingNovelId: string | null;
  /** 全局 toast 文案；null 表示不显示 */
  toast: string | null;
  /** 登录弹窗打开动作的单调递增信号；每次 +1 触发 UserEntry 打开 */
  loginRequest: number;
  /** 小说索引已变化的单调递增信号；每次 +1 触发典藏阁重拉 novels.json */
  novelIndexVersion: number;

  navigate: (tab: NavigationTab) => void;
  openDoujinArchive: () => void;
  openNovelCategory: () => void;
  openNovel: (id: string) => void;
  clearPendingNovel: () => void;
  showToast: (msg: string) => void;
  dismissToast: () => void;
  openLogin: () => void;
  invalidateNovelIndex: () => void;
};

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useAppShellStore = create<AppShellState>((set) => ({
  activeTab: resolveInitialTab(),
  pendingDoujinOpen: 0,
  pendingNovelCategory: 0,
  pendingNovelId: null,
  toast: null,
  loginRequest: 0,
  novelIndexVersion: 0,

  navigate: (tab) => {
    set((state) => (state.activeTab === tab ? {} : { activeTab: tab }));
    if (typeof window !== 'undefined') {
      // 让 URL 与当前分区保持一致，支持浏览器前进/后退与分享直达。
      const url = new URL(window.location.href);
      if (tab === 'home') url.searchParams.delete('tab');
      else url.searchParams.set('tab', tab);
      window.history.replaceState(null, '', url.toString());
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  },

  openDoujinArchive: () => set((state) => ({ pendingDoujinOpen: state.pendingDoujinOpen + 1 })),
  openNovelCategory: () => set((state) => ({ pendingNovelCategory: state.pendingNovelCategory + 1 })),
  openNovel: (id) => set((state) => ({
    pendingDoujinOpen: state.pendingDoujinOpen + 1,
    pendingNovelCategory: state.pendingNovelCategory + 1,
    pendingNovelId: id,
  })),
  clearPendingNovel: () => set({ pendingNovelId: null }),

  showToast: (msg) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => {
      set({ toast: null });
      toastTimer = null;
    }, 2800);
  },

  dismissToast: () => {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    set({ toast: null });
  },

  openLogin: () => set((state) => ({ loginRequest: state.loginRequest + 1 })),

  invalidateNovelIndex: () => set((state) => ({ novelIndexVersion: state.novelIndexVersion + 1 })),
}));
