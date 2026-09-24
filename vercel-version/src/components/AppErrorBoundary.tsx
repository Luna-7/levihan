import React from 'react';

/**
 * 与 index.html / comic.html 里那段内联「部署脱节自愈」脚本共用同一个会话标记，
 * 保证「每次会话最多自动刷一次」，不会刷新循环。
 */
const RELOAD_FLAG = 'lh-auto-reload';

function consumeAutoReload(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === '1') return false;
    sessionStorage.setItem(RELOAD_FLAG, '1');
    return true;
  } catch {
    // 隐私模式下 sessionStorage 不可写：这里保守地不再自动刷（内联脚本已经兜过一次）
    return false;
  }
}

interface Props {
  children: React.ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * 兜底错误边界（主站与漫画站各包一层）。
 *
 * 最常见的触发场景是「部署脱节」：网站刚发新版，而当前页面还在内存里跑旧代码，
 * 懒加载分区去拉已经被删掉的旧 chunk → 404 → React 挂不起来 → 整页白屏。
 * 正常情况下 index.html 的内联脚本已经自动刷新掉了；这一层负责它没接住的两种情况：
 * ① 本会话已经自动刷过一次（守卫挡住了第二次）；② 其他渲染期异常。
 * 效果：最差也只是看到一句「页面版本落后了」+ 一个重新加载按钮，而不是一片白。
 *
 * ⚠️ 本项目没有装 @types/react（其他文件的 React.FC / React.lazy 都是隐式 any），
 * 所以 `this.props` 拿不到类型 —— children 在构造函数里显式存成自有字段。
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  private readonly childNode: React.ReactNode;

  constructor(props: Props) {
    super(props);
    this.childNode = props.children;
  }

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // 留在控制台便于排查；不要把错误信息直接渲染给用户看
    console.error('[AppErrorBoundary]', error);
    if (consumeAutoReload()) {
      window.location.reload();
    }
  }

  render() {
    if (!this.state.failed) return this.childNode;

    return (
      <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center gap-3 p-6 text-center bg-[#F6F1E3] text-[#2C241D]">
        <div className="text-4xl">🥔</div>
        <p className="font-pixel text-sm font-bold">页面版本落后了</p>
        <p className="text-xs text-[#5B4636] max-w-xs leading-relaxed">
          网站刚更新过，当前页面还在用旧文件。点下面按钮重新加载一下就好。
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-[#1E4334] text-[#F9E79F] border-2 border-[#153025] font-pixel text-xs font-bold rounded-xs cursor-pointer hover:bg-[#2B5E4A] shadow-md"
        >
          重新加载
        </button>
      </div>
    );
  }
}
