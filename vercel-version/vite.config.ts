import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const localDoujinAuth = (expectedPassword?: string): Plugin => {
  const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (request.url !== '/api/doujin-auth') {
      next();
      return;
    }

    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');

    if (request.method !== 'POST') {
      response.statusCode = 405;
      response.setHeader('Allow', 'POST');
      response.end(JSON.stringify({ ok: false }));
      return;
    }

    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      if (!expectedPassword) {
        response.statusCode = 503;
        response.end(JSON.stringify({ ok: false }));
        return;
      }

      let suppliedPassword = '';
      let token = '';
      let gesture = '';
      try {
        const parsed = JSON.parse(body) as { password?: unknown; token?: unknown; gesture?: unknown };
        suppliedPassword = typeof parsed.password === 'string' ? parsed.password : '';
        token = typeof parsed.token === 'string' ? parsed.token : '';
        gesture = typeof parsed.gesture === 'string' ? parsed.gesture : '';
      } catch {
        // Invalid input is treated as a failed password attempt.
      }
      if (!token) {
        response.statusCode = 403;
        response.end(JSON.stringify({ ok: false }));
        return;
      }
      void (async () => {
        try {
          const authResponse = await fetch('https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: 'me' }),
          });
          if (!authResponse.ok || !(await authResponse.json()).ok) {
            response.statusCode = 403;
            response.end(JSON.stringify({ ok: false }));
            return;
          }
          if (gesture === '403') {
            response.statusCode = 200;
            response.end(JSON.stringify({ ok: true }));
            return;
          }
          const suppliedHash = createHash('sha256').update(suppliedPassword).digest();
          const expectedHash = createHash('sha256').update(expectedPassword).digest();
          const isValid = timingSafeEqual(suppliedHash, expectedHash);
          response.statusCode = isValid ? 200 : 403;
          response.end(JSON.stringify({ ok: isValid }));
        } catch {
          response.statusCode = 503;
          response.end(JSON.stringify({ ok: false }));
        }
      })();
    });
  };

  return {
    name: 'local-doujin-auth',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
};

export default defineConfig(() => {
  return ({
  define: { global: 'globalThis' },
  plugins: [
    localDoujinAuth('tudou'),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // 新 SW 自动激活并接管后续请求；当前页面不因 controllerchange 强制重载，
      // 旧 chunk 失效时由 index.html 的加载错误监听定点自愈。
      injectRegister: 'auto',
      manifest: false,
      includeAssets: [
        'manifest.webmanifest',
        'favicon.svg',
        'icons/icon-192x192.png',
        'icons/icon-512x512.png',
        'icons/icon-maskable-512x512.png',
        'images/archive-maintenance.webp',
      ],
      workbox: {
        importScripts: ['/push-sw.js'],
        // Only the app shell is installed up front. Games and comics stay on demand.
        globPatterns: ['index.html', 'assets/**/*.{js,css}'],
        // 加密阅读器（pdfjs-dist）只服务「含有敏感元素」的本子，
        // 且它本身就必须联网取密文，离线预缓存没有意义 —— 别让每个访客都在后台拖它。
        globIgnores: [
          'assets/cosS3Scanner-*.js',
          'assets/SecureComicReader-*.js',
          'assets/RestaurantForum-*.js',
          'assets/DoujinshiArchive-*.js',
          'assets/DispatchHub-*.js',
          'assets/ResourceHub-*.js',
          'assets/PotatoMarket-*.js',
          'assets/TatakaruGame-*.js',
          'assets/GameLeaderboard-*.js',
          'assets/pdfjs-vendor-*.js',
          'assets/pdf.worker.min-*.js',
        ],
        // 不使用 Workbox 的 precache NavigationRoute：它会先于 runtimeCaching 注册，
        // 从而抢先返回预缓存旧 HTML，使下方 NetworkFirst 永远没有机会执行。
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // 登录、投稿、管理与其它动态 API 永不进入 Cache Storage。
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
            // 秒开优先：已有 HTML 立即返回，同时后台更新；首次无缓存才等待网络。
            urlPattern: ({ request, url, sameOrigin }) =>
              request.mode === 'navigate' &&
              sameOrigin &&
              !/^\/(?:api|admin|daxigua|save-hange|comics)(?:\/|$)/i.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'levihan-navigation-v1',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Only stable, query-free comic image URLs generated by COSService.
            urlPattern: /^https:\/\/levihan-1325571558\.cos-website\.ap-nanjing\.myqcloud\.com\/lh-[^/?]+\/[^?]+\.webp$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'levihan-comics',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/daxigua\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'game-daxigua',
              expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/sounds\/.*\.mp3$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'site-sounds',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200, 206] },
            },
          },
          {
            urlPattern: /\/save-hange\/.*\.mp3$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'game-hange-audio',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200, 206] },
            },
          },
          {
            // 子游戏入口不能 CacheFirst：旧 HTML 会引用部署后已删除的哈希脚本，
            // iOS PWA 最终只显示 iframe 的深色底色。联网时优先拿最新版，
            // 离线时仍可回退到最近一次成功响应。
            urlPattern: /\/save-hange\/(?:index\.html)?(?:\?.*)?$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'game-hange-entry',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/save-hange\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'game-hange',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React 核心库
          'react-vendor': ['react', 'react-dom'],
          // PDF.js 相关（大文件，单独分割）
          'pdfjs-vendor': ['pdfjs-dist'],
          // CloudBase SDK
          'cloudbase-vendor': ['@cloudbase/js-sdk'],
          // 其他第三方库
          'vendor': ['lucide-react', 'qrcode', 'html-to-image'],
        },
      },
    },
    chunkSizeWarningLimit: 1000, // 提高警告阈值到 1MB
  },
  server: {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    hmr: process.env.DISABLE_HMR !== 'true',
    // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
    // 云函数（admin-upload / registerWithPassword / loginWithPassword）的 CORS 白名单
    // 只认 levihan.asia / www / admin / localhost:5173 / localhost:4173，
    // 而本地 dev 跑在 localhost:3000（--host=0.0.0.0 时还有局域网 IP），跨域会被浏览器拦掉，
    // 表现为「后台有公告、前台空白」且登录注册一并失效。
    // 开发态改由 dev server 服务端转发（转发无 Origin，不受白名单影响）。
    // 前端地址收敛在 src/utils/cloudbaseEndpoint.ts，两处前缀必须一致。
    proxy: {
      '/__cf': {
        target: 'https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com',
        changeOrigin: true,
        secure: false,
        timeout: 15000,
        proxyTimeout: 15000,
        rewrite: (path) => path.replace(/^\/__cf/, ''),
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if (res && 'writeHead' in res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Proxy connection error: ' + (err.message || 'socket error') }));
            }
          });
        },
      },
      '/admin-upload': {
        target: 'https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com',
        changeOrigin: true,
        secure: false,
        timeout: 15000,
        proxyTimeout: 15000,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if (res && 'writeHead' in res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Proxy connection error: ' + (err.message || 'socket error') }));
            }
          });
        },
      },
      '/auth': {
        target: 'https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com',
        changeOrigin: true,
        secure: false,
        timeout: 15000,
        proxyTimeout: 15000,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if (res && 'writeHead' in res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Proxy connection error: ' + (err.message || 'socket error') }));
            }
          });
        },
      },
    },
  },
  });
});
