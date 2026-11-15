import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * 漫画站独立构建配置（comic.html → src/comic-main.tsx）。
 *
 * 部署到私有子域名，与宣发主站完全隔离：
 * - 入口是 comic.html（伪 403 门 + 纯漫画本目录），不是主站的 index.html；
 * - 产物不含游戏 / 茶会 / 排行榜 / 合订本 / 插画集 / 主站立绘；
 * - PWA 缓存只保留漫画应用壳与封面，不预缓存 pdf.js / 加密阅读器。
 *
 * 构建：npm run build:comic（独立输出到 dist-comic/，不与主站 dist/ 混在一起）。
 */
export default defineConfig(() => {
  return {
    define: { global: 'globalThis' },
    plugins: [
      {
        name: 'comic-dev-root-redirect',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.method !== 'GET' || !req.url) return next();
            const [pathname, query] = req.url.split('?', 2);
            if (pathname !== '/') return next();
            res.statusCode = 302;
            res.setHeader('Location', `/comic.html${query ? `?${query}` : ''}`);
            res.end();
          });
        },
      },
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifest: false,
        includeAssets: [
          'comic-manifest.webmanifest',
          'manifest.webmanifest',
          'favicon.svg',
          'icons/icon-192x192.png',
          'icons/icon-512x512.png',
          'icons/icon-maskable-512x512.png',
        ],
        workbox: {
          importScripts: ['/push-sw.js'],
          // 漫画站只预缓存应用壳；阅读器代码与作品资源在用户需要时再缓存。
          globPatterns: ['comic.html', 'assets/**/*.{js,css}'],
          // 阅读器和 PDF worker 延后加载，避免增加首屏预缓存；密文不进入应用壳预缓存。
          globIgnores: [
            'assets/cosS3Scanner-*.js',
            'assets/SecureComicReader-*.js',
            'assets/pdfjs-vendor-*.js',
            'assets/vendor-*.js',
            'assets/pdf.worker.min-*.js',
          ],
          // Navigation 由下方 NetworkFirst 独占，避免 precache fallback 抢先返回旧 HTML。
          navigateFallback: null,
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,
          runtimeCaching: [
            {
              urlPattern: ({ url }) =>
                /^\/(?:api(?:\/|$)|auth(?:\/|$)|admin-upload(?:\/|$)|__cf(?:\/|$)|admin(?:\/|$))/i.test(url.pathname) ||
                (url.hostname.endsWith('.service.tcloudbase.com') && /^\/(?:auth|admin-upload)(?:\/|$)/i.test(url.pathname)),
              handler: 'NetworkOnly',
            },
            {
              urlPattern: ({ url }) =>
                /^\/(?:api(?:\/|$)|auth(?:\/|$)|admin-upload(?:\/|$)|__cf(?:\/|$)|admin(?:\/|$))/i.test(url.pathname) ||
                (url.hostname.endsWith('.service.tcloudbase.com') && /^\/(?:auth|admin-upload)(?:\/|$)/i.test(url.pathname)),
              handler: 'NetworkOnly',
              method: 'POST',
            },
            {
              // 按需加载的大型模块不进入预缓存，首次取得后按内容哈希运行时缓存。
              urlPattern: ({ url, sameOrigin }) =>
                sameOrigin && /^\/assets\/(?:cosS3Scanner|SecureComicReader|pdfjs-vendor|vendor|pdf\.worker\.min)-[^/]+\.(?:js|mjs)$/i.test(url.pathname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'levihan-comic-reader-code-v1',
                expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 90 },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              urlPattern: ({ request, sameOrigin }) => request.mode === 'navigate' && sameOrigin,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'levihan-comic-navigation-v1',
                expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // COS 漫画图片：按需缓存 WebP 与旧版图片格式，容量受限。
              urlPattern: ({ url }) =>
                url.hostname === 'levihan-1325571558.cos-website.ap-nanjing.myqcloud.com' &&
                /^\/(?!comic_vault\/)[^/]+\/.+\.(?:webp|jpe?g|png|gif|avif)$/i.test(url.pathname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'comic-site-covers',
                expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    resolve: { alias: { '@': path.resolve(__dirname, '.') } },
    build: {
      // 输出到 dist/（与主站构建共用输出目录名）：
      // 漫画站项目只跑漫画构建，dist 里永远只有漫画产物；
      // Vercel 的 Output Directory 统一填 dist 即可，两个项目配置完全一致。
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        // 漫画站以 comic.html 为唯一入口。
        input: path.resolve(__dirname, 'comic.html'),
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'pdfjs-vendor': ['pdfjs-dist'],
            'vendor': ['crypto-js'],
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
    server: {
      // 本地预览也与 tudou.levihan.asia 一致：根路径进入漫画站，
      // 避免 Vite 默认命中同目录下主站的 index.html。
      open: '/comic.html',
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
