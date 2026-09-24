# 漫画站剥离方案（主站宣发 / 漫画本私有）

> 目标：把「漫画本」从宣发主站 `levihan.asia` 彻底剥离，迁移到私有子域名，实现
> 「暗号式私有分享」——链接不变 + 伪装 403 + 三连击解锁，主站零漫画痕迹。

## 一、产品定位

| 域名 | 定位 | 内容 |
|---|---|---|
| `levihan.asia` | 对外宣发门面 | 论坛（茶会）、游戏、排行榜、**小说本（合订本）+ 插画集** |
| `<私有子域名>.levihan.asia` | 群内私有分享 | **只放漫画本**（含敏感本加密阅读） |

（子域名定为 `tudou.levihan.asia`，2026-09-24 用户拍板保留。）

- 主站**不显示**漫画本入口、子域名链接、任何漫画痕迹。
- 漫画站**不显示**主站入口、不依赖主站登录态。
- 合订本（故事接龙）**留主站**，插画集**留主站**，只有「漫画本」迁走。

## 二、实现方式（单代码库 + 双入口构建）

没有拆 monorepo。同一份代码库，用 `VITE_COMIC_ENABLED` 构建开关 + 独立入口
`comic.html` / `src/comic-main.tsx`，打出两份互不重叠的产物。

### 关键文件

| 文件 | 作用 |
|---|---|
| `src/comic-main.tsx` | 漫画站入口：`ComicGate`（伪403门）+ `DoujinshiArchive mode="comic"` |
| `src/components/ComicGate.tsx` | 整站伪 403 + 三连击解锁（新增） |
| `comic.html` | 漫画站 HTML 入口（title 为 `404 Not Found`，不暴露身份） |
| `vite.comic.config.ts` | 漫画站独立构建配置（独立 PWA、独立输出） |
| `src/components/DoujinshiArchive.tsx` | 加 `mode: 'main' | 'comic'` prop，按模式过滤分类 |

### mode prop 的分流逻辑

```ts
// DoujinshiArchive 内部
const isMangaVisible = mode === 'comic';
const allCategories = isMangaVisible ? ['漫画本'] : ['小说本', '插画集'];
```

- `mode="comic"`：只显示「漫画本」，`SecureComicReader` 正常懒加载；
- `mode="main"`：只显示「小说本 + 插画集」，`isMangaVisible` 恒 false。

### 构建时切除（关键）

```ts
const SecureComicReader = import.meta.env.VITE_COMIC_ENABLED === 'false'
  ? null
  : React.lazy(() => import('./SecureComicReader'));
```

- 主站构建设 `VITE_COMIC_ENABLED=false` → rollup 物理上不打包 pdfjs-dist / crypto-js；
- 漫画站构建设 `true`（或不设，默认走 lazy）→ 正常打包。

### 产物隔离实测（2026-09-24）

| 产物 | pdf.js / worker / crypto-js | 游戏/茶会/排行榜 | 合订本/插画集 |
|---|---|---|---|
| 主站（false） | ❌ worker 无、pdfjs 空 chunk(1字节) | ✅ | ✅ |
| 漫画站（true） | ✅ worker 1087KB + pdfjs 329KB | ❌ | ❌ |

主站 iOS 不再下载约 1.4MB 的 PDF 相关代码。

## 三、伪 403 门（ComicGate）

- 打开即一页仿真的 `403 Forbidden`，**HTTP 状态码仍是 200**（不让搜索引擎/爬虫真收到 403）。
- 页面无任何「点这里解锁 / 这是漫画站」提示。
- 暗号：**2.5 秒内连点「403」标题三次** → 解锁。
- 解锁态写 `sessionStorage`（`comic_site_unlocked_v1`），本次会话内刷新不重复，关标签页失效。
- 移动端已处理：`touch-manipulation` + `WebkitTouchCallout:none` + `select-none`，避免 iOS 双击缩放/长按选中。

**诚实边界**：这是「防路人/防顺手转发/防爬虫」的软墙，不是密码学防线。敏感本子的真正防护仍是
`SecureComicReader` 的前端 AES 解密（第二层），本门只挡「不知道暗号」的人。

## 四、部署（Vercel 双项目）

1. **主站项目**（已存在）：Build Command 保持 `npm run build`，环境变量 `VITE_COMIC_ENABLED=false`。
2. **漫画站项目**（新建）：
   - Root Directory：`vercel-version`
   - Build Command：`npm run build:comic`
   - Output Directory：`dist-comic`
   - 环境变量：`VITE_COMIC_ENABLED=true`
   - 域名：`tudou.levihan.asia`（已绑定，2026-09-24 用户拍板保留）
3. 不索引：`comic.html` 已带 `noindex,nofollow`；`public/robots.txt` 全拒已存在（两套构建共用）。

## 五、本地验证记录（2026-09-24 CDP 实测）

- `comic.html` HTTP 200，title `403 Forbidden`，`noindex,nofollow` 就位；
- 未解锁态：正文为标准 Apache 403 文案，**无任何「漫画/解锁/粮仓」痕迹**（`hasComicHint: false`）；
- 三连击「403」标题（2.5s 窗口）→ 解锁成功，`sessionStorage comic_site_unlocked_v1 = "true"`；
- 解锁后：COS `archive.json` 46 条加载正常，分类仅「漫画本」（无小说本/插画集），
  标签/作者/排序齐全，敏感本正确显示「🔒 含有敏感元素 → 校验码解析」；
- 刷新后解锁态保持（sessionStorage 会话内有效，关标签页失效）。

## 六、待办（切换前需完成）

- [x] 子域名定为 `tudou.levihan.asia`（Vercel 已绑定）
- [ ] 主站项目设 `VITE_COMIC_ENABLED=false` 并 Redeploy
- [ ] 漫画站加 `robots.txt`（`Disallow: /`）
- [ ] iOS 真机验证：伪 403 门、三连击、阅读器、安全区
- [ ] 清理主站 `main.tsx` 里的 `/comics` 重定向（历史兼容，可选）
- [ ] 验证主站 Network 不再请求漫画目录 / pdf.js

## 七、回退方案

- 任何一步出问题：漫画站没验证通过前，**主站漫画功能不动**（`mode` 默认 `main`，
  但主站当前 `VITE_COMIC_ENABLED` 未设时 `SecureComicReader` 仍会 lazy 加载，行为等同迁移前）。
- 切换是「平行建、先验证、最后切」，中间随时可回退。

## 八、诚实红线

- 前端「三连击 + 前端解密」挡不住懂行的人（证书透明日志会暴露子域名、JS 可逆向）。
- 对「群内私有分享」够用；真正的机密内容不应放这里。
- CloudBase 云函数恢复后，可升级为「服务器校验口令 + 短期令牌」增强敏感本防护。
