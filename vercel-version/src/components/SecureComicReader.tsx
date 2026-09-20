import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as CryptoJsNamespace from 'crypto-js';
import * as pdfjsLib from 'pdfjs-dist';
// ?url 让 Vite 把 1MB 的 worker 原样 emit 成 assets/ 下的一个文件并返回其 URL（同源，走站点自己的 CDN）
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import type { DoujinBookItem } from '../types/doujinArchive';
import { cosService } from '../services/cosClient';

/**
 * ============================================================================
 * SecureComicReader —— 敏感本子的「403 伪装页 + 一密双解 + Canvas 瀑布流」
 * ----------------------------------------------------------------------------
 * 与 public/admin/secure-upload.js 配套：管理台勾选「含有敏感元素」上传后，
 * COS 上留下的是 comic_vault/{id}_secure.txt（AES-256-CBC 密文，伪装成纯文本），
 * 站点上不给任何图片或 .pdf 直链，必须由本组件在浏览器内存里解开才看得到。
 *
 * 解密是两层，共用一个密码（"一密双解"）：
 *   外层：crypto-js 解 AES-256-CBC —— key = SHA-256(密码)，IV = 'levihan-vault-iv'
 *         解出来**直接就是 PDF 的二进制字节**（不要再做一次 Base64 解码）
 *   内层：把同一个密码透传给 pdfjs 的 password 参数，解 jsPDF 施加的 PDF 标准口令
 *         若管理台上传的是图片（内层没加口令），多传这个参数会被 pdf.js 忽略 —— 都成立
 *
 * ⚠️ 诚实的边界：这套东西挡的是"顺手另存 / 右键查看 / 简易爬虫"，
 *    不是密码学意义上的机密。密码、IV 都在前端代码里，任何人都能离线解开。
 *    下面那些禁用右键 / F12 的代码同理 —— 提高门槛，不构成安全防线。
 * ============================================================================
 */

/** 统一 IV：16 字节 ASCII，改这里会解不开历史密文 */
const IV_UTF8 = 'levihan-vault-iv';
/** 密文目录与文件名规则，必须和 secure-upload.js 的 buildVaultKey() 完全一致 */
const VAULT_DIR = 'comic_vault';

/**
 * PDF.js 的 worker：版本必须与依赖里的 pdfjs-dist 严格一致，否则会解析错乱
 * （?url 直接指向 node_modules 里那个 3.11.174 的 worker，天然同步）。
 *
 * 曾经**刻意**走第三方 CDN 以免在 Vite 里配 ?url —— 实测这个取舍是错的：
 * 那家 CDN 上 1MB 的 worker 单请求就要数秒（320KB 的 pdf.min.js 尚需 2.7~3.0s），
 * 手机网络下更慢，而 worker 没下载完这本就打不开，症状是「一直卡在解密/加载中」。
 * 改成随包发布后：同源、走站点自己的 CDN，且与 CloudBase 管理台用的是同一份字节。
 */
const PDFJS_WORKER_SRC = pdfWorkerUrl;

/**
 * CJS/ESM 互操作兜底。
 * crypto-js 是 UMD 包，不同打包器对 `import * as X` 的展开方式不一致：
 * 有的把具名导出摊平（X.AES 可用），有的只给一个 default（要取 X.default.AES）。
 * 这里两种都兼容，避免"本地能跑、线上白屏"这类只在构建期暴露的问题。
 */
const CryptoJS = ((CryptoJsNamespace as unknown as { default?: typeof CryptoJsNamespace }).default ??
  CryptoJsNamespace) as unknown as typeof CryptoJsNamespace;

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;

type SecureComicReaderProps = {
  book: DoujinBookItem;
  onClose: () => void;
  onShowToast?: (msg: string) => void;
};

type Phase = 'locked' | 'working' | 'ready';

/** 密文直链：comic_vault/{id}_secure.txt */
export const getSecureVaultUrl = (book: DoujinBookItem): string =>
  cosService.getObjectUrl(`${VAULT_DIR}/${String(book.id).replace(/[^A-Za-z0-9_-]/g, '')}_secure.txt`);

/** WordArray → Uint8Array（crypto-js 的输出格式转成 pdf.js 能吃的二进制） */
function wordArrayToBytes(wordArray: { words: number[]; sigBytes: number }): Uint8Array {
  const { words, sigBytes } = wordArray;
  const out = new Uint8Array(sigBytes);
  for (let i = 0; i < sigBytes; i += 1) {
    out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
}

/** PDF 文件头魔数：解出来必须是个 PDF，否则宁可直接失败也不要把乱码喂给 pdf.js */
function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/** 外层解密：密文 Base64 文本 → PDF 字节流（密码由用户输入，外壳密码就是 'levihan'） */
function decryptOuterLayer(cipherTextBase64: string, password: string): Uint8Array {
  const key = CryptoJS.SHA256(password);
  const iv = CryptoJS.enc.Utf8.parse(IV_UTF8);
  const decrypted = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(cipherTextBase64) }),
    key,
    { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
  );
  return wordArrayToBytes(decrypted);
}

/* ============================================================================
 * 单页 Canvas：进入视口才画，远离视口就把画布内容抹掉
 * 抹掉有两个作用：① 长本子不会把几十张全尺寸画布同时留在内存里；
 *                ② 想靠"一路滚到底再批量另存"来整本扒走的人拿不到完整内容。
 * ========================================================================== */
const SecureCanvasPage: React.FC<{ doc: any; pageNumber: number }> = ({ doc, pageNumber }) => {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [aspect, setAspect] = useState(1.4); // 占位高度，避免滚动条乱跳
  const [failed, setFailed] = useState(false);

  // 上下留足余量：可见前后各提前一屏开始画，离开两屏后才清
  useEffect(() => {
    const el = holderRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { root: null, rootMargin: '120% 0px 120% 0px', threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !visible) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;

    const draw = async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        // 1.6 倍渲染 + CSS 拉满宽度：在清晰度和内存之间取平衡
        const viewport = page.getViewport({ scale: 1.6 });
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        setAspect(viewport.height / viewport.width);

        task = page.render({ canvasContext: ctx, viewport });
        await task.promise;
      } catch (err: any) {
        // 渲染被打断（快速滚动、切页、卸载）是常态，不算失败
        if (err && (err.name === 'RenderingCancelledException' || err.name === 'AbortException')) return;
        if (!cancelled) setFailed(true);
      }
    };

    void draw();

    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        /* 已结束的渲染任务取消会抛错，忽略 */
      }
    };
  }, [doc, pageNumber, visible]);

  // 离开视口后清空画布：抹掉像素，同时释放这块位图内存
  useEffect(() => {
    if (visible) return;
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
  }, [visible]);

  return (
    <div
      ref={holderRef}
      className="w-full max-w-3xl mx-auto bg-white shadow-[0_1px_0_rgba(0,0,0,.08)]"
      data-page={pageNumber}
    >
      {!visible && <div aria-hidden="true" style={{ paddingBottom: `${aspect * 100}%` }} />}
      {failed ? (
        <div className="py-12 text-center font-mono text-xs text-[#8892a4]">
          第 {pageNumber} 页渲染失败 · 请刷新后重试
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          className="w-full h-auto block select-none"
          style={{ display: visible ? 'block' : 'none', WebkitTouchCallout: 'none' }}
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}
    </div>
  );
};

export const SecureComicReader: React.FC<SecureComicReaderProps> = ({ book, onClose, onShowToast }) => {
  const [phase, setPhase] = useState<Phase>('locked');
  const [code, setCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [doc, setDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const docRef = useRef<any>(null);

  /* ---------------- 反爬与防手滑：只在阅读器挂载期间生效 ---------------- */
  useEffect(() => {
    const prevContextMenu = document.oncontextmenu;
    const prevDragStart = document.ondragstart;

    document.oncontextmenu = () => false;
    document.ondragstart = () => false;

    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const blocked =
        k === 'f12' ||
        (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(k)) ||
        (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(k)) ||
        ((e.ctrlKey || e.metaKey) && k === 'u') ||
        ((e.ctrlKey || e.metaKey) && k === 's');
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.oncontextmenu = prevContextMenu;
      document.ondragstart = prevDragStart;
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  // 组件卸载时销毁 pdf 文档，释放 worker 里的那份数据
  useEffect(
    () => () => {
      try {
        docRef.current?.destroy();
      } catch {
        /* 已销毁则忽略 */
      }
    },
    [],
  );

  /** 输入即清掉上一次的报错，避免误导 */
  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCode(e.target.value);
    if (errorMsg) setErrorMsg('');
  };

  /**
   * 启动解析：拉密文 → 解外层 → 用同一个密码解锁内层。
   * 全程在内存里完成，不产生任何 .pdf 文件或直链。
   */
  const handleUnlock = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (phase === 'working') return;

      const password = code.trim();
      if (!password) {
        setErrorMsg('校验码不能为空');
        return;
      }

      setPhase('working');
      setErrorMsg('');

      try {
        // ① 从 COS 取回伪装成 .txt 的密文
        const url = getSecureVaultUrl(book);
        const res = await fetch(url, { mode: 'cors', cache: 'no-store' });
        if (!res.ok) throw new Error(`节点返回 HTTP ${res.status}`);
        const cipherText = (await res.text()).trim();
        if (!cipherText) throw new Error('节点数据为空');

        // ② 解外层 AES-256-CBC（纯内存；解出来就是 PDF 二进制）
        const pdfBytes = decryptOuterLayer(cipherText, password);
        if (!looksLikePdf(pdfBytes)) throw new Error('校验码不匹配');

        // ③ 解内层 PDF 标准口令：同一个密码直接透传
        const task = pdfjsLib.getDocument({ data: pdfBytes, password });
        const loaded = await task.promise;

        docRef.current = loaded;
        setDoc(loaded);
        setNumPages(loaded.numPages);
        setPhase('ready');
        onShowToast?.(`《${book.titleZh}》节点解析完成，共 ${loaded.numPages} 页`);
      } catch (err: any) {
        // 失败文案也保持在"系统页"的语境里，不暴露加密方式与文件类型
        const raw = String(err?.message || err);
        let friendly = '解析失败，请稍后重试。';
        if (/password|校验码|Malformed|不匹配|empty/i.test(raw) || err?.name === 'PasswordException') {
          friendly = '校验码无效，节点拒绝解析。';
        } else if (/HTTP|Failed to fetch|NetworkError/i.test(raw)) {
          friendly = '安全节点未响应，请检查网络后重试。';
        }
        setErrorMsg(friendly);
        setPhase('locked');
      }
    },
    [book, code, onShowToast, phase],
  );

  /* ========================== 403 伪装界面 ========================== */
  if (phase !== 'ready') {
    return (
      <div className="w-full min-h-[70vh] bg-[#f2f3f5] text-[#3c4043] font-mono">
        <div className="max-w-3xl mx-auto px-5 py-10 sm:py-16">
          {/* 顶部：模仿标准 Web 服务器报错页的字段表 */}
          <div className="border border-[#d8dade] bg-white">
            <div className="px-5 py-3 border-b border-[#e4e6e9] bg-[#fafbfc] flex items-center justify-between">
              <span className="text-[13px] font-bold tracking-wide text-[#5f6368]">SECURE NODE GATEWAY</span>
              <span className="text-[11px] text-[#9aa0a6]">node-isolated / sandbox-v2</span>
            </div>

            <div className="px-5 py-6 sm:px-8 sm:py-8">
              <h1 className="text-[30px] sm:text-[38px] font-bold text-[#1f2328] leading-none">403 Forbidden</h1>
              <p className="mt-3 text-[13px] text-[#5f6368]">
                Requested resource is not served by this node.
              </p>

              <table className="mt-6 w-full text-[12px] border-t border-[#e4e6e9]">
                <tbody>
                  {[
                    ['Node ID', 'CN-NANJING-EDGE-07'],
                    ['Resource ID', book.id],
                    ['Access Policy', 'ARCHIVED / ISOLATED'],
                    ['Request Time', new Date().toISOString()],
                  ].map(([k, v]) => (
                    <tr key={k} className="border-b border-[#eef0f2]">
                      <td className="py-2 pr-4 w-[38%] text-[#9aa0a6] align-top">{k}</td>
                      <td className="py-2 text-[#3c4043] break-all">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-6 border-l-[3px] border-[#c5221f] bg-[#fce8e6] px-4 py-3 text-[12.5px] leading-6 text-[#8c1d18]">
                ⚠️ 资源已被加密归档。由于版权或节点搬迁，该资源已移至安全隔离沙箱。
                请输入社群专享「安全校验码」进行本地节点数据解析。
              </div>

              {/* 解析表单：文案全程不提"密码""漫画" */}
              <form onSubmit={handleUnlock} className="mt-6 flex flex-col sm:flex-row gap-2.5">
                <input
                  type="password"
                  value={code}
                  onChange={handleCodeChange}
                  placeholder="输入专属安全校验码"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={phase === 'working'}
                  className="flex-1 px-3.5 py-2.5 text-[13px] bg-white border border-[#c9ccd1] rounded-[3px] text-[#1f2328] placeholder:text-[#9aa0a6] focus:outline-none focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20 disabled:bg-[#f5f6f7]"
                />
                <button
                  type="submit"
                  disabled={phase === 'working'}
                  className="px-5 py-2.5 text-[13px] font-bold rounded-[3px] bg-[#1f2328] text-white hover:bg-[#33383f] disabled:bg-[#9aa0a6] disabled:cursor-wait transition-colors"
                >
                  {phase === 'working' ? '解析中…' : '启动解析'}
                </button>
              </form>

              <div className="mt-3 text-[11.5px] text-[#9aa0a6]">
                提示：兵长与韩吉的cp名。
              </div>

              {errorMsg && (
                <div className="mt-4 text-[12px] text-[#c5221f]">✗ {errorMsg}</div>
              )}

              <div className="mt-8 pt-4 border-t border-[#eef0f2] text-[10.5px] leading-5 text-[#b0b5bb]">
                本节点仅提供本地内存解析，不生成任何可下载文件。
                <br />
                Error code: ERR_RESOURCE_ISOLATED · Reference: 18.9a4f2c
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between text-[11px] text-[#9aa0a6]">
            <span>© secure-node gateway · 本站为社区归档节点</span>
            <button type="button" onClick={onClose} className="hover:text-[#5f6368] underline underline-offset-2">
              ← 返回归档列表
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ========================== 解析成功后的阅读容器 ========================== */
  const pages = Array.from({ length: numPages }, (_, i) => i + 1);

  return (
    <div
      id="secure-doujin-reader"
      className="w-full bg-[#15181b] pb-16 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 顶部状态条：伪装成"节点会话"，同时给出唯一的一条退出路径 */}
      <div className="sticky top-0 z-20 bg-[#1c2024]/95 backdrop-blur border-b border-[#2b3137]">
        <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3 font-mono text-[11px] text-[#8b949e]">
          <span className="truncate">
            <span className="text-[#3fb950]">●</span> 沙箱会话已建立 · {book.id} · {numPages}P
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 px-3 py-1 border border-[#30363d] rounded-sm text-[#c9d1d9] hover:bg-[#262c31] transition-colors"
          >
            结束会话
          </button>
        </div>
      </div>

      <div className="pt-3 space-y-3">
        {pages.map((n) => (
          <SecureCanvasPage key={n} doc={doc} pageNumber={n} />
        ))}
      </div>

      <p className="max-w-3xl mx-auto mt-8 px-4 text-center font-mono text-[10.5px] text-[#6e7681]">
        内容仅在本机内存中渲染。请勿截图外传。
      </p>
    </div>
  );
};

export default SecureComicReader;
