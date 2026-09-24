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
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: false,
        includeAssets: [
          'manifest.webmanifest',
          'favicon.svg',
          'icons/icon-192x192.png',
          'icons/icon-512x512.png',
          'icons/icon-maskable-512x512.png',
        ],
        workbox: {
          // 漫画站只预缓存应用壳（comic.html 兜底）；封面与正文图片走运行时缓存。
          globPatterns: ['comic.html', 'assets/**/*.{js,css}'],
          // 加密阅读器（pdfjs-dist）必须联网取密文，离线预缓存没有意义。
          globIgnores: [
            'assets/SecureComicReader-*.js',
            'assets/pdfjs-vendor-*.js',
            'assets/pdf.worker.min-*.js',
          ],
          navigateFallback: 'comic.html',
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // 漫画封面：容量受限的 CacheFirst，避免无限膨胀。
              urlPattern: /^https:\/\/levihan-1325571558\.cos-website\.ap-nanjing\.myqcloud\.com\/lh-[^/?]+\/[^?]+\.webp$/i,
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
            'vendor': ['crypto-js', 'react-pinch-zoom-pan'],
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
