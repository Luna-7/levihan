/*!
 * ============================================================================
 * secure-upload.js — 漫画 / 文档「深度加密直传腾讯云 COS」业务流水线
 * ----------------------------------------------------------------------------
 * 落点：vercel-version/public/admin/index.html（管理台上传台）
 * 依赖：jspdf（页面已从 CDN 引入，用于图片合并 PDF）
 *       cos-js-sdk-v5（需新增，用于浏览器直传 COS；缺失时自动降级为中转上传）
 *
 * 流水线四步（与产品需求一一对应）：
 *   ① 交互：勾选「含有敏感元素」→ 走本模块；未勾选 → 走原有 uploadAll()
 *   ② 预处理：多张图片 →（纯浏览器内存）合并成一份标准 PDF；输入本就是 PDF 则跳过
 *   ③ 强拦截 + 强加密：在调用 COS 接口之前拦下 PDF 数据流，
 *      AES-256-CBC（key = SHA-256("levihan")，固定 IV）→ Base64
 *      → new Blob([base64], { type: 'text/plain' })，%PDF- 文件头被彻底打碎
 *   ④ 伪装 + 上传：Key 抹掉 .pdf/.jpg 后缀、强改为 .txt；
 *      Body 换成密文 Blob → cos.putObject
 *
 * 【等价的 CyberChef Recipe】——可直接粘进 https://gchq.github.io/CyberChef/ 复核
 *   1) SHA2          (Size: 256)                                  ← 派生 32 字节密钥
 *   2) AES Encrypt   (Mode: CBC, Key: Hex, IV: UTF8, Input: Raw, Output: Raw)
 *   3) To Base64
 *   密钥 Hex = SHA-256("levihan") 的十六进制；IV = "levihan-vault-iv"（16 字节 ASCII）
 *
 * 【安全边界，务必知悉】
 *   - 这是一个"固定外壳密码"方案：密码、密钥派生方式与 IV 都写在前端代码里，
 *     任何拿到本文件的人都能解密。它的真实作用是：让对象存储里的文件**不可直接预览、不可被
 *     爬虫/静态目录识别、脱离本站无法阅读**，而不是抵御有心的攻击者。
 *     若要真正的机密性，密钥必须来自服务端（每本一密、随管理员登录态下发）。
 *   - 固定 IV + 固定密钥 ⇒ 相同明文前缀会产生相同密文前缀。漫画 PDF 之间差异极大，
 *     实际泄露可以忽略；如要彻底消除，把 CONFIG.RANDOM_IV 打开（见下方注释，届时不再与
 *     CyberChef 的固定 IV 配方等价）。
 * ============================================================================
 */
(function (root) {
  'use strict';

  // 内层工厂直接闭包引用 root —— 早期写法把 root 作为外层 IIFE 的形参、
  // 却在工厂函数体里使用它，浏览器运行时会在 getJsPdfCtor() 处抛 root is not defined。
  var api = (function () {

  /* ==========================================================================
   * 0. 常量与配置
   * ======================================================================== */
  var CONFIG = {
    /** 全局统一的外壳加密密码（需求指定，固定字符串） */
    SHELL_PASSWORD: 'levihan',
    /** 统一 IV 向量：必须是 16 字节 ASCII（AES 分组长度），改这里会破坏与旧密文的兼容 */
    IV_UTF8: 'levihan-vault-iv',
    /** 密文落库的"伪装目录" */
    VAULT_PREFIX: 'comic_vault',
    /** 强改后缀：抹掉一切图片 / .pdf 后缀，统一伪装成纯文本 */
    KEY_SUFFIX: '_secure.txt',
    /**
     * Key 是否带时间戳。
     *   true  → comic_vault/1758252800000_secure.txt（需求原文示例；每次上传产生新对象，旧对象成孤儿）
     *   false → comic_vault/lh-123_secure.txt（同名覆盖，幂等重传；且阅读端可仅凭 bookId 反推 Key，
     *           无需改动 archive 表结构 —— 现有云函数 normalizeBook() 是字段白名单，透传不了 vaultKey）
     * 默认取 false 就是这个原因；需要按需求原文行为时置 true 即可。
     */
    VERSIONED_KEY: false,
    /** 是否使用"每文件随机 IV"（前 16 字节随密文一起存，非 CyberChef 固定 IV 配方） */
    RANDOM_IV: false,
    /** 单次流水线的输入总量上限（图片合并前 / PDF 原文件） */
    MAX_INPUT_BYTES: 60 * 1024 * 1024,
    /** 单页像素长边上限，超长图（如 webtoon 条漫）会被等比缩小以避开 PDF 尺寸限制 */
    MAX_PAGE_PX: 12000,
    /** 图片重编码质量（仅用于需要转 JPEG 的源图，PNG 走无损通道） */
    JPEG_QUALITY: 0.92,
    /**
     * 上传通道：
     *   'auto'  → 优先 cos-js-sdk-v5 浏览器直传；凭证接口不可用时降级为中转上传
     *   'sdk'   → 强制浏览器直传（需要云函数提供 action:'cosCredential'）
     *   'proxy' → 强制走云函数中转（需要云函数提供 action:'vaultUpload'）
     */
    UPLOAD_MODE: 'auto',
    /** COS 桶信息（与管理台 / doujinArchiveData.ts 保持一致） */
    COS: {
      Bucket: 'levihan-1325571558',
      Region: 'ap-nanjing',
      CdnBase: 'https://levihan-1325571558.cos-website.ap-nanjing.myqcloud.com',
    },
    /** 密文对象的 Content-Type：伪装成纯文本 */
    CIPHER_CONTENT_TYPE: 'text/plain; charset=utf-8',
    CacheControl: 'public, max-age=31536000',
  };

  /** 运行时注入项（由页面在启动时调用 configure 填入） */
  var runtime = {
    /** 云函数 HTTP 访问地址；留空则读取 window.LEVIHAN_FN_URL */
    apiEndpoint: '',
    /** 返回管理员 token 的函数（中转上传需要） */
    getToken: function () { return ''; },
  };

  var cosInstance = null;      // cos-js-sdk-v5 实例（懒加载，凭证自动续期）
  var cachedCredential = null; // 最近一次拿到的临时凭证

  /* ==========================================================================
   * 1. 基础设施：运行时注入、断言、字节 / Base64 互转
   * ======================================================================== */

  /** 注入页面上下文（避免本模块硬编码云函数地址与 token 变量名） */
  function configure(options) {
    options = options || {};
    if (options.apiEndpoint) runtime.apiEndpoint = String(options.apiEndpoint);
    if (typeof options.getToken === 'function') runtime.getToken = options.getToken;
    if (options.cos) Object.assign(CONFIG.COS, options.cos);
    ['VERSIONED_KEY', 'RANDOM_IV', 'UPLOAD_MODE', 'MAX_INPUT_BYTES', 'VAULT_PREFIX', 'KEY_SUFFIX'].forEach(function (k) {
      if (options[k] !== undefined) CONFIG[k] = options[k];
    });
    return CONFIG;
  }

  /** WebCrypto 只能在安全上下文（https / localhost）里用；file:// 打开管理台会拿不到 */
  function getSubtle() {
    var c = (typeof globalThis !== 'undefined' ? globalThis : {}).crypto;
    if (!c || !c.subtle) {
      throw new Error('当前上下文没有可用的 WebCrypto（crypto.subtle）。请通过 https 或 localhost 打开管理台，不要用 file:// 直接双击打开。');
    }
    return c.subtle;
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(str);
    throw new Error('缺少 TextEncoder，浏览器版本过低。');
  }

  /** 人类可读的体积文案（用于进度提示） */
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  /**
   * Uint8Array → Base64。
   * 必须分块做：几十 MB 的文件直接 String.fromCharCode.apply(null, bytes)
   * 会撑爆调用栈（RangeError: Maximum call stack size exceeded）。
   */
  function bytesToBase64(bytes) {
    var CHUNK = 0x8000; // 32KB，兼顾速度与栈安全
    var parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(''));
  }

  /** Base64 → Uint8Array（容忍换行 / 空格，便于从 COS 直接读 txt 回解） */
  function base64ToBytes(b64) {
    var bin = atob(String(b64 || '').replace(/[\s\r\n]+/g, ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** ArrayBuffer / TypedArray 统一成 Uint8Array */
  function toU8(buf) {
    if (buf instanceof Uint8Array) return buf;
    return new Uint8Array(buf);
  }

  /** 把任意二进制包成可下载 / 可上传的 Blob */
  function bytesToBlob(bytes, type) {
    return new Blob([bytes], { type: type || 'application/octet-stream' });
  }

  /** 统一风格的错误，便于调用方按阶段提示 */
  function fail(stage, message) {
    var e = new Error(message);
    e.stage = stage;
    return e;
  }

  /* ==========================================================================
   * 2. 密码学核心：SHA-256 派生密钥 + AES-256-CBC 加解密
   *    等价 CyberChef 的 SHA2(256) → AES Encrypt(CBC) → To Base64
   * ======================================================================== */

  /** 缓存派生结果：同一个会话里密码不变，没必要每次上传都重新 digest */
  var derivedKeyPromise = null;

  /**
   * 用固定密码 "levihan" 做 SHA-256，得到 32 字节 → 正好是 AES-256 的密钥长度。
   * SHA-256 输出恒为 32 字节，所以这里不需要截断 / 拉伸。
   */
  async function deriveKeyBytes() {
    var digest = await getSubtle().digest('SHA-256', utf8Bytes(CONFIG.SHELL_PASSWORD));
    return new Uint8Array(digest);
  }

  /** CryptoKey 也缓存起来，AES 加解密每次 importKey 会有额外开销 */
  async function getVaultKey() {
    if (!derivedKeyPromise) {
      derivedKeyPromise = (async function () {
        var keyBytes = await deriveKeyBytes();
        return getSubtle().importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
      })();
    }
    return derivedKeyPromise;
  }

  function ivBytes() {
    var iv = utf8Bytes(CONFIG.IV_UTF8);
    if (iv.length !== 16) {
      throw new Error('CONFIG.IV_UTF8 必须是 16 字节（当前 ' + iv.length + ' 字节），AES 分组长度固定为 128 位。');
    }
    return iv;
  }

  /**
   * AES-256-CBC 加密（PKCS#7 填充由 WebCrypto 自动完成，与 CyberChef 默认一致）。
   * @param {Uint8Array} plainBytes
   * @returns {Promise<Uint8Array>} 密文
   */
  async function aesEncrypt(plainBytes) {
    var key = await getVaultKey();
    var iv;
    if (CONFIG.RANDOM_IV) {
      // 每文件独立 IV：取 16 字节强随机，明文前缀相同的隐患即可消除
      iv = new Uint8Array(16);
      (typeof globalThis !== 'undefined' ? globalThis : {}).crypto.getRandomValues(iv);
    } else {
      iv = ivBytes();
    }
    var cipher = await getSubtle().encrypt({ name: 'AES-CBC', iv: iv }, key, plainBytes);
    var cipherBytes = new Uint8Array(cipher);
    if (!CONFIG.RANDOM_IV) return cipherBytes;
    // 随机 IV 模式下把 IV 前置到密文头部，密文自描述，解密端无需额外配置
    var merged = new Uint8Array(iv.length + cipherBytes.length);
    merged.set(iv, 0);
    merged.set(cipherBytes, iv.length);
    return merged;
  }

  /**
   * AES-256-CBC 解密（阅读端 / 自测用）。
   * @param {Uint8Array} cipherBytes
   * @returns {Promise<Uint8Array>} 明文
   */
  async function aesDecrypt(cipherBytes) {
    var key = await getVaultKey();
    var iv = ivBytes();
    var payload = cipherBytes;
    if (CONFIG.RANDOM_IV) {
      if (cipherBytes.length < 17) throw new Error('密文长度异常，无法取出前置 IV。');
      iv = cipherBytes.subarray(0, 16);           // 随机 IV 模式：前 16 字节就是 IV
      payload = cipherBytes.subarray(16);
    }
    var plain = await getSubtle().decrypt({ name: 'AES-CBC', iv: iv }, key, payload);
    return new Uint8Array(plain);
  }

  /* ==========================================================================
   * 3. 步骤 2：数据预处理 —— 图片按顺序合并成 PDF（纯内存，不落盘）
   * ======================================================================== */

  /** 读出文件的 ArrayBuffer（FileReader 包装成 Promise） */
  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('读取文件失败：' + (file && file.name))); };
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * 读出文件的文本内容（用于回读密文 .txt）。
   * 优先用 Blob.text()：同为浏览器原生、不占额外内存，且在没有 FileReader 的环境
   * （Node 侧单测、Web Worker 之外的运行时）也能跑；老浏览器退回 FileReader。
   */
  function readFileAsText(file) {
    if (file && typeof file.text === 'function') return file.text();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('读取文件失败：' + (file && file.name))); };
      reader.readAsText(file);
    });
  }

  /** 判断一份输入是不是 PDF：只看文件头魔数，不看扩展名（用户可以改名） */
  function isPdfBytes(bytes) {
    // "%PDF-" = 0x25 0x50 0x44 0x46 0x2D
    return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2D;
  }

  /** 按文件名自然排序（image2 排在 image10 前面），与管理台其它入口保持一致 */
  function naturalSortByName(a, b) {
    return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  }

  /** 拿到可绘制的图像源：优先 createImageBitmap（快且省内存），退化到 <img> + objectURL */
  async function loadImageSource(file) {
    if (typeof createImageBitmap === 'function') {
      var bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: function () { bitmap.close && bitmap.close(); } };
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        resolve({
          source: img,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          release: function () { URL.revokeObjectURL(url); },
        });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片解码失败：' + file.name)); };
      img.src = url;
    });
  }

  /** 取页面里已从 CDN 引入的 jsPDF 构造函数 */
  function getJsPdfCtor() {
    var lib = root.jspdf || (root.window && root.window.jspdf);
    if (!lib || typeof lib.jsPDF !== 'function') {
      throw fail('merge', 'jsPDF 未加载（管理台依赖 https://cdn.staticfile.net/jspdf/2.5.1/jspdf.umd.min.js）。请检查网络后刷新页面。');
    }
    return lib.jsPDF;
  }

  /**
   * 【核心辅助逻辑】把多张图片按顺序合并成一个标准 PDF 文件流（ArrayBuffer）。
   * - 一图一页，页面尺寸 = 图片像素尺寸（按 96dpi→72pt 换算，保持原始长宽比）
   * - PNG 走无损通道；jpg / webp 等先画到 canvas 再转 JPEG（jsPDF 不认 webp）
   * - 逐张串行处理，处理完立即释放 canvas 与 bitmap，避免整本漫画同时驻留内存
   */
  async function imagesToPdfBytes(files, options) {
    options = options || {};
    var onProgress = typeof options.onProgress === 'function' ? options.onProgress : function () {};
    var list = Array.prototype.slice.call(files).sort(naturalSortByName);
    if (!list.length) throw fail('merge', '没有可合并的图片。');

    var JsPDF = getJsPdfCtor();
    var doc = null;
    var PX_TO_PT = 0.75; // 96dpi 像素 → 72dpi 点

    for (var i = 0; i < list.length; i++) {
      var file = list[i];
      onProgress({ stage: 'merge', ratio: i / list.length, text: '合并图片 → PDF（' + (i + 1) + '/' + list.length + '）：' + file.name });

      var src = await loadImageSource(file);
      try {
        // 超长图等比缩小，避免触碰 PDF 的页面上限
        var scale = Math.min(1, CONFIG.MAX_PAGE_PX / Math.max(src.width, src.height));
        var drawW = Math.max(1, Math.round(src.width * scale));
        var drawH = Math.max(1, Math.round(src.height * scale));

        var canvas = document.createElement('canvas');
        canvas.width = drawW;
        canvas.height = drawH;
        var ctx = canvas.getContext('2d');
        var isPng = /png/i.test(file.type || '') || /\.png$/i.test(file.name || '');
        if (!isPng) {
          // JPEG 不支持透明通道：先铺白底，否则透明区会变成黑块
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, drawW, drawH);
        }
        ctx.drawImage(src.source, 0, 0, drawW, drawH);

        var dataUrl = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', CONFIG.JPEG_QUALITY);
        var pageW = drawW * PX_TO_PT;
        var pageH = drawH * PX_TO_PT;
        var orientation = pageW > pageH ? 'landscape' : 'portrait';

        if (!doc) {
          doc = new JsPDF({ unit: 'pt', format: [pageW, pageH], orientation: orientation, compress: true });
        } else {
          doc.addPage([pageW, pageH], orientation);
        }
        doc.addImage(dataUrl, isPng ? 'PNG' : 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');

        // 及时释放，避免大批量上传时内存峰值过高
        canvas.width = 0;
        canvas.height = 0;
      } finally {
        src.release();
      }
    }

    onProgress({ stage: 'merge', ratio: 1, text: 'PDF 合并完成（' + list.length + ' 页）' });
    return doc.output('arraybuffer');
  }

  /**
   * 【步骤 2 入口】统一把输入规整成"一份 PDF 字节流"。
   * - 输入是 PDF（哪怕扩展名被改过）→ 原样通过，跳过合并
   * - 输入是一张或多张图片 → 在内存里合并
   */
  async function normalizeToPdfBytes(files, onProgress) {
    var list = Array.prototype.slice.call(files);
    if (!list.length) throw fail('read', '请先选择要上传的文件。');

    var totalBytes = list.reduce(function (sum, f) { return sum + (f.size || 0); }, 0);
    if (totalBytes > CONFIG.MAX_INPUT_BYTES) {
      throw fail('read', '待处理总量 ' + fmtSize(totalBytes) + '，超过上限 ' + fmtSize(CONFIG.MAX_INPUT_BYTES) + '。请分批上传。');
    }

    // 单个文件且是 PDF → 直接读取，不做任何转码（保真且最快）
    var firstBytes = new Uint8Array(await readFileAsArrayBuffer(list[0]));
    if (list.length === 1 && isPdfBytes(firstBytes)) {
      if (onProgress) onProgress({ stage: 'read', ratio: 1, text: '检测到 PDF 原文件，跳过图片合并' });
      return { pdfBytes: firstBytes, pageCount: null, mergedFromImages: false };
    }

    // 多文件里混进 PDF：PDF 无法参与图片合并，直接拦下并说明原因
    for (var i = 0; i < list.length; i++) {
      var isPdf = isPdfBytes(new Uint8Array(await readFileAsArrayBuffer(list[i])));
      if (isPdf) {
        throw fail('merge', '第 ' + (i + 1) + ' 个文件是 PDF，与图片混合无法合并。请只传 PDF，或只传图片。');
      }
    }

    var pdf = await imagesToPdfBytes(list, { onProgress: onProgress });
    var pdfBytes = new Uint8Array(pdf);
    if (!isPdfBytes(pdfBytes)) throw fail('merge', 'PDF 生成结果异常（缺少 %PDF- 文件头）。');
    return { pdfBytes: pdfBytes, pageCount: list.length, mergedFromImages: true };
  }

  /* ==========================================================================
   * 4. 步骤 3：数据强拦截 + 深度加密 + Base64 重包装
   * ======================================================================== */

  /**
   * 把 PDF 字节流加密成纯 Base64 密文字符串（CyberChef 配方输出）。
   * 这一步之后，%PDF- 文件头已经不存在了。
   */
  async function encryptPdfBytesToBase64(pdfBytes) {
    var cipherBytes = await aesEncrypt(toU8(pdfBytes));
    var base64 = bytesToBase64(cipherBytes);

    // 自检：密文里绝不能出现 PDF 文件头的痕迹，这是"打碎文件头"的验收标准
    if (base64.indexOf('JVBERi') === 0 || /^%PDF/.test(base64)) {
      throw fail('encrypt', '加密结果异常：仍能识别出 PDF 文件头，已中止上传。');
    }
    return base64;
  }

  /**
   * 把 Base64 密文重新包装成 纯文本 Blob —— 即将交给 COS 的 Body。
   * 注意 Base64 会使体积膨胀约 33%，大文件请留意上限。
   */
  function wrapBase64AsTextBlob(base64) {
    return new Blob([base64], { type: CONFIG.CIPHER_CONTENT_TYPE });
  }

  /** 完整加密段：PDF 字节 → { base64, blob } */
  async function encryptPdfToCipherPayload(pdfBytes, onProgress) {
    if (onProgress) onProgress({ stage: 'encrypt', ratio: 0.5, text: 'AES-256-CBC 强加密中…' });
    var base64 = await encryptPdfBytesToBase64(pdfBytes);
    if (onProgress) {
      onProgress({
        stage: 'wrap',
        ratio: 1,
        text: '密文已包装为 text/plain Blob（' + fmtSize(base64.length) + '）',
      });
    }
    return { base64: base64, blob: wrapBase64AsTextBlob(base64) };
  }

  /**
   * 【阅读端】密文 → PDF 字节流。
   * 支持三种输入：Blob(text/plain) / File / 字符串形式的 Base64。
   */
  async function decryptVaultToPdfBytes(input) {
    var base64;
    if (input instanceof Blob) {
      base64 = await readFileAsText(input);
    } else if (typeof input === 'string') {
      base64 = input;
    } else {
      throw new Error('decryptVaultToPdfBytes 只接受 Blob / File / Base64 字符串。');
    }
    var plain = await aesDecrypt(base64ToBytes(base64));
    if (!isPdfBytes(plain)) {
      throw new Error('解密后不是有效的 PDF。可能是密码 / IV 配置不匹配，或文件已损坏。');
    }
    return plain;
  }

  /**
   * 【阅读端便捷方法】密文 → 可下载的 PDF Blob。
   * 阅读器可以直接 URL.createObjectURL() 后塞进 iframe / pdf.js。
   */
  async function decryptVaultToPdfBlob(input) {
    var pdfBytes = await decryptVaultToPdfBytes(input);
    return bytesToBlob(pdfBytes, 'application/pdf');
  }

  /* ==========================================================================
   * 5. 步骤 4：Key 伪装 + COS 接口对接
   * ======================================================================== */

  /**
   * 清洗 Key 里的命名段：
   *   1) 先剥掉尾部的 .pdf / .jpg / .webp 等后缀 —— 这是需求里"抹除一切原后缀"的落点
   *   2) 再清掉斜杠、点号等一切可能造成路径穿越的字符（bookId 来自表单，不可信）
   */
  function sanitizeKeySegment(raw) {
    var cleaned = String(raw || '')
      .replace(/\.[A-Za-z0-9]{1,8}$/, '')
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 40);
    return cleaned || 'doc_' + Date.now();
  }

  /**
   * 生成 Key：抹掉一切图片 / PDF 后缀，强行改成 .txt
   *   VERSIONED_KEY=false → comic_vault/lh-123_secure.txt
   *   VERSIONED_KEY=true  → comic_vault/1758252800000_secure.txt
   */
  function buildVaultKey(bookId, options) {
    options = options || {};
    var prefix = String(options.prefix || CONFIG.VAULT_PREFIX).replace(/^\/+|\/+$/g, '');
    var suffix = options.suffix || CONFIG.KEY_SUFFIX;
    var segment = options.versioned === undefined ? CONFIG.VERSIONED_KEY : !!options.versioned;
    var bare = segment ? String(Date.now()) : sanitizeKeySegment(bookId);
    return prefix + '/' + bare + suffix;
  }

  /** 由 Key 反推公开访问 URL（走 COS 静态网站域名） */
  function keyToPublicUrl(key) {
    return CONFIG.COS.CdnBase.replace(/\/+$/, '') + '/' + String(key).replace(/^\/+/, '');
  }

  /** 读管理台注入的云函数地址 */
  function apiEndpoint() {
    return runtime.apiEndpoint || (root && root.LEVIHAN_FN_URL) || '';
  }

  /**
   * 与管理台同一套约定：text/plain 发送以避开 CORS 预检。
   * 这里保留一份独立实现，让本模块可以脱离管理台单独使用。
   */
  async function postApi(payload) {
    var endpoint = apiEndpoint();
    if (!endpoint) throw new Error('未配置云函数地址（请调用 LeVihanVault.configure({ apiEndpoint }) 或用 window.LEVIHAN_FN_URL 声明）。');
    var body = Object.assign({}, payload);
    var token = runtime.getToken();
    if (token && body.action !== 'login') body.token = token;

    var res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body),
    });
    var data = await res.json().catch(function () { return {}; });
    if (data && data.ok === false) throw new Error(data.error || ('请求失败（HTTP ' + res.status + '）'));
    if (!res.ok) throw new Error('请求失败（HTTP ' + res.status + '）');
    return data;
  }

  /* ---------------------- 通道 A：cos-js-sdk-v5 浏览器直传 ---------------------- */

  /** 有缓存的临时凭证且未接近过期就直接复用，避免每次上传都打一次云函数 */
  function credentialUsable(cred) {
    if (!cred || !cred.tmpSecretId || !cred.tmpSecretKey) return false;
    if (!cred.expiredTime) return true;
    return cred.expiredTime - Math.floor(Date.now() / 1000) > 60;
  }

  /**
   * 取 COS 临时凭证（TmpSecretId / TmpSecretKey / SessionToken）。
   * 期望云函数新增一个 action:'cosCredential' 分支，返回范围收敛到 comic_vault/ 前缀的最小权限凭证。
   * 也支持页面直接注入 window.LEVIHAN_COS_CREDENTIAL（内网 / 自用场景）。
   */
  async function fetchCosCredential() {
    if (credentialUsable(cachedCredential)) return cachedCredential;

    if (root && credentialUsable(root.LEVIHAN_COS_CREDENTIAL)) {
      cachedCredential = root.LEVIHAN_COS_CREDENTIAL;
      return cachedCredential;
    }

    var data = await postApi({ action: 'cosCredential', prefix: CONFIG.VAULT_PREFIX + '/' });
    var raw = data.credentials || data;
    var cred = {
      tmpSecretId: raw.tmpSecretId || raw.TmpSecretId,
      tmpSecretKey: raw.tmpSecretKey || raw.TmpSecretKey,
      sessionToken: raw.sessionToken || raw.SessionToken,
      startTime: raw.startTime || raw.StartTime || Math.floor(Date.now() / 1000),
      expiredTime: raw.expiredTime || raw.ExpiredTime,
    };
    if (!credentialUsable(cred)) throw new Error('云函数返回的 COS 临时凭证不完整。');
    cachedCredential = cred;
    return cred;
  }

  /**
   * 懒加载 cos-js-sdk-v5 实例。
   * 用官方推荐的 getAuthorization 回调（返回 Promise）→ SDK 会在凭证过期时自动重新拉取，
   * 不会出现长时间挂着页面上传失败在最后一刻报签名错误的情况。
   */
  function getCosInstance() {
    var COS = root && root.COS;
    if (typeof COS !== 'function') {
      throw fail('upload', 'cos-js-sdk-v5 未加载（需要 <script src=".../cos-js-sdk-v5.min.js">）。');
    }
    if (cosInstance) return cosInstance;
    cosInstance = new COS({
      getAuthorization: function () {
        return fetchCosCredential().then(function (cred) {
          return {
            TmpSecretId: cred.tmpSecretId,
            TmpSecretKey: cred.tmpSecretKey,
            XCosSecurityToken: cred.sessionToken,
            StartTime: cred.startTime,
            ExpiredTime: cred.expiredTime,
          };
        });
      },
    });
    return cosInstance;
  }

  /**
   * 【步骤 4 核心】Body 传密文 Blob、Key 传伪装后的 .txt 路径。
   * 用 putObject 而不是 uploadFile：Body 是内存里的 Blob，没有本地路径，
   * putObject 单请求即可；若密文特别大（>100MB）可换 sliceUploadFile 走分片。
   */
  function putCipherToCos(blob, key, onProgress) {
    var cos = getCosInstance();
    return new Promise(function (resolve, reject) {
      cos.putObject(
        {
          Bucket: CONFIG.COS.Bucket,
          Region: CONFIG.COS.Region,
          Key: key,                                  // ← Key 改造：comic_vault/xxx_secure.txt
          Body: blob,                                // ← Body 改造：text/plain 密文 Blob
          ContentType: CONFIG.CIPHER_CONTENT_TYPE,   // 伪装成纯文本，便于 CDN/浏览器直接当文本处理
          CacheControl: CONFIG.CacheControl,
          onProgress: function (info) {
            if (typeof onProgress === 'function') {
              onProgress({
                stage: 'upload',
                ratio: info && info.percent ? info.percent / 100 : 0,
                text: '直传 COS：' + (info && info.percent ? Math.round(info.percent) + '%' : '上传中'),
              });
            }
          },
        },
        function (err, data) {
          if (err) { reject(err); return; }
          resolve({ key: key, url: keyToPublicUrl(key), etag: data && data.ETag, channel: 'sdk' });
        }
      );
    });
  }

  /* ---------------------- 通道 B：云函数中转（无需 SDK / 无凭证时的降级） ---------------------- */

  /**
   * 把密文 Base64 交给云函数，由云函数用自身凭证 putObject。
   * 期望云函数新增 action:'vaultUpload'：只放开 comic_vault/ 前缀 + 只收纯文本，
   * 并复用现有 MAX_BYTES 上限校验（现有 action:'upload' 的 FILE_RE 不允许 .txt）。
   */
  async function uploadCipherViaProxy(base64, key, onProgress) {
    if (onProgress) onProgress({ stage: 'upload', ratio: 0.1, text: '经云函数中转上传…' });
    var res = await postApi({
      action: 'vaultUpload',
      key: key,
      dataBase64: base64,
      contentType: CONFIG.CIPHER_CONTENT_TYPE,
    });
    if (onProgress) onProgress({ stage: 'upload', ratio: 1, text: '中转上传完成' });
    return { key: res.key || key, url: keyToPublicUrl(res.key || key), etag: res.etag, channel: 'proxy' };
  }

  /** 依 UPLOAD_MODE 选择通道；auto 模式下 SDK 不可用 / 凭证接口缺失会自动降级 */
  async function uploadCipher(base64, blob, key, onProgress) {
    var mode = CONFIG.UPLOAD_MODE;
    var canUseSdk = mode !== 'proxy' && root && typeof root.COS === 'function';
    if (canUseSdk) {
      try {
        return await putCipherToCos(blob, key, onProgress);
      } catch (err) {
        if (mode === 'sdk') throw err;
        console.warn('[LeVihanVault] 浏览器直传失败，降级为中转上传：', err && err.message);
      }
    }
    return uploadCipherViaProxy(base64, key, onProgress);
  }

  /* ==========================================================================
   * 6. 主函数：handleComicUpload() —— 直接绑定在「上传并发布」按钮上
   * ======================================================================== */

  /**
   * 漫画 / 文档深度加密直传主函数。
   *
   * @param {FileList|File[]|File} input 管理员选中的文件（图片若干张，或一个 PDF）
   * @param {Object} [options]
   * @param {string} [options.bookId]     本子 ID（lh-数字）；决定 Key 的命名段
   * @param {boolean} [options.versioned] 是否给 Key 加时间戳（覆盖 CONFIG.VERSIONED_KEY）
   * @param {Function} [options.onProgress] ({ stage, ratio, text }) => void
   * @returns {Promise<{key:string,url:string,channel:string,bytes:Object,pageCount:number|null}>}
   */
  async function handleComicUpload(input, options) {
    options = options || {};
    var onProgress = typeof options.onProgress === 'function' ? options.onProgress : function () {};
    var startedAt = Date.now();

    var files = input instanceof FileList || Array.isArray(input) ? Array.prototype.slice.call(input) : [input];
    files = files.filter(Boolean);
    if (!files.length) throw fail('read', '请先选择要上传的图片或 PDF。');

    onProgress({ stage: 'read', ratio: 0, text: '读取文件（' + files.length + ' 个）…' });

    /* ---- 步骤 2：预处理，拿到一份 PDF 字节流 ---- */
    var normalized = await normalizeToPdfBytes(files, onProgress);
    var pdfBytes = normalized.pdfBytes;
    onProgress({
      stage: 'read',
      ratio: 1,
      text: 'PDF 就绪：' + fmtSize(pdfBytes.length) + (normalized.mergedFromImages ? '（由 ' + normalized.pageCount + ' 张图片合并）' : '（原文件）'),
    });

    /* ---- 步骤 3：强拦截 + 加密 + Base64 重包装 ---- */
    var payload = await encryptPdfToCipherPayload(pdfBytes, onProgress);

    /* ---- 步骤 4：Key 伪装 + 上传 ---- */
    var key = buildVaultKey(options.bookId, { versioned: options.versioned });
    var uploaded = await uploadCipher(payload.base64, payload.blob, key, onProgress);

    var result = {
      key: uploaded.key,
      url: uploaded.url,
      channel: uploaded.channel,
      etag: uploaded.etag,
      pageCount: normalized.pageCount,
      bytes: {
        source: pdfBytes.length,
        cipher: payload.blob.size,
        base64: payload.base64.length,
      },
      elapsedMs: Date.now() - startedAt,
    };

    onProgress({
      stage: 'done',
      ratio: 1,
      text:
        '✅ 深度加密上传完成：' + result.key +
        '（PDF ' + fmtSize(result.bytes.source) + ' → 密文 ' + fmtSize(result.bytes.cipher) + '，' +
        (result.elapsedMs / 1000).toFixed(1) + 's，通道 ' + result.channel + '）',
    });
    return result;
  }

  /**
   * 【阅读端便捷方法】从 COS 拉取 .txt 密文并解密成可预览的 PDF Blob URL。
   * 返回的 objectURL 用完记得 URL.revokeObjectURL()，否则会漏内存。
   */
  async function openDecryptedPdfFromUrl(keyOrUrl) {
    var url = /^https?:\/\//i.test(keyOrUrl) ? keyOrUrl : keyToPublicUrl(keyOrUrl);
    var res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('拉取密文失败（HTTP ' + res.status + '）');
    var text = await res.text();
    var pdfBlob = await decryptVaultToPdfBlob(text);
    return URL.createObjectURL(pdfBlob);
  }

  /* ==========================================================================
   * 7. 导出
   * ======================================================================== */
  return {
    CONFIG: CONFIG,
    configure: configure,

    // 主流程
    handleComicUpload: handleComicUpload,

    // 分步能力（便于单测 / 复用到其它上传入口）
    normalizeToPdfBytes: normalizeToPdfBytes,
    imagesToPdfBytes: imagesToPdfBytes,
    encryptPdfBytesToBase64: encryptPdfBytesToBase64,
    encryptPdfToCipherPayload: encryptPdfToCipherPayload,
    wrapBase64AsTextBlob: wrapBase64AsTextBlob,
    buildVaultKey: buildVaultKey,
    keyToPublicUrl: keyToPublicUrl,
    uploadCipher: uploadCipher,

    // 密码学原语（自测与跨端复用）
    deriveKeyBytes: deriveKeyBytes,
    aesEncrypt: aesEncrypt,
    aesDecrypt: aesDecrypt,
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,

    // 阅读端
    decryptVaultToPdfBytes: decryptVaultToPdfBytes,
    decryptVaultToPdfBlob: decryptVaultToPdfBlob,
    openDecryptedPdfFromUrl: openDecryptedPdfFromUrl,
    isPdfBytes: isPdfBytes,
  };
  })();

  // 浏览器：<script src> 之后从 window.LeVihanVault 取用
  if (root) root.LeVihanVault = api;
  // Node 侧（含 tests/ 里的 CJS 用例）走 CJS 导出
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
