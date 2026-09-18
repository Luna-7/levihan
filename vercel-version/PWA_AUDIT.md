# Levihan PWA 改造技术审查报告

## 1. Executive Summary

**结论：可以直接在现有架构上改造为可安装 PWA**

当前 Levihan 项目完全满足 PWA 改造的基础条件，可以在不重构现有应用架构的情况下，通过少量配置和新增文件完成改造。项目采用标准的 Vite + React SPA 架构，无传统路由依赖，非常适合 PWA 化。

## 2. Current Architecture

### Framework & Build System
- **Framework**: React 19.0.1
- **Build System**: Vite 6.2.3
- **TypeScript**: ~5.8.2
- **Styling**: Tailwind CSS 4.1.14 (@tailwindcss/vite)
- **构建配置**: 
  - 主站: `vite.config.ts` → 输出到 `dist/`
  - 子应用: `vite.save-hange.config.ts` → 输出到 `public/save-hange/`

### SPA Architecture
- **路由机制**: 无 React Router，使用内部状态切换
  - `?tab=<name>` 控制主站分区 (home/resources/doujinshi/tatakaru)
  - `?game=<name>` 控制游戏选择 (daxigua/hange)
- **状态管理**: React useState 驱动 UI 切换
- **导航**: URLSearchParams 解析 query parameters 实现深度链接

### Asset Strategy
- **图片资源**: 
  - 主站: public 目录静态资源
  - 游戏: Vite import 机制嵌入 bundle
  - 漫画: 腾讯云 COS CDN 动态加载
- **音频资源**: 
  - 主站 BGM: `/sounds/bgm.mp3` (HTMLAudioElement)
  - 游戏音频: Web Audio API 动态生成
- **字体**: Google Fonts (DotGothic16, Press Start 2P, VT323, Noto Sans SC)

### Deployment
- **平台**: Vercel
- **配置**: `vercel.json` 已存在
- **HTTPS**: Vercel 自动提供
- **构建输出**: `dist/` 目录

## 3. PWA Readiness

| Requirement | Current | Required Change | Risk |
|-------------|---------|-----------------|------|
| HTTPS | ✅ Vercel 自动提供 | 无 | 无 |
| Service Worker | ❌ 不存在 | 新增 | 低 |
| Manifest | ❌ 不存在 | 新增 | 低 |
| PWA Icons | ⚠️ 只有 32x32 favicon.svg | 生成多尺寸图标 | 中 |
| Theme Color | ❌ 不存在 | 新增 meta | 低 |
| Viewport Meta | ✅ 已配置 | 无 | 无 |
| Apple Touch Icon | ✅ 已配置 | 无 | 无 |
| Responsive Design | ✅ 已支持 | 无 | 无 |
| SPA Fallback | ✅ 单页应用 | Service Worker 配置 | 低 |

## 4. Game Asset Analysis

### 合成大西皮 (daxigua)
**资源位置**: `public/daxigua/`
- **图片**: ~60+ PNG 文件 (res/raw-assets/)
- **音频**: 3 MP3 文件
- **JS**: cocos2d-js-min.js, main.js
- **HTML**: index.html
- **JSON**: ~10+ 配置文件 (res/import/)

**缓存策略建议**:
- **Precache**: cocos2d-js-min.js, main.js, 核心配置 JSON
- **Runtime Cache**: 游戏图片资源 (按需加载)
- **不应缓存**: 不适用 (静态资源适合 precache)

### 拯救韩吉 (save-hange)
**资源位置**: `src/save-hange/assets/images/` + `src/save-hange/public/assets/`
- **图片**: 14 JPG 文件 (characters.tsx import)
- **音频**: bauklotze.mp3
- **CSS/JS**: Vite bundle

**缓存策略建议**:
- **Precache**: 游戏核心 JS/CSS bundle, bauklotze.mp3
- **Runtime Cache**: 不适用 (全部为静态资源)
- **不应缓存**: 不适用

### 主站音频
**资源位置**: `public/sounds/bgm.mp3`
- **加载方式**: HTMLAudioElement, preload="auto"
- **缓存策略**: Precache (小文件，核心资源)

## 5. Manga Asset Analysis

### 当前漫画加载架构
- **组件**: `LazyComicPage.tsx` (IntersectionObserver + imageLoadQueue)
- **并发控制**: imageLoadQueue 限制并发数为 2
- **加载窗口**: rootMargin: '120% 0px 180% 0px'
- **数据来源**: 腾讯云 COS CDN
- **URL 生成**: `cosService.getPageUrl()` 动态生成
- **跨域**: 使用 `referrerPolicy="no-referrer"` 处理

### PWA Cache 兼容性分析
**不会产生冲突**:
1. **Lazy Loading**: Service Worker 缓存是透明的，不影响 IntersectionObserver
2. **Concurrency Limit**: Service Worker 缓存是网络层优化，不改变应用层并发控制
3. **imageLoadQueue**: 缓存命中后请求更快，队列逻辑不变
4. **CDN Traffic**: 缓存减少重复请求，降低 COS 流量

### 缓存策略建议
- **Runtime Cache**: 用户实际看过的漫画图片
- **缓存策略**: NetworkFirst (优先网络，失败时用缓存)
- **不应缓存**: 未看过的漫画图片 (避免存储膨胀)
- **缓存限制**: 按时间或数量限制缓存大小

## 6. Service Worker Strategy

### App Shell (Cache First)
```javascript
// 核心静态资源
- index.html
- /src/main.tsx
- /src/App.tsx
- /src/index.css
- favicon.svg
- PWA icons
- Google Fonts (可选，考虑字体文件大小)
```

### 游戏资源 (Cache First)
```javascript
// 合成大西皮
- /daxigua/index.html
- /daxigua/cocos2d-js-min.js
- /daxigua/main.js
- /daxigua/res/import/*.json (核心配置)

// 拯救韩吉
- /save-hange/index.html
- /save-hange/assets/*.js
- /save-hange/assets/*.css
- /save-hange/assets/bauklotze.mp3
```

### 漫画图片 (Network First)
```javascript
// 腾讯云 COS CDN 图片
- lh-*/image*.webp (Runtime Cache)
- 封面图片 (Runtime Cache)
```

### 动态数据 (Network First)
```javascript
// JSON 数据
- archive.json
- recs.json
- novels.json
- novels/{id}.txt
```

### 不缓存内容
```javascript
- 页数探测 HEAD 请求
- 动态生成的 URL 参数
- 开发期调试资源
```

## 7. Manifest Strategy

### 基础配置
```json
{
  "name": "利韩土豆仓",
  "short_name": "利韩土豆",
  "description": "利韩土豆仓官方网站，发布群规守则与进群指引，归档进击的巨人利韩Cut/动画素材、资源外链与土豆粮仓驻地。",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#F6F1E3",
  "background_color": "#F6F1E3",
  "scope": "/",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-maskable-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

### URL 状态处理
- `?tab=doujinshi` → 深度链接支持，Service Worker 不影响
- `?tab=tatakaru` → 深度链接支持，Service Worker 不影响
- `?game=hange` → 深度链接支持，Service Worker 不影响

## 8. iOS / Android / Desktop Compatibility

### Chrome Desktop
- **可安装**: ✅ 支持
- **独立窗口**: ✅ 支持 (display: standalone)
- **离线**: ✅ 支持 (App Shell 离线可用)

### Edge Desktop
- **可安装**: ✅ 支持
- **独立窗口**: ✅ 支持
- **离线**: ✅ 支持

### Android Chrome
- **可安装**: ✅ 支持
- **独立窗口**: ✅ 支持
- **离线**: ✅ 支持

### iOS Safari
- **可安装**: ✅ 支持 (添加到主屏幕)
- **独立窗口**: ⚠️ 部分支持 (iOS 16.4+ 支持 standalone)
- **离线**: ✅ 支持 (Service Worker 限制较少)

### iOS 限制
- Service Worker 更新机制较弱
- manifest 部分属性不支持
- 需要额外的 apple-touch-icon 配置

## 9. Vercel Compatibility

### 当前配置
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm install",
  "framework": "vite"
}
```

### 需要的额外配置
```json
{
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        {
          "key": "Service-Worker-Allowed",
          "value": "/"
        },
        {
          "key": "Content-Type",
          "value": "application/javascript"
        }
      ]
    },
    {
      "source": "/manifest.webmanifest",
      "headers": [
        {
          "key": "Content-Type",
          "value": "application/manifest+json"
        }
      ]
    }
  ]
}
```

### 兼容性分析
- ✅ Vercel 支持 Service Worker
- ✅ Vercel 支持 manifest
- ✅ HTTPS 自动提供
- ✅ SPA fallback 不影响 manifest/service worker
- ⚠️ 需要额外 headers 配置 MIME type

## 10. Risk Assessment

### 流量风险
- **风险**: 首次访问会下载更多资源 (Service Worker + manifest)
- **缓解**: 文件体积小，影响有限
- **结论**: 低风险

### Cache Storage 膨胀
- **风险**: 漫画图片缓存可能导致存储膨胀
- **缓解**: 实现 LRU 缓存策略，限制缓存大小
- **结论**: 中风险，需要监控

### Service Worker 更新问题
- **风险**: 用户可能使用旧版本 Service Worker
- **缓解**: 实现版本控制和强制更新机制
- **结论**: 低风险，有成熟解决方案

### CDN 缓存问题
- **风险**: Service Worker 缓存与 CDN 缓存冲突
- **缓解**: 使用 Cache-First 策略，CDN 作为备用
- **结论**: 低风险

### 跨域问题
- **风险**: 腾讯云 COS 图片跨域缓存
- **缓解**: 当前已使用 `referrerPolicy="no-referrer"`
- **结论**: 低风险

### SPA Fallback 问题
- **风险**: Service Worker 可能影响 query parameters
- **缓解**: 确保 Service Worker 不修改 URL
- **结论**: 低风险

## 11. Recommended Implementation Plan

### 最小改造方案 (Minimal Change / No Architecture Rewrite)

#### 阶段 1: 基础 PWA 配置
1. 安装 `vite-plugin-pwa` 依赖
2. 修改 `vite.config.ts` 添加 PWA 插件
3. 修改 `index.html` 添加 PWA metadata
4. 生成 PWA 图标资源

#### 阶段 2: Service Worker 配置
1. 配置缓存策略 (App Shell + 游戏资源 + 漫画图片)
2. 实现版本控制机制
3. 添加 Service Worker 更新逻辑

#### 阶段 3: 测试与优化
1. 测试各平台安装体验
2. 验证离线功能
3. 监控缓存大小和性能

### 不需要的内容
- ❌ 不需要引入 React Router
- ❌ 不需要重构现有 SPA 架构
- ❌ 不需要修改漫画加载逻辑
- ❌ 不需要修改游戏逻辑
- ❌ 不需要修改 URL 状态管理

## 12. Exact Files To Change

### 需要修改的文件
1. `package.json` - 添加 `vite-plugin-pwa` 依赖
2. `vite.config.ts` - 添加 PWA 插件配置
3. `index.html` - 添加 PWA metadata (theme-color, manifest link)
4. `vercel.json` - 添加 Service Worker 和 manifest headers

### 需要新增的文件
1. `public/icons/icon-192x192.png` - PWA 图标
2. `public/icons/icon-512x512.png` - PWA 图标
3. `public/icons/icon-maskable-512x512.png` - Maskable 图标
4. `public/manifest.webmanifest` - PWA manifest (或由插件自动生成)
5. `public/sw.js` - Service Worker (或由插件自动生成)

### 不需要修改的文件
- `src/App.tsx` - 无需修改
- `src/main.tsx` - 无需修改
- `src/components/DoujinshiArchive.tsx` - 无需修改
- `src/components/TatakaruGame.tsx` - 无需修改
- `src/utils/imageLoadQueue.ts` - 无需修改
- `src/components/LazyComicPage.tsx` - 无需修改
- `src/services/cosClient.ts` - 无需修改

## 13. Implementation Notes

### 资源体积核算

#### 合成大西皮 (daxigua)
- **PNG 数量**: 73
- **PNG 总大小**: 1,308,961 bytes（约 1.25 MiB）
- **音频数量**: 5
- **音频总大小**: 119,207 bytes（约 0.11 MiB）
- **游戏全部静态资源总大小**: 5,238,620 bytes（约 5.00 MiB，98 个文件）

**缓存策略决策**: 使用独立的 `game-daxigua` **Runtime Cache / Cache First**。虽然包体不算巨大，但它不是启动 App Shell 的必要资源；按需缓存可避免每次安装额外下载约 5 MiB，且第二次进入游戏仍可命中本地缓存。

#### 拯救韩吉 (save-hange)
- **JPG 数量**: 14
- **JPG 总大小**: 8,209,253 bytes（约 7.83 MiB）
- **音频数量**: 1
- **音频总大小**: 6,434,359 bytes（约 6.14 MiB）
- **游戏部署静态资源总大小**: 14,964,830 bytes（约 14.27 MiB，19 个文件）

**缓存策略决策**: 使用独立的 `game-hange` **Runtime Cache / Cache First**，用户首次进入后按实际请求缓存，避免安装时下载约 14.27 MiB。

#### 主站核心资源
- **favicon**: 1,316 bytes（SVG，继续保留网站 favicon）
- **fonts**: Google Fonts（外部资源，不纳入缓存）
- **bgm**: 292,614 bytes（约 286 KiB，纳入 App Shell precache）
- **其他关键静态资源**: manifest、192/512/maskable 图标和构建生成的主站 HTML/JS/CSS；管理页、调查报告、游戏目录不属于 App Shell

**缓存策略决策**: bgm.mp3 体积小，建议 **Precache**；其他核心资源按需处理。

### 策略总结
- **App Shell**: Precache (HTML, JS, CSS, favicon, bgm)
- **合成大西皮**: Runtime Cache / Cache First（独立 cache）
- **拯救韩吉**: Runtime Cache (14M，避免首次下载过大)
- **漫画图片**: Runtime Cache (按需缓存用户看过的图片)
- **外部资源**: 不缓存 (Google Fonts 等)

## 14. Implementation Status

审查之后已按上述保守策略完成 Minimal PWA Upgrade。实际改动与验证结果见 `PWA_IMPLEMENTATION_REPORT.md`。
