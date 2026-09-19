# 漫画 / 文档「深度加密直传 COS」接入说明

管理台上传台（`public/admin/index.html`）新增的「含有敏感元素」开关，以及站点侧的加密阅读器。
本文件讲清整条闭环怎么接线、怎么复核、边界在哪。涉及的文件：

| 位置 | 角色 |
| --- | --- |
| `public/admin/secure-upload.js` | 上传侧核心：图片→PDF、AES 加密、伪装 Key、直传 COS |
| `public/admin/index.html` | 复选框、分流、进度条、卡片徽章 |
| `src/components/SecureComicReader.tsx` | 阅读侧：403 伪装页 + 一密双解 + Canvas 瀑布流 |
| `src/components/DoujinshiArchive.tsx` | 卡片徽章与路由分流 |
| `cloudbase/functions/admin-upload/index.js` | `normalizeBook()` 增加 `secure` 字段白名单 |
| `scripts/sync-archive.mjs` | 保全 `secure`，避免表格同步覆盖掉 |

> 本文档刻意放在 `docs/` 而不是 `public/`：`public/` 下的文件会被原样发布到站点，
> 而这里写着密码、IV 与后台路径。

---

## 一、流水线四步

| 步骤 | 做什么 | 落在哪 |
| --- | --- | --- |
| ① 交互 | 勾选「含有敏感元素」→ 走加密流程；未勾选 → 原样走 `uploadAll()` 的普通图片流程 | `index.html` → `isSecureMode()` / `refreshSecureUI()` |
| ② 预处理 | 图片按文件名自然排序，**在浏览器内存里**用 jsPDF 合并成一份 PDF；输入本身就是 PDF 则跳过 | `secure-upload.js` → `imagesToPdfBytes()` / `normalizeToPdfBytes()` |
| ③ 强拦截 + 加密 | 拦下 PDF 字节流：`SHA-256("levihan")` 派生密钥 → `AES-256-CBC` → `Base64` → `new Blob([base64], {type:'text/plain'})` | `encryptPdfToCipherPayload()` |
| ④ 伪装 + 上传 | Key 抹掉 `.pdf/.jpg/...` 强改 `.txt`；Body 换成密文 Blob → `cos.putObject` | `buildVaultKey()` / `uploadCipher()` |

界面上只有一个「上传并发布」按钮，分流点在 `uploadAll()` 的第一行。

上传成功后还有 **下游一读**：站点读 `archive.json` 上的 `secure` 标记 → 卡片显示徽章 →
点开进 `SecureComicReader`（403 伪装页 → 校验码 → 一密双解 → Canvas 瀑布流）。见第五节。

---

## 二、管理台里的五处改动

1. **引入脚本**（`tools.js` 之后）：
   ```html
   <script src="https://cdn.jsdelivr.net/npm/cos-js-sdk-v5@1.8.7/dist/cos-js-sdk-v5.min.js"></script>
   <script src="./secure-upload.js"></script>
   ```
   COS SDK 加载失败不影响页面：`secure-upload.js` 会自动降级为中转上传通道。

2. **复选框**（C 内页图片区块，画质滑杆下方）：`<input type="checkbox" id="opt-secure">`，
   联动按钮文案、拖拽区说明、文件选择器 `accept`（加密模式下额外放行 `application/pdf`）。

3. **文件接收放宽**：`addFiles()` 在加密模式下允许 PDF 入列（普通模式仍然只收图片），
   PDF 用内联 SVG 占位缩略图，避免相册里出现破图。

4. **归档标记**：加密路径发布时带 `secure: true`，普通路径显式带 `secure: false`，
   「已收录作品」列表里带标记的本子显示红色「🔒 含有敏感元素」徽章。
   语义细节见第五节 5.1。

5. **敏感本封面**（勾选后出现在内页选择框下方）：`#secure-cover-box`，单张、不加密、
   可**就地裁切**（复用图片编辑器），走普通 upload 通道落到 `{ID}/cover.<ext>`，
   让前台卡片有图可显示。详见第五节 5.2。

---

## 三、用 CyberChef 复核 / 手工解密

流水线等价于下面这条 CyberChef Recipe，可直接粘进 <https://gchq.github.io/CyberChef/> 验证：

| # | Operation | 参数 |
| --- | --- | --- |
| 1 | `SHA2` | Size = 256 |
| 2 | `AES Encrypt` | Mode = `CBC`，Key = `Hex`（第 1 步的输出），IV = `UTF8`，Input = `Raw`，Output = `Raw` |
| 3 | `To Base64` | — |

- 密码：`levihan`（明文）→ 第 1 步得到 32 字节密钥（SHA-256 输出正好是 AES-256 的密钥长度）
- IV：`levihan-vault-iv`（16 字节 ASCII）
- 自动解密可反过来跑 `From Base64` → `AES Decrypt`（同参数），输出 `%PDF-1.x` 即可确认无误

> IV 长度是 16 字节的硬约束：写成 15 字节 `WebCrypto` 会直接抛错。`ivBytes()` 里有断言，
> `tests/secure-vault.test.cjs` 里也有专门的用例守着。

---

## 四、后端需要的两个 action

两条通道各需要一个新分支，都加在 `cloudbase/functions/admin-upload/index.js` 的
`switch (payload.action)` 里（该函数已有管理员 token 校验与 `putObject` / `httpError` 工具）。

### 通道 A（推荐）：`cosCredential` —— 浏览器直传

```js
// 把云函数运行时由平台注入的临时凭证交给浏览器，供 cos-js-sdk-v5 直传使用。
// 这些凭证自带有效期，绝不要把长期 SecretId/SecretKey 下发到前端。
case 'cosCredential': {
  const now = Math.floor(Date.now() / 1000);
  return {
    ok: true,
    credentials: {
      tmpSecretId: process.env.TENCENTCLOUD_SECRETID,
      tmpSecretKey: process.env.TENCENTCLOUD_SECRETKEY,
      sessionToken: process.env.TENCENTCLOUD_SESSIONTOKEN,
      startTime: now,
      // 保守取 10 分钟：宁可让 SDK 多刷几次，也不要拿已过期的凭证去签名
      expiredTime: now + 10 * 60,
    },
    bucket: BUCKET,
    region: REGION,
  };
}
```

> 更严谨的做法是用 CAM / STS `GetFederationToken` 下发**范围收敛**到 `comic_vault/` 前缀的凭证。
> 上面这段复用平台凭证，权限是整个环境角色的权限 —— 只在管理台（管理员 token 之后）使用才成立。

### 通道 B（降级）：`vaultUpload` —— 经云函数中转

```js
// 密文中转：只放行 comic_vault/ 下的 .txt，且必须是 Base64 文本。
const VAULT_MAX_BYTES = 4 * 1024 * 1024;   // 见下方说明：受请求体上限约束，不要调大太多
case 'vaultUpload': {
  const key = String(payload.key || '').trim();
  if (!/^comic_vault\/[A-Za-z0-9_-]+_secure\.txt$/.test(key)) throw httpError('非法的密文 Key', 400);

  const b64 = String(payload.dataBase64 || '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw httpError('密文必须是 Base64 文本', 400);

  const size = Math.floor((b64.length * 3) / 4);
  if (size > VAULT_MAX_BYTES) throw httpError(`密文超过 ${(VAULT_MAX_BYTES / 1024 / 1024).toFixed(1)}MB 上限`, 413);

  const body = Buffer.from(b64, 'base64');
  if (!body.length) throw httpError('密文为空', 400);

  await putObject({
    Bucket: BUCKET, Region: REGION, Key: key, Body: body,
    ContentType: 'text/plain; charset=utf-8',
    CacheControl: 'public, max-age=31536000',
  });
  return { ok: true, key, bytes: body.length };
}
```

**通道选择**：`CONFIG.UPLOAD_MODE` 默认 `'auto'` —— 优先直传，凭证接口不可用时自动降级。
- 直传没有请求体上限，适合几十 MB 的整本漫画；
- 中转受该云函数已有的 `MAX_BODY = 6MB` 约束，Base64 还要再膨胀 33%，实际只能传小文件。

现有 `action:'upload'` **不能**复用：它的 `FILE_RE` 只允许图片后缀，传 `.txt` 会被 400 拦掉。

---

## 五、阅读端：403 伪装页 + 一密双解 + Canvas 瀑布流

组件在 `src/components/SecureComicReader.tsx`，由 `DoujinshiArchive.tsx` 在 `book.secure === true` 时渲染
（分流点在 `handleOpenBookReader`，放在长图阅读模式**之前** —— 敏感本子绝不允许落到任何图片直链渲染路径上）。

### 5.1 归档字段契约

`secure` 是打通两端唯一的开关，链路如下：

| 环节 | 变化 |
| --- | --- |
| 管理台上传 | 勾选后 `api({action:'publish', book:{..., secure:true}})` |
| 云函数 `normalizeBook()` | `if (typeof raw.secure === 'boolean') book.secure = raw.secure;` |
| COS `archive.json` | 多出 `"secure": true` |
| 站点卡片 | 标题旁出现红色「🔒 含有敏感元素」徽章；封面位有单独封面就显示，没有则退回隔离占位 |
| 点开 | 走 `SecureComicReader`，不进长图画廊 |

**清除语义**：显式传 `false` 才会清掉标记；不带这个键则保留原值。
所以「上传并发布」的普通路径一定会带 `secure: false`（内页已被换成普通图片，
不清掉的话站点会拿着旧标记去解一批根本不存在的密文），而「仅更新信息」不带，避免只改标题就把标记弄丢。

### 5.2 敏感本封面：单独一张、不加密

内页被合并进 PDF 再整体加密，密文里**没有任何可读图片**，所以卡片想要有封面，只能另存一张公开图。

- **管理台**：勾选「🔒 含有敏感元素」后，内页选择框下方出现独立区块「🖼 敏感本封面」（`#secure-cover-box`）。
  单张、支持点选或拖入，选完即时预览。取消勾选会丢弃这次选的封面并回退它写过的 `coverFile` 值。
- **就地裁切**：封面区右上角有「✂ 裁切」按钮（`#secure-cover-crop`，没选封面时置灰）。
  点开的是**内页图片共用的那套图片编辑器**，所以自动拿到 2:3 竖版裁剪框、马赛克涂抹、
  「站点效果」预览 —— 裁出来的就是卡片实际会显示的样子。
  分流靠 `edTarget`（`'page'` = 写回 `files[]`；`'secure-cover'` = 写回 `secureCover`），
  封面走的是 `idx: -1` 的合成编辑对象，**不会**混进 `files[]`。
  完工由 `commitSecureCoverEdit()` 回写：统一转 WebP、原名主干换 `.webp` 后缀，
  落库名仍由 `secureCoverName()` 钉成 `cover.webp`；上次的裁剪参数记在 `secureCover.op`，
  再点一次裁切能接着改。《tests/secure-cover-contract.test.cjs》里钉着这几条契约。
- **上传通道**：走**普通** `api({action:'upload'})`，不是 COS 直传、更不进加密流水线。
  能转 WebP 就转（卡片首屏图，越小越好），浏览器不支持编码时原样上传。
  裁切产物在上传前已经被烘进这张图，上传侧不需要知道裁过没有。
- **落库文件名**：固定为 `cover.<ext>`，即 Key = `{bookFolder}/cover.<ext>`。
  固定名字让「重传同一本」天然覆盖旧封面，桶里不会堆垃圾。
- **归档字段**：上传成功后把 `coverFile = 'cover.webp'` 写回「封面文件」字段，随 `publish` 一起入库。
  `getCoverUrl()` 按 `{bookFolder}/{coverFile}` 拼 CDN 地址，无需任何改动。
- **上传顺序**：**封面先传，密文后传**。反过来的话，密文传完才发现封面挂了，
  归档里就会留下一个指向不存在文件的 `coverFile`。
- **站点**：`DoujinshiArchive.tsx` 里敏感本分支改成
  `book.coverFile && !failedCovers.has(book.id)` → 显示封面，否则显示 `RESOURCE ISOLATED` 占位。
  判定用 `coverFile` 是否存在（而不是 `coverUrl` 是否非空）—— 后者对未设封面的本子会默认成
  `image01.webp`，永远为真，会白发一次请求再走 `onError`。

> ⚠️ **诚实的边界**：这张封面是**明文、公开可访问**的（同目录下任何人都能直接打开）。
> 它挡不住也不打算挡任何东西，只是让卡片有个像样的图。**别把敏感画面放封面。**

### 5.3 一密双解

用户输入的校验码同时用于两层，全程在内存里完成：

```ts
// 外层：crypto-js 解 AES-256-CBC
const key = CryptoJS.SHA256(password);                       // 32 字节 → AES-256
const iv  = CryptoJS.enc.Utf8.parse('levihan-vault-iv');
const decrypted = CryptoJS.AES.decrypt(
  CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(cipherText) }),
  key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
);
// ⚠ 解出来**直接就是 PDF 的二进制字节**：不要再用 Utf8 去读它（PDF 里有非 UTF-8 字节，
//   会抛 Malformed UTF-8 data），也不要再做一次 Base64 解码
const pdfBytes = wordArrayToBytes(decrypted);

// 内层：同一个密码透传给 PDF.js，解 jsPDF 施加的 PDF 标准口令
const doc = await pdfjsLib.getDocument({ data: pdfBytes, password }).promise;
```

- 内层只有在"先用工具箱「图片/文件转加密 PDF」做出带口令的 PDF，再勾选敏感元素上传"时才真正存在。
  直接传图片时内层是普通 PDF，多传一个 `password` 会被 pdf.js 忽略 —— 两种情况都能跑，不需要分支。
- 解锁后会先校验 `%PDF-` 魔数再交给 pdf.js：密码错误时宁可明确失败，也不要把乱码喂进去。
- PDF.js 的 worker 走 CDN（`https://cdn.staticfile.net/pdf.js/3.11.174/pdf.worker.min.js`），
  **版本必须与 `pdfjs-dist` 完全一致**，所以 `package.json` 里它是精确版本（无 `^`）。

### 5.4 Canvas 瀑布流与"无痕"措施

- 每一页用 `page.render()` 画进独立的 `<canvas>`，页面里**不出现任何 `<img>`，也不生成 .pdf 直链或 blob URL**。
- 用 `IntersectionObserver` 控制：进出视口才渲染，**离开两屏后主动把画布清空并置零尺寸**
  —— 既压住内存，也让"一路滚到底再批量另存"拿不到完整内容。
- `document.oncontextmenu = () => false` 与 F12 / Ctrl+Shift+I·J·C / Ctrl+U / Ctrl+S 的拦截，
  都在组件挂载时生效、**卸载时恢复原值**（不会把整站的右键永久禁掉）。

> 必须说清楚：上面这些是提高门槛，不是安全机制。任何人都能用 curl 取到那个 .txt，
> 用本文第三节的 CyberChef 配方离线解开。真正的机密性只能来自服务端密钥。

### 5.5 页面文案（伪装层）

- 标题 `403 Forbidden`，配 `SECURE NODE GATEWAY` / `ERR_RESOURCE_ISOLATED` 等系统字段表，
  视觉走冷灰白 + 等宽字体的标准 Web 服务器报错页，**刻意不沾站点自身的羊皮纸主题**。
- 正文用社会工程学话术，全程不出现"密码""漫画""解密"等字样；
  输入框 `placeholder` 为「输入专属安全校验码」，按钮为「启动解析」。
- 失败文案也在同一语境里：校验码错误 → 「校验码无效，节点拒绝解析。」
  网络失败 → 「安全节点未响应，请检查网络后重试。」（不暴露加密方式与文件类型）
- 暗号提示：「提示：兵长与韩吉的cp名。」

---

## 六、把两半接起来：别忘了 sync-archive

`scripts/sync-archive.mjs` 会用表格 CSV **整体重建并覆盖** COS 上的 `archive.json`。
表格里没有这些字段，所以脚本里加了一步 `preserveFlags()`：
上传前从公开域名读回线上 `archive.json`，按 `id` 把后台标记接过来。

- 保全清单 `KEEP = ['secure', 'coverFile']`：
  - `secure` —— 丢了这本就退回普通图集，阅读端行为直接错；
  - `coverFile` —— 后台选定的真实封面文件名（含敏感本单独上传的 `cover.*`），
    丢了会被 `buildArchive()` 的默认值重置成 `image01.webp`，前台封面直接裂。
- 读不到线上文件时只警告、不阻断，绝不因为保全逻辑让同步失败。
- **另一个既有风险**：`pageFiles`（后台上传时逐页记录的真实文件名）同样会被这个脚本覆盖掉。
  这是本次改动之前就存在的问题，需要你确认是否也要一起保全 —— 目前**没有**动它。

---

## 七、安全边界（务必知悉，别当成"真加密"）

- **这是固定外壳密码**：密码、密钥派生方式、IV 全部写在交付到浏览器的 JS 里。
  它的真实作用是让 COS 上的文件**不可直接预览、不可被爬虫或静态目录识别、脱离本站无法阅读**；
  它**不能**抵御拿到前端代码的有心人 —— 用本文件第三节的 CyberChef Recipe，任何人都能离线解开。
- 要做真正的机密性，密钥必须来自服务端：每本一密、随管理员登录态下发、不入前端代码。
  届时把 `CONFIG.SHELL_PASSWORD` 换成运行时注入的密钥即可，其余流程不用动。
- **固定 IV 的代价**：相同明文前缀会产生相同密文前缀。整本漫画之间差异很大，实际泄露可以忽略；
  想彻底消除就把 `CONFIG.RANDOM_IV` 置 `true` —— 密文前 16 字节会带上每文件随机 IV，
  解密端自动识别。代价是**不再与第三节的 CyberChef 固定 IV 配方等价**。
- Key 命名段会剥掉尾部扩展名并清掉 `/`、`.` 等字符，避免 `bookId` 被用来做路径穿越。
- **封面是这条链上唯一的明文出口**（见 5.2）。它落在 `{ID}/cover.<ext>`，与内页同一个桶、
  同一个公开域名，任何人拿到地址都能直接打开。它存在的唯一理由是让卡片不显示隔离占位图，
  **不承担任何保密职责** —— 把敏感画面放封面等于把它公开。

---

## 八、已知限制

- **Key 默认不带时间戳**（`CONFIG.VERSIONED_KEY = false`）：`comic_vault/lh-123_secure.txt`。
  这样重传是幂等覆盖、不会留孤儿对象，而且阅读端仅凭 `bookId` 就能反推 Key
  —— 现有云函数的 `normalizeBook()` 是字段白名单，透传不了 `vaultKey` 字段。
  要严格按需求原文的 `comic_vault/${Date.now()}_secure.txt`，把这个开关置 `true`，
  但同时得自己找地方存这条 Key。
- **归档模型不匹配**：加密本没有 `pageFiles`（内页都在 PDF 里），所以站点画廊取不到逐页图，
  阅读端改走 Canvas 瀑布流（第五节）。缩略图则由 5.2 的单独封面提供 —— 没设封面的本子在
  「已收录作品」列表里显示隔离占位，这是预期行为而非故障。
- **裁切只作用在封面这一张明文图上**，跟密文里的内页没有任何关系：
  裁封面的编辑器不会也不能改动 PDF / 密文。想让内页也裁，得在合并成 PDF **之前**
  用内页图片编辑器逐张处理（`edTarget === 'page'` 那条路径）。
- **总页数**：`syncPages()` 会把「总页数」自动设成选中文件数。传 PDF 时这是 1，请手工改成真实页数
  （合并图片时则自动就是张数）。阅读端实际按 PDF 的真实页数渲染，所以这个值只影响卡片上显示的 "nP"。
- **体积**：Base64 让密文比 PDF 大约 33%，再加上 AES 的 16 字节以内填充。
  输入总量上限 `CONFIG.MAX_INPUT_BYTES`（默认 60MB）。
- **两份依赖需要 npm install**：`crypto-js` / `pdfjs-dist` 是本次新增的运行时依赖
  （外加 `@types/crypto-js`）。`pdfjs-dist` 被钉死在 `3.11.174`，因为阅读端 worker 用的是同版本的 CDN 文件，
  版本不一致 pdf.js 会直接报 "API version does not match Worker version"。改版本必须两边一起改。

---

## 九、测试

```bash
# 全部安全相关测试（35 项）
npm run test:secure
```

四个文件各管一段，都不依赖浏览器：

| 文件 | 验什么 |
| --- | --- |
| `tests/secure-vault.test.cjs` | 加密本身。含**已知答案测试**：把 WebCrypto 的密文与 `node:crypto` 的 `createCipheriv('aes-256-cbc', sha256('levihan'), iv)` 逐字节比对，证明这是标准 AES-256-CBC + PKCS#7，不是自定义算法 |
| `tests/secure-pdf-merge.test.cjs` | 图片合并 PDF。用最小 DOM 桩（canvas / createImageBitmap / document）在 Node 里验页数、页面尺寸、端到端往返 |
| `tests/secure-reader-interop.test.cjs` | **一密双解**。用浏览器端同一个实现（crypto-js 解外层 + PDF.js 解内层），验跨实现能对上，并覆盖"必须给密码才能打开 / 同一密码透传即可解锁 / 密码错误明确报错" |
| `tests/secure-cover-contract.test.cjs` | **敏感本封面的跨文件契约**（11 项）。命名规则从管理台真实实现里摘出来跑，钉住：文件名能过云函数 `FILE_RE`、固定 `cover.<ext>`、控件只在敏感模式下出现、**封面先于密文上传**、封面不进加密模块、归档载荷同时带 `secure` 与 `coverFile`、前台按 `coverFile` 判定、同步脚本保全清单含 `coverFile`。另把**封面裁切**的接线钉牢：`#secure-cover-crop` 入口存在且无封面时置灰、`openEditor` 必须把 `edTarget` 重置回 `'page'`、封面走 `idx:-1` 的合成对象、**`edDone` 的封面分支必须排在 `var f = files[i]` 之前**（排在后面会静默写错对象）、回写产物仍是 `cover.webp` 且清空 `uploadedName` 强制重传 |

依赖产物找不到时，各文件会显式 skip（不会伪装成通过）。也可以用环境变量指向从 CDN 取来的构建：

```bash
LH_JSPDF_UMD=/tmp/jspdf.umd.min.js \
LH_CRYPTOJS=/tmp/crypto-js.min.js \
LH_PDFJS_LEGACY=/tmp/pdfjs-legacy.js \
LH_PDFJS_WORKER=/tmp/pdf.worker.js \
node --test tests/secure-reader-interop.test.cjs
```

产物体积约：jsPDF UMD 364KB / crypto-js 60KB / pdfjs legacy 711KB + worker 2.1MB。
`LH_PDFJS_LEGACY` 必须配同目录的 `pdf.worker.js`（Node 下 fake worker 是按相对路径找的）。
