import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * SAVE HANGE（拯救韩吉）子应用构建配置。
 *
 * 游戏是一个独立的静态包，挂在主站 /save-hange/ 下，由 TatakaruGame 用 iframe 加载
 * （保持与「塔塔开·合成大西瓜」同构，避免两套 CSS 互相污染）。
 *
 * - 源码：src/save-hange/
 * - 产物：public/save-hange/  ← 主站构建会把它原样带进 dist/，无需手工拷贝
 * - 资源基路径：/save-hange/（音频与图片都跟随子路径）
 *
 * 构建：npm run build:save-hange（npm run build 会先跑它再构建主站）
 */
export default defineConfig({
  root: 'src/save-hange',
  base: '/save-hange/',
  publicDir: 'public',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../public/save-hange',
    emptyOutDir: true,
  },
});
