#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'fs';

/**
 * 构建分流器：同一份代码，按 VITE_COMIC_ENABLED 环境变量决定构建哪个站。
 *
 * 背景：主站（宣发）与漫画站（私有）是 Vercel 上两个项目、同一仓库。
 * 与其依赖两个项目各自的 Build Command 设置（曾出现设置不生效的情况），
 * 不如让 `npm run build` 自己分流——两个项目的 Build Command 保持
 * `npm run build` 即可，环境变量是唯一的开关：
 *
 *   VITE_COMIC_ENABLED=true   → 构建漫画站（comic.html 入口，输出 dist/）
 *   VITE_COMIC_ENABLED=false/未设 → 构建主站（save-hange + 主入口）
 *
 * 额外透传的参数（如 --outDir /tmp/xxx）会原样转给 vite build，供本地验证用。
 */

const extra = process.argv.slice(2);
const isComic = process.env.VITE_COMIC_ENABLED === 'true';

// CLI --outDir 优先于 vite 配置里的 build.outDir，复制 index.html 时要保持一致
const outDirIdx = extra.indexOf('--outDir');
const outDir = outDirIdx >= 0 ? extra[outDirIdx + 1] : 'dist';

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (isComic) {
  console.log('[build-switch] VITE_COMIC_ENABLED=true → 构建漫画站');
  run('npx', ['vite', 'build', '--config', 'vite.comic.config.ts', ...extra]);
  // 漫画产物只有 comic.html；复制一份为 index.html，让根路径 / 直接落在伪403门
  const src = `${outDir}/comic.html`;
  if (existsSync(src)) {
    copyFileSync(src, `${outDir}/index.html`);
    console.log(`[build-switch] 已复制 ${src} → ${outDir}/index.html（根路径入口）`);
  } else {
    console.warn(`[build-switch] 未找到 ${src}，跳过 index.html 复制`);
  }
} else {
  console.log('[build-switch] VITE_COMIC_ENABLED 未设/false → 构建宣发主站');
  run('npx', ['vite', 'build', '--config', 'vite.save-hange.config.ts']);
  run('npx', ['vite', 'build', ...extra]);
}
