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
    /**
     * 输入总量硬阀。**这不是业务上限，只是防标签页被拖死的安全阀**，
     * 因此定得远高于任何真实批次（旧值 60MB 曾在这里误杀过 67.71MB 的批次）。
     * 真正的判定看 MAX_OUTPUT_BYTES —— 也就是"先压缩、再判定"里的第二段。
     */
    MAX_INPUT_BYTES: 1024 * 1024 * 1024,
    /**
     * 产出 PDF 的目标体积（两段式的判定依据）。
     *
     * 刻意与上传通道的物理能力解耦：接入分片上传后通道已无硬上限，
     * 这个数字表达的是**业务目标**（单本多少算合理），压缩阶梯以它为靶心逐档降画质。
     * 想完全不降画质就把阶梯关掉（AUTO_DOWNSCALE=false）并把这里调大。
     */
    MAX_OUTPUT_BYTES: 60 * 1024 * 1024,
    /** 单页像素长边上限，超长图（如 webtoon 条漫）会被等比缩小以避开 PDF 尺寸限制 */
    MAX_PAGE_PX: 12000,
    /**
     * 单页画布的**面积**安全上限（0 = 不启用面积保护）。
     *
     * 为什么长边之外还要单独管面积：iOS Safari 的 canvas 有约 16.7MP（4096×4096）
     * 的面积上限，超出后 drawImage / fillRect 会**静默失效** —— 不抛错、不告警，
     * 画布保持全透明，这一页就被编码成一张空白图，而流水线照常报「上传成功」。
     * 一张 8000×6000 的扫描页长边合格（< 12000）但面积 48MP，正好落在这个坑里。
     *
     * 它不是一刀切的降质开关：只有**实测发现画布确实没画上**（见 canvasRenderFailed）
     * 才降采样。桌面 Chromium / Safari 上限高得多（实测约 268MP），探测通过就原样
     * 处理 —— 桌面行为完全不变。取 16MP 略低于 iOS 的 16.7MP，留一点余量。
     */
    MAX_PAGE_AREA_PX: 16 * 1024 * 1024,

    /* ---------------------- 压缩策略（"不损伤画质"优先） ---------------------- */

    /**
     * 是否启用压缩阶梯。开启后：从"无损"档开始逐档实测产出，一旦达标立即停手，
     * 绝不为了达标而多降一档 —— 无损能过就永远走无损。
     * 关闭后只跑第一档（无损），产出超目标也不再降画质。
     */
    AUTO_DOWNSCALE: true,
    /**
     * 压缩阶梯档位。每档是覆盖 CONFIG 的一组 patch，跑完即还原。
     * 顺序即"从无损到有损"，第一档必须是空 patch（无损直通）。
     *
     *   png 档：不透明 PNG 转 JPEG。对网点漫画属视觉无损，但对黑白线稿是有损，
     *           故排在长边档之前 —— 先不动分辨率，实在不够再缩。
     * 长边档：唯一真正减体积的硬手段（实测缩到长边 1200 只剩 55%），
     *           但那是实打实降分辨率，所以排在最后。
     */
    COMPRESS_LADDER: [
      { id: 'lossless', label: '无损直通',           patch: {} },
      { id: 'png2jpeg', label: '不透明 PNG 转 JPEG', patch: { PNG_POLICY: 'auto' }, needsPng: true },
      { id: 'side2400', label: '长边 ≤ 2400px',      patch: { PNG_POLICY: 'auto', IMAGE_LONG_SIDE_MAX: 2400 } },
      { id: 'side1600', label: '长边 ≤ 1600px',      patch: { PNG_POLICY: 'auto', IMAGE_LONG_SIDE_MAX: 1600 } },
      { id: 'side1200', label: '长边 ≤ 1200px',      patch: { PNG_POLICY: 'auto', IMAGE_LONG_SIDE_MAX: 1200 } },
    ],
    /**
     * PDF 输入走图像旋钮是无效的（PDF 是原字节直通，不解码内嵌图），
     * 所以 PDF 另有独立档位：逐页重渲染成 JPEG 再拼回 PDF。
     * 仅在注入了 renderPdfPages 渲染器、且直通档超目标时启用。
     */
    PDF_LADDER: [
      { id: 'pdf-side2000', maxSide: 2000, quality: 0.85, label: 'PDF 逐页重渲染 · 长边 ≤ 2000px' },
      { id: 'pdf-side1400', maxSide: 1400, quality: 0.8,  label: 'PDF 逐页重渲染 · 长边 ≤ 1400px' },
    ],
    /**
     * 分片上传的单个分片大小（按密文文本字节计）。
     * 必须 ≤ 云函数 MAX_BYTES(4MB)，否则分片本身会被 413 挡回来。
     */
    VAULT_PART_BYTES: 4 * 1024 * 1024,

    /**
     * 内页可选的降采样长边上限。**这是唯一真正改变画质的旋钮**，所以默认 0 = 不限制。
     * 设为 1600 / 1200 能显著减体积（实测 1379×1667 的页缩到长边 1200 后只剩 55%），
     * 但那是"缩小分辨率"，不再是无损 —— 需要时再开。
     */
    IMAGE_LONG_SIDE_MAX: 0,
    /**
     * PNG 源的处理策略：
     *   'keep' → 始终保持 PNG 无损。严格零画质损失，但**体积可能是源图的 3 倍以上**
     *            （网点 / 噪点这类高频纹理的熵极高，PNG 的 Flate 字典压缩几乎无效）。
     *   'auto' → 只有真的含 alpha 通道（透明像素）才保留 PNG，其余转 JPEG。
     *            对黑白网点漫画属于视觉无损（实测 q0.92 与原图肉眼不可分辨），体积回到 1.0 倍。
     *   'jpeg' → 一律转 JPEG（透明区会被铺成白底）。
     * 默认取 'keep'：需求是"不损伤画质"，不能替用户做有损决定。要压体积再改这一行。
     */
    PNG_POLICY: 'keep',
    /**
     * 重编码质量。注意两个坑：
     *   ① 它只作用于"走 canvas 重编码"的图；JPEG 源在尺寸合格时是**原字节直通**，不经过它。
     *   ② 定得比源图质量高会**让体积变大** —— 源图多为 q80 左右，
     *      用 q0.92 重编码实测会把 646 KB 的源图变成 743 KB（+15%，还白丢一次画质）。
     */
    JPEG_QUALITY: 0.9,
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
    /**
     * PDF 逐页渲染器，签名 (file, { maxSide, quality }) => Promise<File[]>。
     * 由管理台注入（复用 index.html 里已有的 pdf.js 拆页能力），
     * 本模块因此**不必自己引 pdf.js** —— 没注入就自动跳过 PDF 压缩档。
     */
    renderPdfPages: null,
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
    if (typeof options.renderPdfPages === 'function') runtime.renderPdfPages = options.renderPdfPages;
    if (options.cos) Object.assign(CONFIG.COS, options.cos);
    ['VERSIONED_KEY', 'RANDOM_IV', 'UPLOAD_MODE', 'MAX_INPUT_BYTES', 'MAX_OUTPUT_BYTES',
     'AUTO_DOWNSCALE', 'COMPRESS_LADDER', 'PDF_LADDER', 'VAULT_PART_BYTES',
     'VAULT_PREFIX', 'KEY_SUFFIX',
     'MAX_PAGE_PX', 'MAX_PAGE_AREA_PX',
     'IMAGE_LONG_SIDE_MAX', 'PNG_POLICY', 'JPEG_QUALITY'].forEach(function (k) {
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
      throw fail('merge', 'jsPDF 未加载（管理台依赖 vendor/jspdf.umd.min.js）。请刷新页面后重试。');
    }
    return lib.jsPDF;
  }

  /* ---------------------- 压缩策略用到的判定辅助 ---------------------- */

  /**
   * 只扫 JPEG 的标记段读出真实宽高与分量数，**不解码任何像素**。
   * 需要它的理由：走"原字节直通"时既不经过 canvas，就拿不到宽高，
   * 而 PDF 页面尺寸又必须按真实像素算（96dpi 像素 × 0.75 = pt）。
   * 解析头部只有几 KB 开销，比整图解码便宜好几个数量级。
   * 返回 null 表示不是可识别的 JPEG。
   */
  function readJpegHeader(bytes) {
    if (!bytes || bytes.length < 12 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
    var i = 2;
    while (i < bytes.length - 9) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      var marker = bytes[i + 1];
      // 无载荷的标记：SOI / TEM / RSTn
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      // SOS 之后是熵编码数据（里面可能有 0xFF00 填充），标记段到此为止；SOF 必然在它之前
      if (marker === 0xD9 || marker === 0xDA) break;
      var len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2) return null;
      // SOF0..SOF15，排除 DHT(0xC4) / JPG(0xC8) / DAC(0xCC)
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return {
          height: (bytes[i + 5] << 8) | bytes[i + 6],
          width: (bytes[i + 7] << 8) | bytes[i + 8],
          components: bytes[i + 9],
        };
      }
      i += 2 + len;
    }
    return null;
  }

  /**
   * 这个文件值不值得读字节去试 JPEG 直通？
   * 明确是别的格式（png / webp…）就没必要白读一遍几十 MB 的字节。
   * 类型与扩展名都缺失时（拖拽来源五花八门）才值得读一下魔数。
   */
  function mayBeJpeg(file) {
    var type = String((file && file.type) || '');
    var name = String((file && file.name) || '');
    if (/jpe?g/i.test(type)) return true;
    if (/\.jpe?g$/i.test(name)) return true;
    if (type || /\.\w+$/.test(name)) return false;
    return true;
  }

  /**
   * 尽力读出文件的原始字节。
   * 读不出来（无 arrayBuffer 也无 FileReader）返回 null，调用方退回 canvas 重编码 ——
   * 这是给 Node 侧单测的桩环境留的退路，不是正常的线上路径。
   */
  async function readBytesIfPossible(file) {
    try {
      if (file && typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
      if (typeof FileReader === 'function') return new Uint8Array(await readFileAsArrayBuffer(file));
    } catch (e) {
      return null;
    }
    return null;
  }

  /**
   * canvas 里是否真的存在透明像素。
   * 只对"原则上可能带 alpha"的格式调用；JPEG 一定没有，直接跳过省一次全图扫描。
   * 取不到像素（画布被跨域污染等）时**保守地当作有 alpha**，宁可体积大也不丢透明信息。
   */
  function canvasHasAlpha(canvas) {
    try {
      var data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (var i = 3; i < data.length; i += 4) {
        if (data[i] !== 255) return true;
      }
      return false;
    } catch (e) {
      return true;
    }
  }

  /**
   * 画布是否"静默失效" —— 这是移动端最危险的一类失败，必须主动探测。
   *
   * iOS Safari 的 canvas 有面积上限（约 16.7MP，即 4096×4096）。一旦超出，
   * drawImage / fillRect **既不抛错也不告警**，画布直接保持全透明，
   * 于是这一页被编码成一张空白图，而整条流水线照常走到「✅ 上传完成」——
   * 管理员看到成功，读者打开是白纸，事后几乎无从发现。
   * 实测 Chromium 要到约 268MP 才失效（20000×20000 时 fillRect 后 toBlob 只剩 4 字节），
   * 所以桌面同尺寸是好的 —— 这也说明不能按 16.7MP 一刀切砍，否则桌面原本
   * 能无损通过的大图会白白降质。故采用"先画、再验、验砸了才降采样"。
   *
   * 判据：取 25% / 50% / 75% 三条水平扫描线，只要有一行存在非透明像素就认定画布
   * 生效；三条线全透明才判失效。正常图片不可能三整行都透明；万一源图真是全透明的，
   * 降采样之后它依然空白，结论不变。
   * 只在面积超过安全上限时才调用，小图零开销。
   */
  function canvasRenderFailed(ctx, w, h) {
    try {
      var rows = [0.25, 0.5, 0.75];
      for (var i = 0; i < rows.length; i++) {
        var y = Math.min(h - 1, Math.max(0, Math.floor(h * rows[i])));
        var line = ctx.getImageData(0, y, w, 1).data;
        for (var x = 3; x < line.length; x += 4) {
          if (line[x] !== 0) return false;
        }
      }
      return true;
    } catch (e) {
      // 读不到像素（画布被污染等）也当作失效，走降采样重试而不是带着空白页继续
      return true;
    }
  }

  /** 把单个输入文件变成"一页 PDF 素材"。返回 { data, format, width, height, passthrough, downscaled, ... } */
  async function buildPageImage(file, maxSide) {
    var name = (file && file.name) || '';

    // ① JPEG 源且不需要降采样 → 原字节直通。
    //    实测：661,677 B 的源图产出 664,966 B 的 PDF（开销仅 3,289 B），
    //    而"过 canvas 用 q0.92 重编码"会涨到 761,348 B —— 既涨体积又白丢一次画质。
    if (mayBeJpeg(file)) {
      var bytes = await readBytesIfPossible(file);
      var head = bytes ? readJpegHeader(bytes) : null;
      if (head && head.width > 0 && head.height > 0) {
        var longSide = Math.max(head.width, head.height);
        if (!maxSide || longSide <= maxSide) {
          return {
            data: 'data:image/jpeg;base64,' + bytesToBase64(bytes),
            format: 'JPEG',
            width: head.width,
            height: head.height,
            passthrough: true,
            downscaled: false,
            sourceBytes: bytes.length,
            release: null,
          };
        }
      }
    }

    // ② 其余情况：解码到 canvas（必要时降采样），再按 PNG 策略编码
    var src = await loadImageSource(file);
    var canvas = null;
    try {
      var scale = 1;
      if (maxSide) scale = Math.min(scale, maxSide / Math.max(src.width, src.height));
      // MAX_PAGE_PX 只负责防"超长条漫撑爆 PDF 尺寸上限"，不承担压缩职责
      if (CONFIG.MAX_PAGE_PX) scale = Math.min(scale, CONFIG.MAX_PAGE_PX / Math.max(src.width, src.height));

      var drawW = Math.max(1, Math.round(src.width * scale));
      var drawH = Math.max(1, Math.round(src.height * scale));

      canvas = document.createElement('canvas');
      canvas.width = drawW;
      canvas.height = drawH;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(src.source, 0, 0, drawW, drawH);

      // 画布静默失效时，按安全面积重画一次（见 canvasRenderFailed 的说明）。
      // 只有超过安全面积才探测，小图零开销。位置必须在下面「铺白底」之前 ——
      // 白底一铺上去，探测就永远看到不透明，再也发现不了失效。
      var forcedDownscale = false;
      var safeArea = Number(CONFIG.MAX_PAGE_AREA_PX) || 0;
      if (safeArea > 0 && drawW * drawH > safeArea && canvasRenderFailed(ctx, drawW, drawH)) {
        var fit = Math.sqrt(safeArea / (drawW * drawH));
        var fitW = Math.max(1, Math.round(drawW * fit));
        var fitH = Math.max(1, Math.round(drawH * fit));
        canvas.width = 0;
        canvas.height = 0;
        canvas = document.createElement('canvas');
        canvas.width = fitW;
        canvas.height = fitH;
        ctx = canvas.getContext('2d');
        ctx.drawImage(src.source, 0, 0, fitW, fitH);
        drawW = fitW;
        drawH = fitH;
        forcedDownscale = true;
      }

      // 判定这一页要不要保留无损 PNG。
      // 关键：**PNG 策略只该管 PNG 源**。JPEG 源即便因为要降采样而走 canvas，
      // 也必须继续输出 JPEG —— 把一张有损 JPEG 重编码成无损 PNG 只会让体积暴涨，
      // 而且救不回任何已经丢掉的信息。
      var policy = CONFIG.PNG_POLICY || 'keep';
      var srcSig = String((file && file.type) || '') + ' ' + String((file && file.name) || '');
      var sourceIsPng = /png/i.test(srcSig);
      var sourceMayHaveAlpha = !/jpe?g/i.test(srcSig);

      // 两种情况下结论是写死的，扫了也用不上，没必要为它付一次全图 getImageData
      // 的代价（48MP 的图是 183MB，逐页循环上百次就是几十秒的纯浪费）：
      //   policy='jpeg'         → 一律转 JPEG，恒不保留
      //   policy='keep' + PNG 源 → 一律保留无损，恒保留
      var needAlphaScan = policy !== 'jpeg'
                       && sourceMayHaveAlpha
                       && !(sourceIsPng && policy === 'keep');
      var hasAlpha = needAlphaScan ? canvasHasAlpha(canvas) : false;

      var keepPng;
      if (policy === 'jpeg') keepPng = false;
      else if (sourceIsPng) keepPng = (policy === 'keep') ? true : hasAlpha;
      // PDF 装不下 webp / gif / avif，这类源只能二选一：
      // 带 alpha 就用 PNG 兜住透明，否则转 JPEG
      else keepPng = hasAlpha;

      if (!keepPng) {
        // JPEG 不支持透明：用 destination-over 在白底**之下**铺一层，
        // 免得像先 fillRect 再 drawImage 那样把原图的透明信息盖掉（那个顺序下没法再判 alpha）
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, drawW, drawH);
        ctx.globalCompositeOperation = 'source-over';
      }

      var out = {
        data: canvas.toDataURL(keepPng ? 'image/png' : 'image/jpeg', CONFIG.JPEG_QUALITY),
        format: keepPng ? 'PNG' : 'JPEG',
        width: drawW,
        height: drawH,
        passthrough: false,
        downscaled: scale < 1 || forcedDownscale,
        sourceBytes: (file && file.size) || 0,
        release: null,
      };
      canvas.width = 0;
      canvas.height = 0;
      canvas = null;
      return out;
    } finally {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      src.release();
    }
  }

  /**
   * 【核心辅助逻辑】把多张图片按顺序合并成一个标准 PDF 文件流（ArrayBuffer）。
   *
   * 在"不损伤画质"前提下的三层压缩（详见 CONFIG 里各旋钮的注释）：
   *   ① JPEG 源 + 尺寸合格 → 原字节直通，jsPDF 走 DCTDecode 嵌入，不二次重编码
   *   ② PNG 源 → 按 CONFIG.PNG_POLICY 决定保留无损还是转 JPEG
   *   ③ 默认不降采样（IMAGE_LONG_SIDE_MAX = 0），这是唯一真正改画质的操作
   *
   * - 一图一页，页面尺寸 = 图片像素尺寸（按 96dpi→72pt 换算，保持原始长宽比）
   * - 逐张串行处理，处理完立即释放 canvas 与 bitmap，避免整本漫画同时驻留内存
   *
   * @param {File[]} files
   * @param {{onProgress?:Function, onStats?:Function}} [options]
   *   onStats 会收到 { pages, passthrough, reencoded, downscaled, sourceBytes, pdfBytes }
   * @returns {Promise<ArrayBuffer>} 返回值签名不变（对外导出的 API，测试与调用方都依赖它）
   */
  async function imagesToPdfBytes(files, options) {
    options = options || {};
    var onProgress = typeof options.onProgress === 'function' ? options.onProgress : function () {};
    var onStats = typeof options.onStats === 'function' ? options.onStats : function () {};
    var list = Array.prototype.slice.call(files).sort(naturalSortByName);
    if (!list.length) throw fail('merge', '没有可合并的图片。');

    var JsPDF = getJsPdfCtor();
    var doc = null;
    var PX_TO_PT = 0.75; // 96dpi 像素 → 72dpi 点
    var maxSide = Number(CONFIG.IMAGE_LONG_SIDE_MAX) || 0;
    var stats = { pages: list.length, passthrough: 0, reencoded: 0, downscaled: 0, sourceBytes: 0, pdfBytes: 0 };

    for (var i = 0; i < list.length; i++) {
      var file = list[i];
      onProgress({ stage: 'merge', ratio: i / list.length, text: '合并图片 → PDF（' + (i + 1) + '/' + list.length + '）：' + file.name });

      var placed = await buildPageImage(file, maxSide);
      var pageW = placed.width * PX_TO_PT;
      var pageH = placed.height * PX_TO_PT;
      var orientation = pageW > pageH ? 'landscape' : 'portrait';

      if (!doc) {
        doc = new JsPDF({ unit: 'pt', format: [pageW, pageH], orientation: orientation, compress: true });
      } else {
        doc.addPage([pageW, pageH], orientation);
      }
      doc.addImage(placed.data, placed.format, 0, 0, pageW, pageH, undefined, 'FAST');

      stats.sourceBytes += placed.sourceBytes || 0;
      if (placed.passthrough) stats.passthrough++; else stats.reencoded++;
      if (placed.downscaled) stats.downscaled++;
    }

    onProgress({ stage: 'merge', ratio: 1, text: 'PDF 合并完成（' + list.length + ' 页）' });
    var buffer = doc.output('arraybuffer');
    stats.pdfBytes = buffer.byteLength;
    onStats(stats);
    return buffer;
  }

  /**
   * 【步骤 2】把输入规整成"一份 PDF 字节流"。
   * - 输入是 PDF（哪怕扩展名被改过）→ 原样通过，跳过合并
   * - 输入是一张或多张图片 → 在内存里合并
   *
   * 注意：这里**不做体积判定**。判定已移到产出侧（runCompressLadder），
   * 因为输入体积与产出体积没有单调关系 —— 在压缩前判定会两头出错。
   * 本函数只留一道"防标签页被拖死"的安全阀，值远高于任何真实批次。
   *
   * @param {File[]} files
   * @param {Function} [onProgress]
   * @param {Function} [onStats] 合并统计（仅图片路径有；PDF 直通路径收到 { passthrough:true, ... }）
   */
  async function normalizeToPdfBytes(files, onProgress, onStats) {
    var list = Array.prototype.slice.call(files);
    if (!list.length) throw fail('read', '请先选择要上传的文件。');

    var totalBytes = list.reduce(function (sum, f) { return sum + (f.size || 0); }, 0);
    if (totalBytes > CONFIG.MAX_INPUT_BYTES) {
      throw fail(
        'read',
        '输入总量 ' + fmtSize(totalBytes) + '，超过安全阀 ' + fmtSize(CONFIG.MAX_INPUT_BYTES) + '。请减少文件数量。'
      );
    }

    // 单个文件且是 PDF → 直接读取，不做任何转码（保真且最快）
    var firstBytes = new Uint8Array(await readFileAsArrayBuffer(list[0]));
    if (list.length === 1 && isPdfBytes(firstBytes)) {
      if (onProgress) onProgress({ stage: 'read', ratio: 1, text: '检测到 PDF 原文件，跳过图片合并' });
      if (typeof onStats === 'function') {
        onStats({ pages: null, passthrough: true, reencoded: 0, downscaled: 0, sourceBytes: firstBytes.length, pdfBytes: firstBytes.length, wholePdf: true });
      }
      return { pdfBytes: firstBytes, pageCount: null, mergedFromImages: false };
    }

    // 多文件里混进 PDF：PDF 无法参与图片合并，直接拦下并说明原因
    for (var i = 0; i < list.length; i++) {
      var isPdf = isPdfBytes(new Uint8Array(await readFileAsArrayBuffer(list[i])));
      if (isPdf) {
        throw fail('merge', '第 ' + (i + 1) + ' 个文件是 PDF，与图片混合无法合并。请只传 PDF，或只传图片。');
      }
    }

    var stats = null;
    var pdf = await imagesToPdfBytes(list, {
      onProgress: onProgress,
      onStats: function (s) { stats = s; if (typeof onStats === 'function') onStats(s); },
    });
    var pdfBytes = new Uint8Array(pdf);
    if (!isPdfBytes(pdfBytes)) throw fail('merge', 'PDF 生成结果异常（缺少 %PDF- 文件头）。');
    return { pdfBytes: pdfBytes, pageCount: list.length, mergedFromImages: true, stats: stats };
  }

  /* ==========================================================================
   * 2.5 两段式：先压缩，再用产出的实测体积判定
   * ======================================================================== */

  /** 批量里是否存在 PNG 源（PNG 策略档只对它们有意义，否则整档白跑一次） */
  function batchHasPng(files) {
    return Array.prototype.some.call(files, function (f) {
      return /\.png$/i.test((f && f.name) || '');
    });
  }

  /**
   * 在某一档的参数下跑一次规整，跑完**必定还原** CONFIG。
   * 用 finally 而不是 try/catch：中途抛错也必须还原，
   * 否则一次失败的压缩会把降采样设置残留给后续所有上传。
   */
  async function tryLadderTier(files, patch, onProgress, onStats) {
    var keys = Object.keys(patch || {});
    var saved = {};
    keys.forEach(function (k) { saved[k] = CONFIG[k]; CONFIG[k] = patch[k]; });
    try {
      return await normalizeToPdfBytes(files, onProgress, onStats);
    } finally {
      keys.forEach(function (k) { CONFIG[k] = saved[k]; });
    }
  }

  /**
   * PDF 专用压缩档：逐页重渲染成 JPEG 再拼回 PDF。
   *
   * 为什么必须单独一条路：PDF 输入在 normalizeToPdfBytes 里是**原字节直通**，
   * 不解码内嵌图，所以 IMAGE_LONG_SIDE_MAX / PNG_POLICY 对它一丝作用都没有，
   * 让图像档去压 PDF 只会空转 N 次。
   * 渲染器由管理台注入（复用其已有的 pdf.js），本模块不引 pdf.js 依赖。
   */
  async function tryPdfTier(pdfFile, tier, onProgress) {
    var pages = await runtime.renderPdfPages(pdfFile, { maxSide: tier.maxSide, quality: tier.quality });
    if (!Array.isArray(pages) || !pages.length) throw fail('compress', 'PDF 逐页渲染没有产出任何页面。');

    // 页面已按目标尺寸出图，这里再叠一次降采样等于连缩两次，必须临时归零
    var saved = CONFIG.IMAGE_LONG_SIDE_MAX;
    CONFIG.IMAGE_LONG_SIDE_MAX = 0;
    try {
      var buffer = await imagesToPdfBytes(pages, { onProgress: onProgress });
      return {
        pdfBytes: new Uint8Array(buffer),
        pageCount: pages.length,
        mergedFromImages: true,
        stats: null,
        pdfRerendered: true,
      };
    } finally {
      CONFIG.IMAGE_LONG_SIDE_MAX = saved;
    }
  }

  /**
   * 两段式的完整实现：按档压缩 → 实测产出 → 达标即停。
   *
   * 为什么不能拿输入体积判定（旧实现就是这么错的，且两头都错）：
   *   误杀 —— 67.71MB 的 PNG 批次压完可能只剩十几 MB，压缩前就拒绝等于连试都没试；
   *   误放 —— 59MB 输入走无损 PNG 可能产出 100MB+，压缩前放行，后面才炸。
   * 所以判定必须落在"真正要上传的那个东西"上：产出的 PDF。
   *
   * 梯子是"够用即停"，不是"一路压到底"：第一档是无损，能过就永远走无损。
   *
   * @returns {Promise<{pdfBytes:Uint8Array, pageCount:number|null, mergedFromImages:boolean,
   *                    stats:Object|null, ladder:Object}>} ladder 为本次的选档与逐档实测记录
   */
  async function runCompressLadder(files, onProgress, onStats) {
    var onP = typeof onProgress === 'function' ? onProgress : function () {};
    var onS = typeof onStats === 'function' ? onStats : function () {};
    var target = Number(CONFIG.MAX_OUTPUT_BYTES) || 0;

    var all = (Array.isArray(CONFIG.COMPRESS_LADDER) && CONFIG.COMPRESS_LADDER.length)
      ? CONFIG.COMPRESS_LADDER
      : [{ id: 'lossless', label: '无损直通', patch: {} }];
    // 关掉自动降画质时只跑第一档，产出超目标也不再往下压
    var ladder = CONFIG.AUTO_DOWNSCALE ? all : [all[0]];

    var attempts = [];
    var best = null;
    var bestAttempt = null;
    var touchedPdf = false;

    for (var i = 0; i < ladder.length; i++) {
      var tier = ladder[i] || {};
      if (tier.needsPng && !batchHasPng(files)) {
        attempts.push({ id: tier.id, label: tier.label, bytes: null, skipped: '本批没有 PNG 源' });
        continue;
      }

      onP({
        stage: 'compress',
        ratio: 0,
        text: '压缩档 ' + (attempts.length + 1) + '/' + ladder.length + '：' + tier.label + '…',
      });

      var lastStats = null;
      var produced = await tryLadderTier(files, tier.patch || {}, onP, function (s) { lastStats = s; });
      var bytes = produced.pdfBytes.length;
      attempts.push({ id: tier.id, label: tier.label, bytes: bytes });
      touchedPdf = !produced.mergedFromImages;

      // 取实测最小者：档位顺序理论上单调递减，但不假设它，宁可留个保险
      if (!best || bytes < best.pdfBytes.length) { best = produced; bestAttempt = attempts[attempts.length - 1]; }

      if (!target || produced.pdfBytes.length <= target) break;

      // PDF 直通：图像旋钮对它无效，继续跑图像档纯属空转，交给 PDF 专用档
      if (touchedPdf) break;
    }

    var over = target > 0 && best && best.pdfBytes.length > target;

    // PDF 专用档：仅在"输入是 PDF 且直通超目标"时才有意义
    if (over && touchedPdf) {
      var pdfLadder = (CONFIG.AUTO_DOWNSCALE && Array.isArray(CONFIG.PDF_LADDER)) ? CONFIG.PDF_LADDER : [];
      if (files.length !== 1) {
        attempts.push({ id: 'pdf-render', label: 'PDF 逐页重渲染', bytes: null, skipped: '非单文件 PDF 输入' });
      } else if (!runtime.renderPdfPages) {
        attempts.push({
          id: 'pdf-render',
          label: 'PDF 逐页重渲染',
          bytes: null,
          skipped: '页面未注入 renderPdfPages 渲染器，PDF 无法压缩',
        });
      } else {
        for (var j = 0; j < pdfLadder.length; j++) {
          var t = pdfLadder[j] || {};
          onP({
            stage: 'compress',
            ratio: 0,
            text: 'PDF 压缩档 ' + (j + 1) + '/' + pdfLadder.length + '：' + t.label + '…',
          });
          var rendered = await tryPdfTier(files[0], t, onP);
          var rBytes = rendered.pdfBytes.length;
          attempts.push({ id: t.id, label: t.label, bytes: rBytes });
          if (rBytes < best.pdfBytes.length) { best = rendered; bestAttempt = attempts[attempts.length - 1]; }
          if (rBytes <= target) break;
        }
      }
    }

    var firstId = all[0] && all[0].id;
    var ladderInfo = {
      targetBytes: target,
      outputBytes: best ? best.pdfBytes.length : 0,
      attempts: attempts,
      chosenId: bestAttempt ? bestAttempt.id : null,
      chosenLabel: bestAttempt ? bestAttempt.label : null,
      withinTarget: !target || (best ? best.pdfBytes.length <= target : false),
      // 第一档即无损；选了别的档就说明确实动过画质，必须如实上报而不是悄悄降
      degraded: !!(bestAttempt && firstId && bestAttempt.id !== firstId),
      pdfRerendered: !!(best && best.pdfRerendered),
      rendererAvailable: !!runtime.renderPdfPages,
    };

    onS({ ladder: ladderInfo, pdfBytes: ladderInfo.outputBytes, pages: best ? best.pageCount : null });
    best.ladder = ladderInfo;
    return best;
  }

  /** 把阶梯结果压成一句人话，供进度条与结果面板复用 */
  function describeLadder(ladder) {
    if (!ladder) return '';
    var used = ladder.chosenLabel || '无损直通';
    var head = '产出 ' + fmtSize(ladder.outputBytes);
    if (ladder.withinTarget) {
      return ladder.degraded
        ? head + '（已降至「' + used + '」以满足 ' + fmtSize(ladder.targetBytes) + ' 目标）'
        : head + '（无损，' + used + '）';
    }
    return head + '（已压至最低档「' + used + '」仍超目标 ' + fmtSize(ladder.targetBytes) + '，将按分片上传）';
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
    if (data && data.ok === false) {
      var bizErr = new Error(data.error || ('请求失败（HTTP ' + res.status + '）'));
      bizErr.status = data.status || res.status;   // 供重试逻辑区分瞬时故障与确定性失败
      throw bizErr;
    }
    if (!res.ok) {
      var httpErr = new Error('请求失败（HTTP ' + res.status + '）');
      httpErr.status = res.status;
      throw httpErr;
    }
    return data;
  }

  /**
   * 瞬时故障判定：无状态码 = fetch 网络层失败（断连/抖动），429 与 5xx = 网关/服务端
   * 临时不可用（实测中转分片出现过 HTTP 504）。其余（400/401/403/404…）是确定性
   * 失败，重试只会白打请求。
   */
  function isTransientErr(err) {
    var s = err && err.status;
    if (!s) return true;
    return s === 429 || (s >= 500 && s <= 599);
  }

  /**
   * 带有限重试的 postApi。中转上传是十几次 4MB POST 的串行长链路，任何一次撞上
   * 网关抖动就全盘 abort 的代价太高；而 COS 分片按 (uploadId, partNumber) **覆盖写**，
   * 重传同一片是幂等的 —— 所以只对可安全重放的调用（vaultUpload / vaultPart /
   * vaultComplete）用。vaultInit 例外：若「服务端成功、响应丢失」时重试会拿到第二个
   * UploadId，旧的会变成无人清理的残留分片会话。
   * @param {object} payload postApi 请求体
   * @param {{attempts?:number, onRetry?:(attempt:number, err:Error)=>void}} [opts]
   */
  async function postApiRetry(payload, opts) {
    var attempts = (opts && opts.attempts) || 3;
    var onRetry = opts && opts.onRetry;
    for (var i = 1; ; i++) {
      try {
        return await postApi(payload);
      } catch (err) {
        if (i >= attempts || !isTransientErr(err)) throw err;
        if (onRetry) onRetry(i, err);
        await new Promise(function (r) { setTimeout(r, 800 * i); });   // 0.8s → 1.6s
      }
    }
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
   * getAuthorization 必须用回调风格把凭证交还 SDK（见函数内注释）；
   * SDK 在凭证过期时会自动重新拉取，不会出现长时间挂着页面上传失败在最后一刻报签名错误的情况。
   */
  function getCosInstance() {
    var COS = root && root.COS;
    if (typeof COS !== 'function') {
      throw fail('upload', 'cos-js-sdk-v5 未加载（需要 <script src=".../cos-js-sdk-v5.min.js">）。');
    }
    if (cosInstance) return cosInstance;
    cosInstance = new COS({
      // cos-js-sdk-v5 的 getAuthorization 是**回调风格**：SDK 只把内部回调作为第二个
      // 参数传入并等待它被调用，返回值（包括 Promise）会被完全忽略 ——
      // 返回 Promise 的话 SDK 永远等不到凭证，putObject 无限挂起；鉴权失败的
      // rejection 也没人接，变成 unhandled rejection，不报错、不降级，
      // 界面上就是进度永远停在「直传 COS：0%」。结果与错误都必须走 callback。
      getAuthorization: function (options, callback) {
        fetchCosCredential()
          .then(function (cred) {
            callback({
              TmpSecretId: cred.tmpSecretId,
              TmpSecretKey: cred.tmpSecretKey,
              XCosSecurityToken: cred.sessionToken,
              StartTime: cred.startTime,
              ExpiredTime: cred.expiredTime,
            });
          })
          .catch(function (err) {
            callback(err);
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
              // cos-js-sdk-v5 的 info.percent 是 0~1 比例（源码：Math.floor(loaded/total*100)/100），
              // 不是 0~100 的百分数。直接当百分数用会导致：进度条全程停在 0%，
              // 文案先是「上传中」（percent=0 为假值），之后永远显示 0%/1%。
              var ratio = info && typeof info.percent === 'number'
                ? Math.max(0, Math.min(1, info.percent))
                : 0;
              onProgress({
                stage: 'upload',
                ratio: ratio,
                text: '直传 COS：' + Math.round(ratio * 100) + '%',
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
   * 分片大小的安全取值。
   * 下界 1MB 是 COS 对"非末片"的硬要求（低于它 CompleteMultipartUpload 会失败）；
   * 上界 4MB 是云函数 MAX_BYTES 的单次上限 —— 取更大会被 413 挡回来。
   */
  function vaultPartSize() {
    var want = Number(CONFIG.VAULT_PART_BYTES) || 4 * 1024 * 1024;
    return Math.min(4 * 1024 * 1024, Math.max(1024 * 1024, want));
  }

  /**
   * 通道 B · 单次上传：把密文文本交给云函数，由云函数用自身凭证 putObject。
   * 走 action:'vaultUpload'（只放开 comic_vault/ 前缀 + 只收 *_secure.txt）。
   *
   * 字段名是 dataText 而非 dataBase64：这个值**本身就是**密文（已是 Base64 文本），
   * 不是"某个二进制对象的 base64"。叫 dataBase64 会让人误以为还要再解一层。
   * ContentType 由服务端强制，客户端传了也不作数，故不传。
   */
  async function uploadCipherViaProxy(base64, key, onProgress) {
    if (onProgress) onProgress({ stage: 'upload', ratio: 0.1, text: '经云函数中转上传…' });
    var res = await postApiRetry({ action: 'vaultUpload', key: key, dataText: base64 });
    if (onProgress) onProgress({ stage: 'upload', ratio: 1, text: '中转上传完成' });
    return { key: res.key || key, url: keyToPublicUrl(res.key || key), etag: res.etag, channel: 'proxy' };
  }

  /**
   * 通道 B · 分片上传：突破单请求 body 6MB 的上限。
   *
   * 切分方式：密文本身已是 Base64 **文本**，所以直接按文本下标切子串即可，
   * 各片原样拼接就是完整密文 —— 客户端与服务端都不需要任何重组逻辑。
   * **绝不能再套一层 base64**：那会让每片的传输体积多 33%，
   * 4MB 的片会顶到 5.33MB，紧贴 6MB body 上限且毫无收益。
   *
   * 失败必须 abort：残片会一直占存储且在控制台不可见，是最难发现的一类泄漏。
   */
  async function uploadCipherViaMultipart(base64, key, onProgress) {
    var onP = typeof onProgress === 'function' ? onProgress : function () {};
    var text = String(base64 || '');
    if (!text) throw fail('upload', '密文为空，无法分片上传。');

    var partSize = vaultPartSize();
    var total = Math.ceil(text.length / partSize);
    if (total > 10000) throw fail('upload', '分片数 ' + total + ' 超过 COS 的 10000 上限，请减小目标体积。');

    onP({ stage: 'upload', ratio: 0, text: '密文 ' + fmtSize(text.length) + '，准备分 ' + total + ' 片上传…' });
    var init = await postApi({ action: 'vaultInit', key: key });
    var uploadId = init && init.uploadId;
    if (!uploadId) throw fail('upload', '云函数未返回 UploadId，分片初始化失败。');

    var parts = [];
    try {
      for (var i = 0; i < total; i++) {
        var seg = text.substr(i * partSize, partSize);
        var res = await postApiRetry(
          {
            action: 'vaultPart',
            key: key,
            uploadId: uploadId,
            partNumber: i + 1,
            dataText: seg,
          },
          {
            onRetry: function (attempt, err) {
              onP({
                stage: 'upload',
                ratio: i / total,
                text: '第 ' + (i + 1) + '/' + total + ' 片网络抖动（' +
                      (err && err.message ? err.message : '未知错误') + '），自动重试 ' + attempt + '/2…',
              });
            },
          }
        );
        if (!res || !res.etag) throw fail('upload', '第 ' + (i + 1) + ' 片上传后未返回 ETag。');
        parts.push({ partNumber: i + 1, etag: res.etag });
        onP({
          stage: 'upload',
          ratio: (i + 1) / total,
          text: '分片上传 ' + (i + 1) + '/' + total + '：' + fmtSize(seg.length) + '（累计 ' + Math.round(((i + 1) / total) * 100) + '%）',
        });
      }

      // complete 若「服务端成功、响应丢失」，重试会拿到 NoSuchUpload —— 限定 2 次，
      // 且失败时提示对象可能已就位，避免误导管理员以为整份密文丢了
      var done;
      try {
        done = await postApiRetry(
          { action: 'vaultComplete', key: key, uploadId: uploadId, parts: parts },
          { attempts: 2 }
        );
      } catch (err) {
        throw fail('upload', '分片合并请求失败：' + (err && err.message ? err.message : err) +
                  '（若反复出现，请先到 COS 控制台确认该 key 是否其实已合并完成）');
      }
      onP({ stage: 'upload', ratio: 1, text: '分片合并完成（共 ' + total + ' 片）' });
      return {
        key: (done && done.key) || key,
        url: keyToPublicUrl((done && done.key) || key),
        etag: done && done.etag,
        channel: 'proxy-multipart',
        parts: total,
      };
    } catch (err) {
      // 清理失败不能盖掉真正的错误，所以单独吞掉并只留一条告警
      try {
        await postApi({ action: 'vaultAbort', key: key, uploadId: uploadId });
        console.warn('[LeVihanVault] 分片上传失败，已中止并清理残片：', err && err.message);
      } catch (abortErr) {
        console.warn('[LeVihanVault] 中止分片失败，可能存在残留分片，key=' + key, abortErr && abortErr.message);
      }
      throw err;
    }
  }

  /** 依 UPLOAD_MODE 选择通道；auto 模式下 SDK 不可用 / 凭证接口缺失会自动降级 */
  async function uploadCipher(base64, blob, key, onProgress) {
    var mode = CONFIG.UPLOAD_MODE;
    var canUseSdk = mode !== 'proxy' && root && typeof root.COS === 'function';
    if (canUseSdk) {
      try {
        // 直传开始的事件：加密完成时进度条停在 100%，SDK 从发请求到第一个
        // onProgress 回调有约 1s 空窗，不钉住的话界面会短暂显示「100% 加密完成」。
        if (onProgress) onProgress({ stage: 'upload', ratio: 0, text: '开始直传 COS…' });
        return await putCipherToCos(blob, key, onProgress);
      } catch (err) {
        if (mode === 'sdk') throw err;
        console.warn('[LeVihanVault] 浏览器直传失败，降级为中转上传：', err && err.message);
      }
    }
    // 中转通道按体积分流：小的单次，大的必须分片，否则必然撞 6MB body 上限
    return String(base64 || '').length > vaultPartSize()
      ? uploadCipherViaMultipart(base64, key, onProgress)
      : uploadCipherViaProxy(base64, key, onProgress);
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
   * @returns {Promise<{key:string,url:string,channel:string,parts:number|null,
   *                    bytes:Object,pageCount:number|null,ladder:Object}>}
   *          ladder 记录本次选中的压缩档与逐档实测体积，供结果面板如实展示画质是否被动过
   */
  async function handleComicUpload(input, options) {
    options = options || {};
    var onProgress = typeof options.onProgress === 'function' ? options.onProgress : function () {};
    var startedAt = Date.now();

    var files = input instanceof FileList || Array.isArray(input) ? Array.prototype.slice.call(input) : [input];
    files = files.filter(Boolean);
    if (!files.length) throw fail('read', '请先选择要上传的图片或 PDF。');

    onProgress({ stage: 'read', ratio: 0, text: '读取文件（' + files.length + ' 个）…' });

    /* ---- 步骤 2（两段式）：先压缩，再用产出的实测体积判定 ---- */
    var normalized = await runCompressLadder(files, onProgress, null);
    var pdfBytes = normalized.pdfBytes;
    var mergeStats = normalized.stats;
    var ladder = normalized.ladder;

    var origin = normalized.pdfRerendered
      ? '（由 ' + normalized.pageCount + ' 页 PDF 逐页重渲染）'
      : (normalized.mergedFromImages ? '（由 ' + normalized.pageCount + ' 张图片合并）' : '（原文件直通）');
    onProgress({
      stage: 'read',
      ratio: 1,
      text: 'PDF 就绪：' + fmtSize(pdfBytes.length) + origin + '　·　' + describeLadder(ladder),
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
      parts: uploaded.parts || null,
      etag: uploaded.etag,
      pageCount: normalized.pageCount,
      mergeStats: mergeStats,
      ladder: ladder,
      bytes: {
        source: (mergeStats && mergeStats.sourceBytes) || pdfBytes.length,
        pdf: pdfBytes.length,
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
        '（PDF ' + fmtSize(result.bytes.pdf) + ' → 密文 ' + fmtSize(result.bytes.cipher) + '，' +
        (result.elapsedMs / 1000).toFixed(1) + 's，通道 ' + result.channel +
        (result.parts ? ' ×' + result.parts + ' 片' : '') + '）',
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
    buildPageImage: buildPageImage,
    readJpegHeader: readJpegHeader,
    encryptPdfBytesToBase64: encryptPdfBytesToBase64,
    encryptPdfToCipherPayload: encryptPdfToCipherPayload,
    wrapBase64AsTextBlob: wrapBase64AsTextBlob,
    buildVaultKey: buildVaultKey,
    keyToPublicUrl: keyToPublicUrl,
    uploadCipher: uploadCipher,

    // 两段式：压缩阶梯与产出判定
    runCompressLadder: runCompressLadder,
    describeLadder: describeLadder,
    tryLadderTier: tryLadderTier,
    tryPdfTier: tryPdfTier,
    batchHasPng: batchHasPng,
    // 分片上传（大密文走这条路，逐片可测）
    uploadCipherViaMultipart: uploadCipherViaMultipart,
    uploadCipherViaProxy: uploadCipherViaProxy,
    vaultPartSize: vaultPartSize,

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
