# Levihan PWA Implementation Report

## 1. Changed Files

- `vite.config.ts`: 接入 `vite-plugin-pwa`，配置 App Shell precache、navigation fallback、自动更新和三个有边界的 runtime cache。
- `index.html`: 增加 manifest、theme color 和标准 Apple touch icon 声明。
- `src/App.tsx`: 补齐既有注释承诺的 `?game=hange` / `?game=2048` 直达游戏分区；未修改游戏逻辑。
- `package.json` / `package-lock.json`: 增加 PWA 构建依赖。
- `vercel.json`: 为 manifest 声明 MIME type，并禁止 CDN/浏览器长期缓存 `sw.js`。
- `PWA_AUDIT.md`: 写入精确资源体积和最终缓存决策，纠正早期估算。

## 2. Added Files

- `public/manifest.webmanifest`
- `public/icons/icon-192x192.png`
- `public/icons/icon-512x512.png`
- `public/icons/icon-maskable-512x512.png`
- `public/images/archive-maintenance.png`
- `PWA_IMPLEMENTATION_REPORT.md`

`sw.js`、`workbox-*.js` 和 `registerSW.js` 由构建生成在 `dist/`，不作为源文件维护。

## 3. Dependency Changes

- 新增开发依赖：`vite-plugin-pwa@^1.3.0`。
- 当前插件版本声明兼容 Vite 6；项目构建实际使用 Vite 6.4.3 并成功生成 Service Worker。
- 未增加应用运行时依赖；`workbox-window` 由插件依赖树管理，没有额外声明为项目直接依赖。

## 4. Manifest Configuration

- `name`: 利韩土豆仓
- `short_name`: 利韩土豆
- `start_url`: `/`
- `scope`: `/`
- `display`: `standalone`
- `theme_color` / `background_color`: `#F6F1E3`
- 图标：192×192、512×512 和带安全留白的 512×512 maskable PNG。

`start_url` 没有附加 query。直接访问 `?tab=resources`、`?tab=doujinshi`、`?tab=tatakaru`、`?game=hange` 时，navigation fallback 返回 App Shell，但浏览器地址与 query 保持不变。

## 5. Service Worker Strategy

使用 `vite-plugin-pwa` 的 `generateSW` / Workbox 成熟方案：

- `registerType: autoUpdate`
- App Shell precache：构建后的 `index.html`、主站 JS/CSS、favicon、PWA icons、维护页图片、主站 BGM。
- 实际构建 precache：11 项，共 923.96 KiB。
- `cleanupOutdatedCaches: true` 清理旧的 Workbox precache。
- Vercel 对 `sw.js` 使用 `no-cache, no-store, must-revalidate`，避免 worker 文件永久陈旧。
- navigation fallback 为 `index.html`；游戏子应用和管理页路径加入 denylist，避免其 HTML 被错误替换成主站 HTML。

没有缓存所有 API、所有外部请求、Google Fonts、第三方脚本或所有图片。

## 6. Game Cache Strategy

### 合成大西皮

- 73 PNG，共 1,308,961 bytes。
- 5 个音频，共 119,207 bytes。
- 98 个静态文件，共 5,238,620 bytes（约 5.00 MiB）。
- 策略：独立 `game-daxigua` runtime cache，Cache First，最多 150 项，30 天。

### 拯救韩吉

- 14 JPG，共 8,209,253 bytes。
- 1 个音频，共 6,434,359 bytes。
- 部署包 19 个静态文件，共 14,964,830 bytes（约 14.27 MiB）。
- 策略：独立 `game-hange` runtime cache，Cache First，最多 40 项，30 天。

两个游戏都不参与安装时 precache。首次进入时只缓存实际请求的资源，之后优先从本地读取。

## 7. Manga Cache Strategy

- 保持 `LazyComicPage`、`IntersectionObserver`、`imageLoadQueue`、最大并发 2、`loading="lazy"` 和 `decoding="async"` 原样不变。
- 仅匹配固定生产 COS 域名上、`lh-*` 目录内、无 query parameter 的 `.webp` URL。
- 策略：独立 `levihan-comics` runtime cache，Cache First，最多 120 项，30 天。
- 自定义 COS 域名、带 query 的图片、HEAD 探测、JSON/API 和未知图片不会被该规则缓存。

当前应用生成的漫画 URL 无 query 且对象路径稳定。选择 Cache First 是因为漫画页基本不频繁变化，可减少重复流量；严格 URL 边界避免缓存膨胀。

## 8. Vercel Configuration

- 保留既有 Vite build/output/install/framework 配置。
- `manifest.webmanifest`: `Content-Type: application/manifest+json`。
- `sw.js`: 禁止长期缓存，确保客户端能够检查更新。
- 未增加不必要的全局 header 或部署架构改动。

## 9. Build Verification

- Build verification: **PASS** — `npm run build`
- TypeScript/lint: **PASS** — `npm run lint`
- Manifest JSON、图标尺寸、`sw.js`、Workbox 文件、注册脚本和 11 项 precache 清单静态检查：**PASS**
- Static inspection: **PASS**
- Browser verification: **PASS（本地 Vite preview / Chromium）**
  - `?tab=resources`: query 保留且页面正确渲染。
  - `?tab=doujinshi`: query 保留且漫画列表正确渲染。
  - `?tab=tatakaru`: query 保留且游戏 iframe 正确渲染。
  - `?game=hange`: query 保留且 `/save-hange/index.html` iframe 正确渲染。
  - 停止本地服务器后刷新已访问的 `?game=hange`：App Shell 与已缓存游戏仍能渲染。
- `npm run verify:levels`: **FAIL（现有数据校验）**。三关均可解、规则等价检查通过，但脚本报告难度单调性失败：optimal moves 为 easy=65、normal=90、hard=74。PWA 改动未触碰关卡或游戏逻辑。

## 10. Known Limitations

- 未运行 Lighthouse，也未在 Android/iOS 的真实“添加到主屏幕”流程中测试。
- 用户未访问过的游戏和漫画资源不会离线可用，这是控制首次下载和缓存体积的刻意选择。
- Google Fonts 未缓存；离线时使用浏览器/系统 fallback 字体，不影响 App Shell 启动。
- 漫画的自定义 COS 配置不进入 Service Worker 漫画缓存，以避免过宽的跨域图片规则。
- 首次安装后若从未打开某个游戏，离线进入该游戏只能显示已缓存的主站 shell，不能补下载游戏资源。
- 主站构建存在原有的大 chunk 警告（主 JS 约 861 kB）；本次遵守 Minimal PWA Upgrade，没有为此重构或拆包。

## 11. Manual Browser Test Checklist

- [ ] 在正式 HTTPS 域名打开 Chrome/Edge DevTools → Application → Manifest，确认无阻断性错误。
- [ ] 确认安装按钮出现，安装后以 standalone 窗口打开。
- [ ] 分别从 `/`、`?tab=resources`、`?tab=doujinshi`、`?tab=tatakaru`、`?game=hange` 冷启动。
- [ ] 首次进入两个游戏，确认资源加载、声音、操作和切换正常。
- [ ] 第二次进入两个游戏，确认请求从各自的 runtime cache 命中。
- [ ] 打开若干漫画页，确认仍按 IntersectionObserver/并发 2 懒加载，且只缓存实际请求页。
- [ ] 断网后重新打开安装应用，确认 App Shell 启动；确认访问过的游戏/漫画可用、未访问资源合理失败。
- [ ] 发布新构建，保持页面打开并刷新，确认新 Service Worker 接管且无白屏或新旧 chunk 混用。
- [ ] 在 Android Chrome 与 iOS Safari 分别验证图标裁切、启动背景和添加到主屏幕。

## Final Answer

**这个版本已经具备标准 PWA 的基础安装条件**：有有效 manifest、标准图标、HTTPS 部署目标、已注册并可更新的 Service Worker，以及可离线启动的 App Shell。正式域名上的安装提示仍应按上面的真机 checklist 最终确认。

- **安装后首次打开**：下载约 923.96 KiB 的 App Shell precache；游戏和漫画不会被批量下载。首次进入某游戏/漫画时，实际请求到的资源进入对应 runtime cache。
- **第二次打开**：App Shell 优先从本地快速启动；已访问游戏和漫画资源优先命中各自缓存，同时 Service Worker 自动检查应用更新。
- **离线打开**：App Shell 可启动，主站本地 UI 可显示；已访问并完整缓存的游戏/漫画尽量可用，未访问的远程资源和未打开过的游戏不会凭空离线可用。
