# 漫画 / 文档「深度加密上传 COS」接入说明

管理台上传台（`public/admin/index.html`）新增的「含有敏感元素」开关，以及站点侧的加密阅读器。
本文件讲清整条闭环怎么接线、怎么复核、边界在哪。涉及的文件：

| 位置 | 角色 |
| --- | --- |
| `public/admin/secure-upload.js` | 上传侧核心：图片→PDF、压缩阶梯、AES 加密、伪装 Key、单次/分片上传路由 |
| `public/admin/index.html` | 复选框、分流、进度条、卡片徽章、PDF 重渲染器（`renderPdfPagesForVault`） |
| `src/components/SecureComicReader.tsx` | 阅读侧：403 伪装页 + 一密双解 + Canvas 瀑布流 |
| `src/components/DoujinshiArchive.tsx` | 卡片徽章与路由分流 |
| `cloudbase/functions/admin-upload/index.js` | vault 系列 5 个 action（`vaultUpload/Init/Part/Complete/Abort`）+ `normalizeBook()` 的 `secure` 字段白名单 |
| `scripts/sync-archive.mjs` | 保全 `secure`，避免表格同步覆盖掉 |

> 本文档刻意放在 `docs/` 而不是 `public/`：`public/` 下的文件会被原样发布到站点，
> 而这里写着密码、IV 与后台路径。

---

## 一、流水线四步

| 步骤 | 做什么 | 落在哪 |
| --- | --- | --- |
| ① 交互 | 勾选「含有敏感元素」→ 走加密流程；未勾选 → 原样走 `uploadAll()` 的普通图片流程 | `index.html` → `isSecureMode()` / `refreshSecureUI()` |
| ② 预处理 + 压缩 | 图片按文件名自然排序，**在浏览器内存里**用 jsPDF 合并成一份 PDF；输入本身就是 PDF 则跳过合并。随后跑**压缩阶梯**（从无损档开始，降到够用为止） | `secure-upload.js` → `imagesToPdfBytes()` / `normalizeToPdfBytes()` / `runCompressLadder()` |
| ③ 判定 + 加密 | 按**产出 PDF 的字节**判定是否达标（旧版按输入字节，量错了对象）；再拦下 PDF 字节流：`SHA-256("levihan")` 派生密钥 → `AES-256-CBC` → `Base64` → `new Blob([base64], {type:'text/plain'})` | `runCompressLadder()` / `encryptPdfToCipherPayload()` |
| ④ 伪装 + 上传 | Key 抹掉 `.pdf/.jpg/...` 强改 `.txt`；Body 换成密文 Blob → 云函数中转，**超 4MB 自动切 COS 分片** | `buildVaultKey()` / `uploadCipher()` |

界面上只有一个「上传并发布」按钮，分流点在 `uploadAll()` 的第一行。

上传成功后还有 **下游一读**：站点读 `archive.json` 上的 `secure` 标记 → 卡片显示徽章 →
点开进 `SecureComicReader`（403 伪装页 → 校验码 → 一密双解 → Canvas 瀑布流）。见第五节。

### 1.1 内页压缩策略（②的细则，都是"不损伤画质"优先）

三个旋钮都在 `secure-upload.js` 的 `CONFIG` 里：

| 旋钮 | 默认 | 含义 |
| --- | --- | --- |
| `IMAGE_LONG_SIDE_MAX` | `0` | 内页降采样长边上限。**0 = 不缩放**。这是唯一真正改画质的操作，所以默认关着 |
| `PNG_POLICY` | `'keep'` | `keep` = PNG 一律保持无损；`auto` = 只有真含 alpha 才留 PNG，其余转 JPEG；`jpeg` = 一律转 JPEG |
| `JPEG_QUALITY` | `0.9` | 只作用于"走 canvas 重编码"的图 |

**JPEG 源在尺寸合格时走原字节直通**（`buildPageImage()` 里判定），完全绕过 canvas：
jsPDF 用 `DCTDecode` 把原始 JPEG 流直接塞进 PDF，**不二次重编码**。
实测一张 661,677 B 的源图产出 664,966 B 的 PDF（开销仅 3,289 B）；
而旧行为是"过 canvas 用 q0.92 重编码"→ 761,348 B，**既涨 15% 又白丢一次画质**。

判定需要知道图片尺寸，但直通路径不经过 canvas 就拿不到 ——
所以用 `readJpegHeader()` **只扫 JPEG 标记段**读出宽高与分量数（不解码像素，开销几 KB）。

⚠️ **PNG 策略只该管 PNG 源。** JPEG 源即便因为要降采样而走 canvas，也必须继续输出 JPEG ——
把一张有损 JPEG 重编码成无损 PNG 只会让体积暴涨，且救不回任何已丢的信息。
（这是实测中真的踩到的 bug，`tests/secure-pdf-compress.test.cjs` 里有回归保护。）

**信息论下界**：若源全是 JPEG 且不降采样，PDF 里存的就是这批 JPEG 的原始字节之和，
**在"不损伤画质"的前提下不可能更小**。要显著减体积只有两条路：
调小 `IMAGE_LONG_SIDE_MAX`（改分辨率）或把 `PNG_POLICY` 改成 `auto`（仅对有 PNG 源的批次有效）。

### 1.2 但是"合出来多大"事前算不出，所以改成事后实测

上面的旋钮是**静态配置**，而实际产出取决于源图成分（是不是 JPEG、有没有 alpha、分辨率分布），
事前无法预判。于是有了 `COMPRESS_LADDER`：**把这些档位排成一列逐档实跑**，
每跑一档就量一次产出体积，**达标立即停手**（无损能过就永远走无损），并把停在哪一档报给用户。
PDF 输入另有一条重渲染阶梯 —— 详见 **4.4 两段式**。

一条重要纪律：**判定用的是产出 PDF 的字节，不是输入字节之和**。
旧版拿输入总和去比 60MB，既会误拦小图合集、又会放过产出超标的大图，两个方向都错（详见 4.2）。

---

## 二、管理台里的六处改动

1. **引入脚本**（`tools.js` 之后）：
   ```html
   <script src="https://cdn.jsdelivr.net/npm/cos-js-sdk-v5@1.8.7/dist/cos-js-sdk-v5.min.js"></script>
   <script src="./secure-upload.js"></script>
   ```
   COS SDK 仍在页面上（`UPLOAD_MODE:'auto'` 会先试直传），但云函数**没有** `cosCredential` 分支，
   所以实测总是落到云函数中转通道 —— 见第四节开头。SDK 加载失败也不影响页面。

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

6. **PDF 重渲染器注入**：`configure({ renderPdfPages: renderPdfPagesForVault })`，
   供 `PDF_LADDER` 逐页重渲染用（`canvasToJpegBlob()` 负责输出 JPEG 以走 DCTDecode 直通）。
   成功后两个面板都会追加 `vaultLadderNote(result)` —— "本次停在哪一档、有没有降画质"。

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

## 四、后端的 vault 系列 action（**已实现**）

原本计划"两条通道各加一个分支"，落地时改成 **云函数中转 + COS 分片兜底**：
`cosCredential` 要下发的其实是**环境角色凭证**（`TENCENTCLOUD_SECRETID/KEY/SESSIONTOKEN`），
权限是整个环境的权限，把它送到浏览器 —— 哪怕只在管理员 token 之后 —— 比原先估计的代价大得多，
因此**没有实现**这条通道。云函数里实际落地的是 `switch (payload.action)` 下的 **5 个 action**
（`cloudbase/functions/admin-upload/index.js`，沿用该函数已有的管理员 token 校验与
`putObject` / `httpError` / `promisify` 工具）：

| action | 作用 |
| --- | --- |
| `vaultUpload` | 单次上传整份密文，适合 ≤ `MAX_BYTES` |
| `vaultInit` | 初始化分片上传，返回 `uploadId` |
| `vaultPart` | 上传单个分片，返回 `etag` |
| `vaultComplete` | 合并全部分片为一个对象 |
| `vaultAbort` | 中止上传并清理残片 |

五个都只收**纯文本密文**，一律按 `text/plain; charset=utf-8` 存，
**不接受客户端指定 ContentType**（密文是 Base64 文本，ContentType 不参与解密；
一旦放开就等于给了"往任意 COS 对象写任意类型"的缺口）。

### 4.1 Key 收敛：前缀与后缀都固定

```js
const VAULT_PREFIX = 'comic_vault/';
const VAULT_KEY_RE = /^comic_vault\/[A-Za-z0-9_-]{1,40}_secure\.txt$/;
const VAULT_CIPHER_TYPE = 'text/plain; charset=utf-8';
const MAX_PART_NUMBER = 10000;
const VAULT_CACHE_CONTROL = 'public, max-age=31536000'; // 必须与前端 CONFIG.CacheControl 一致
```

`assertVaultKey()` 用这条正则拦住**一切**客户端自选路径：`/`、`.`、`..` 全在允许字符集之外，
嵌套目录也进不来（`[A-Za-z0-9_-]{1,40}` 不含 `/`）。缓存策略这条常量在前端
`secure-upload.js` 里镜像了一份 —— 两条通道只要有一条写得不一样，同一个 key
就会因通道不同而拿到不同缓存行为，排查起来极难。

### 4.2 真正的上限是 **3.0 MB**，不是 60 MB

密文的体积链是 `PDF → AES-256-CBC + PKCS#7（≈ 同尺寸）→ Base64（×1.334）`：

| 环节 | 量 |
| --- | --- |
| 云函数 `MAX_BYTES`（校验的是**解码后的密文字节**） | 4 MB |
| ⇒ 对应 Base64 文本长度 | 4 × 1.334 ≈ **5.33 MB** |
| 云函数 `MAX_BODY`（HTTP 访问服务的请求体硬上限） | 6 MB |
| ⇒ **PDF 真正能走的体积上限** | 4 MB ÷ 1.334 ≈ **3.0 MB** |

所以旧管理台那句「待处理总量 67.71 MB，超过上限 60.00 MB」是**量错了对象、并且宽了 20 倍**：
它卡的是**输入图片字节之和**，而上传能不能成取决于**产出 PDF 的字节**。
两者在两个方向上都会误判 —— 一堆小图加起来超 60MB 但 PDF 很小（**被误拦**），
单张巨图 < 60MB 但产出 PDF 超 3MB（**放过去再失败**，用户白等一场）。
现在的做法是**两段式**：先压缩、再按真实产出判定（4.4 节），上传则自动在单次/分片之间分流（4.3 节）。

### 4.3 分片约束（突破 6MB 请求体）

- COS 要求**除最后一个分片外每片 ≥1MB**，所以 `VAULT_PART_BYTES` 被钳在 `[1MB, MAX_BYTES]`，
  默认 4MB（等于单请求体上限，往返次数最少）。
- 分片按密文**文本字节**切分（不是先解码再切），各片原样拼接即为完整密文 —— 客户端零重组逻辑。
- `vaultComplete` 会**排序分片、要求 ETag 齐全、并校验分片号从 1 起严格连续**：
  空洞对象在 COS 侧不会立刻报错但读出来是坏的，宁可在合并前拦掉。
- 任何一步失败，前端必须调 `vaultAbort` —— 残片占存储且不可见，不会自己消失。

### 4.4 两段式：先压缩，再按真实产出判定

| 阶段 | 做什么 | 代码 |
| --- | --- | --- |
| ① 压缩阶梯 | 从最无损的一档开始试，**降到够用为止**，并记下停在哪一档 | `runCompressLadder()` |
| ② 判定 | 拿**产出 PDF 的字节**比 `CONFIG.MAX_OUTPUT_BYTES` | 同上 |
| ③ 加密 | 原流程不变 | `encryptPdfToCipherPayload()` |
| ④ 上传路由 | 密文文本 > `VAULT_PART_BYTES` 走分片，否则单次 | `uploadCipher()` |

**图片路径的阶梯（`COMPRESS_LADDER`）** —— 顺序即"从无损到有损"：

| 档 | 操作 | 前提 |
| --- | --- | --- |
| `lossless` | 空 patch，纯走 `buildPageImage()` 的 JPEG 原字节直通 | — |
| `png2jpeg` | `PNG_POLICY:'auto'`（仅真含 alpha 才留 PNG） | 批次里**确有 PNG**（`batchHasPng()`），否则跳过 |
| `side2400` / `side1600` / `side1200` | `IMAGE_LONG_SIDE_MAX` 依次收敛 | — |

**PDF 路径另有一条阶梯（`PDF_LADDER`）**：输入本身是 PDF 时 `normalizeToPdfBytes()` 是**字节直通**，
上面那些图片旋钮对它**完全无效** —— 内嵌图不会被解码，改 `PNG_POLICY` / `IMAGE_LONG_SIDE_MAX`
一个字节都省不下来。要真的缩小只能重新渲染：

| 档 | 操作 |
| --- | --- |
| `pdf-side2000` | pdf.js 逐页重渲染到长边 2000px，再拼回 PDF（`quality:0.85`） |
| `pdf-side1400` | 同上，长边 1400px（`quality:0.8`） |

渲染器由页面注入（`configure({ renderPdfPages })` → `runtime.renderPdfPages`），
实现是 `index.html` 的 `renderPdfPagesForVault()`。合并重渲染结果时会**临时把
`IMAGE_LONG_SIDE_MAX` 置 0**，否则"重渲染"会被再降采样一次，画质双重损失。

⚠️ **pdf.js 坐标系陷阱（实测踩到，已修 + 已加回归）**：`getViewport({scale:1})` 返回的是
**页面点（point）**，A4 = 595×842，**不是**内嵌图片的像素。最初按"只缩不放"写成
`scale = Math.min(maxSide / baseLong, 1)`，结果 2000 与 1400 两档**都产出 595×842**（等于没渲染）。
修法是显式放大并封顶：

```js
var PDF_VAULT_MAX_SCALE = 3;
var scale = Math.min(maxSide / Math.max(base.width, base.height), PDF_VAULT_MAX_SCALE);
```

修后实测（源 13,062,803 B / 5 页）：`side2000` → 1413×2000 / 9,327,072 B；
`side1400` → 989×1400 / 3,565,483 B。`tests/admin-pdf-expand-contract.test.cjs` 里
有 4 项回归测试钉死这一点。

**降级必须报出来**：`runCompressLadder()` 返回的 `ladder` 带
`chosenId / chosenLabel / outputBytes / targetBytes / withinTarget / degraded / pdfRerendered / attempts`，
`describeLadder()` 把它转成人话贴到两个成功面板上（`vaultLadderNote()`）。
用户必须知道"降到了哪一档、是不是已经动了画质"，否则"压缩后画质变差"会变成一桩无头案。

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
- **没有浏览器直传通道**：密文一律经云函数中转，这意味着上传带宽走云函数出口、
  并且大文件要分片多次往返（默认 4MB/片）。这是权衡后的选择 —— 直传需要把环境角色凭证下发到浏览器，
  收益不足以抵消那道口子（见第四节开头）。给日后要做直传的人：**必须**换成 STS `GetFederationToken`
  下发范围收敛到 `comic_vault/` 前缀的凭证，不能直接复用平台凭证。

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
- **体积（两个数字别搞混）**：
  - `CONFIG.MAX_INPUT_BYTES` = **1GB**，只是"别把标签页拖死"的安全阀，**不是业务上限**。
    旧值 60MB 曾在这里误杀过 67.71MB 的批次。
  - `CONFIG.MAX_OUTPUT_BYTES` = **60MB**，两段式的**业务目标**（压缩阶梯以它为靶心逐档降画质）。
    想完全不降画质就把 `AUTO_DOWNSCALE` 置 `false` 并把它调大。
  - **物理上限是 3.0MB PDF**（4MB 密文 ÷ 1.334），已由分片上传解绑 —— 见 4.2 / 4.3。
- **两份依赖需要 npm install**：`crypto-js` / `pdfjs-dist` 是本次新增的运行时依赖
  （外加 `@types/crypto-js`）。`pdfjs-dist` 被钉死在 `3.11.174`，因为阅读端 worker 用的是同版本的 CDN 文件，
  版本不一致 pdf.js 会直接报 "API version does not match Worker version"。改版本必须两边一起改。
- **分片残留需要人工清**：`vaultAbort` 是唯一清理手段，前端在任一分片失败时会调它；
  但浏览器若在**上传途中被关掉**，已上传的分片会留在 COS 上（不可见但占存储）。
  定期清理是运维项，目前**没有**自动化。
- **`MAX_OUTPUT_BYTES` 与物理上限是两件事**：前者是"单本多少算合理"的业务目标（60MB），
  后者是"到底能不能上传"（3.0MB PDF，已由分片解绑）。
  想让压缩阶梯尽量别动画质，把 `AUTO_DOWNSCALE` 置 `false` 即可 —— 那时超目标也不再降档。

---

## 九、测试

```bash
# 全部安全相关测试（70 项）
npm run test:secure
# 普通路径 PDF 拆页 + 渲染尺度回归（17 项）
npm run test:admin
# vault 分片上传的跨端契约（19 项）
npm run test:vault
# 管理台内联脚本静态检查（62 处裸赋值全部有声明）
npm run check:admin
```

七个文件各管一段，都不依赖浏览器：

| 文件 | 项数 | 验什么 |
| --- | --- | --- |
| `tests/secure-vault.test.cjs` | 12 | 加密本身。含**已知答案测试**：把 WebCrypto 的密文与 `node:crypto` 的 `createCipheriv('aes-256-cbc', sha256('levihan'), iv)` 逐字节比对，证明这是标准 AES-256-CBC + PKCS#7，不是自定义算法 |
| `tests/secure-pdf-merge.test.cjs` | 5 | 图片合并 PDF。用最小 DOM 桩（canvas / createImageBitmap / document）在 Node 里验页数、页面尺寸、端到端往返 |
| `tests/secure-pdf-compress.test.cjs` | 17 | **内页压缩策略**。三块：① `readJpegHeader` 只扫标记段读宽高、非 JPEG 与截断输入安全返回 null；② `buildPageImage` 的路径判定（直通 / 降采样 / PNG 策略 / 有 alpha 保留 PNG / **JPEG 源即使降采样也不得被重编码成 PNG**）；③ 用真实 jsPDF 验直通：**在 PDF 字节流里搜到源 JPEG 的原始字节片段**（这是"零重编码"的硬证据）、体积只有源图 + 几 KB、MediaBox 来自 JPEG 头 |
| `tests/secure-compress-ladder.test.cjs` | 18 | **两段式压缩阶梯**。假 jsPDF（产出体积 = 内嵌数据长度）+ 伪造编码长度，钉住：闸门已变成安全阀（不再按输入字节误杀）、判定看产出、无损档先跑且达标即停、降级必须在 `ladder.degraded` 里报出来、每档跑完 **CONFIG 必须原样还原**（含异常路径）、无 PNG 批次要跳过 png 档、JPEG 源降采样后仍是 JPEG、PDF 直通档不空转、没注入渲染器就跳过 PDF 档、重渲染时 `IMAGE_LONG_SIDE_MAX` 临时置 0、渲染不出页要明确报错 |
| `tests/secure-reader-interop.test.cjs` | 7 | **一密双解**。用浏览器端同一个实现（crypto-js 解外层 + PDF.js 解内层），验跨实现能对上，并覆盖"必须给密码才能打开 / 同一密码透传即可解锁 / 密码错误明确报错" |
| `tests/secure-cover-contract.test.cjs` | 11 | **敏感本封面的跨文件契约**。命名规则从管理台真实实现里摘出来跑，钉住：文件名能过云函数 `FILE_RE`、固定 `cover.<ext>`、控件只在敏感模式下出现、**封面先于密文上传**、封面不进加密模块、归档载荷同时带 `secure` 与 `coverFile`、前台按 `coverFile` 判定、同步脚本保全清单含 `coverFile`。另把**封面裁切**的接线钉牢：`#secure-cover-crop` 入口存在且无封面时置灰、`openEditor` 必须把 `edTarget` 重置回 `'page'`、封面走 `idx:-1` 的合成对象、**`edDone` 的封面分支必须排在 `var f = files[i]` 之前**（排在后面会静默写错对象）、回写产物仍是 `cover.webp` 且清空 `uploadedName` 强制重传 |
| `tests/admin-pdf-expand-contract.test.cjs` | 17 | **普通路径 PDF 拆页的接线 + 敏感路径渲染尺度**（`npm run test:admin`）。前半：页名经 `pageName()` 后必须仍是 `.webp`、页序零填充 3 位、`addFiles` 必须按模式分流且普通模式不再丢弃 PDF、拆出的项必须带 `fromPdf` 元数据、失败要摘掉占位项、画质/格式变化要触发重渲染、**先铺白底再 `page.render`**（顺序反了转 WebP 会成黑块）、长边上限与 2 倍放大封顶、worker 兜底、文档缓存失败要清。后半（4 项回归）：`renderPdfPagesForVault` 必须渲染到**真实目标像素**（不得再塌到 595×842 的页面点尺寸）、两档必须产出不同尺寸、放大受 `PDF_VAULT_MAX_SCALE` 封顶、页名与 JPEG 类型 |
| `tests/vault-multipart-contract.test.cjs` | 19 | **vault 分片的跨端契约**（`npm run test:vault`）。云函数侧（静态）：5 个 action 都存在、都需 token、两处白名单完全一致、`VAULT_KEY_RE` 拒绝穿越与嵌套、四处 promisify 到位、分片号限 1~10000、合并前校验连续性、失败路径真的调了 `abortMultipartUpload`、ContentType/缓存策略与前端一致。前端侧：`init → part×N → complete` 的顺序、**按文本子串重组必须能还原完整密文**、分片号连续且都带 etag、每个请求都带 token、任一分片失败要 abort 且**保留原始错误**、`uploadCipher` 按体积分流、字段名是 `dataText`（不是旧的 `dataBase64`） |

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

---

## 十、普通上传路径：PDF 逐页转 WebP（与加密无关）

未勾选「含有敏感元素」时，拖进来的 PDF **不再被静默丢弃**（旧实现是 `if (isPdf) { if (!isSecureMode()) return; }`），
而是用 pdf.js 逐页渲染成 WebP 图片，当作普通内页上传 —— 站点侧看到的就是标准的
`{目录}/{前缀}{页码}.webp`，一页一个文件，与手工传图完全一致。

| 环节 | 实现 |
| --- | --- |
| 分流 | `addFiles()` → 敏感模式保留整份 PDF；普通模式调 `expandPdfIntoPages()` |
| 逐页渲染 | `renderPdfPageToFile()`，长边收敛到 `PDF_PAGE_MAX_SIDE`（2000），放大倍数封顶 2 倍 |
| 命名 | `<主干>-p001.webp`，经 `pageName()` 后变成 `image01.webp` |
| 文档缓存 | `getPdfDocument()` 按 File 对象缓存，改画质重渲染时不必重新解析 |

**一个关键设计**：拆页发生在"加入列表时"，不是"点上传时"。这样 `files[]` 里永远是**真实的图片 File**，
下游 `renderFiles()` / `uploadAll()` / `pageName()` / `syncPages()` / 敏感模式切换**一行都不用改**，
缩略图、页数、排序也立刻正确。

代价是渲染用的是"加入那一刻"的画质滑杆值。所以每一项都记了
`fromPdf: { src, pageNo, quality, useWebp, stem }`；`uploadAll()` 在准备阶段会比对
`fromPdf.quality !== quality`（或 WebP 开关变了），不一致就**按当前设置重渲染该页** ——
这样"先加 PDF 再调画质"才真的生效。

反向也要处理：**敏感模式下加的 PDF 是整份保留的**，如果用户随后取消勾选，
`refreshSecureUI()` 会补一次拆页，否则会在 `createImageBitmap` 那一步炸。

