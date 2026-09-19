#!/usr/bin/env node
/**
 * 管理台单文件（public/admin/index.html）的静态自检。
 *
 * 这个页面是一份 3000+ 行的内联脚本，跑在 `'use strict'` 下，却没有构建期检查：
 * 一个「读过/写过但从没声明」的标识符不会在交付前被任何工具发现，
 * 只会让整条功能链在运行时抛 ReferenceError —— 而报错点通常离根因很远。
 * （真实事故：`nvEditingId` 从未声明，导致小说管理的「编辑 / 清空 / 保存并发布」
 *   整条链路全炸、小说库恒为 0 篇，而页面看起来完全正常。）
 *
 * 所以这里做两件事：
 *   1. 语法检查（硬失败）—— 语法错误在云函数/静态托管上只会变成一句无日志的失败。
 *   2. 未声明的「语句级裸赋值」检测（硬失败）—— 严格模式下 `X = ...` 中 X 未声明
 *      必然抛 ReferenceError，是**确定性**的 bug，不是风格问题。
 *
 * 刻意不做「未声明读取」的全面检查：那需要真正的词法作用域分析，
 * 用正则近似会淹没在属性名 / 字符串 / 注释的误报里，反而没人看。
 *
 * 用法：node scripts/check-admin-inline.cjs [路径...]
 *   不带参数时检查 public/admin/index.html
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT = [path.join(ROOT, 'public/admin/index.html')];

const RE_INLINE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

/** 页面自己会引用、但不是本文件声明的宿主全局（浏览器 + 已引入的外部脚本） */
const HOST_GLOBALS = new Set([
  // 浏览器
  'window', 'document', 'location', 'history', 'navigator', 'console', 'alert', 'confirm', 'prompt',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'queueMicrotask',
  'fetch', 'URL', 'URLSearchParams', 'File', 'FileReader', 'Blob', 'FormData', 'Headers', 'Request', 'Response',
  'Image', 'ImageData', 'OffscreenCanvas', 'createImageBitmap', 'TextEncoder', 'TextDecoder',
  'Math', 'JSON', 'Date', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Promise', 'Map', 'Set', 'WeakMap',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'Symbol', 'Proxy', 'Reflect', 'Intl', 'BigInt',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',
  'structuredClone', 'btoa', 'atob', 'crypto', 'performance', 'CustomEvent', 'Event', 'MutationObserver',
  'localStorage', 'sessionStorage', 'caches', 'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array',
  'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer', 'DataView', 'NumberFormat',
  // 外部脚本（tools.js / secure-upload.js / pixiv-artists.js / COS SDK / jsPDF）
  'LeVihanVault', 'LeVihanTools', 'COS', 'jspdf', 'window',
]);

function collectDeclared(code) {
  const declared = new Set();
  let m;
  const add = (name) => { if (name) declared.add(name); };
  const addList = (inner) => {
    if (!inner || !inner.trim()) return;
    inner.split(',').forEach((part) => {
      const t = part.trim().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '').trim();
      const name = t.split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name);
    });
  };

  const RE_VAR = /\b(?:var|let|const)\s+([^;=\n]{0,300})/g;
  while ((m = RE_VAR.exec(code))) {
    // 只取到 `=` 或 `;` 为止的声明列表；右侧表达式里的逗号不能算声明
    let seg = m[1];
    const cut = seg.search(/[=(]/);
    if (cut >= 0) seg = seg.slice(0, cut);
    addList(seg);
  }
  const RE_FN = /\bfunction\s+([A-Za-z_$][\w$]*)/g;
  while ((m = RE_FN.exec(code))) add(m[1]);
  const RE_PARAM = /\bfunction[^(]*\(\s*([^)]*)\)/g;
  while ((m = RE_PARAM.exec(code))) addList(m[1]);
  const RE_CATCH = /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g;
  while ((m = RE_CATCH.exec(code))) add(m[1]);
  const RE_FOR = /\bfor\s*\(\s*(?:var|let|const)\s+([^;)]*)/g;
  while ((m = RE_FOR.exec(code))) addList(m[1]);
  return declared;
}

/** 语句级的裸赋值：行首（可带缩进）`name =`，排除 var/let/const/属性/比较 */
function findBareAssignments(code) {
  const hits = [];
  const RE = /^[ \t]*([A-Za-z_$][\w$]*)\s*=(?!=)/gm;
  let m;
  while ((m = RE.exec(code))) {
    hits.push({ name: m[1], line: code.slice(0, m.index).split('\n').length });
  }
  return hits;
}

function checkFile(file) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const errors = [];
  const blocks = [];
  let m;
  RE_INLINE.lastIndex = 0;
  while ((m = RE_INLINE.exec(html))) {
    blocks.push({ code: m[1], startLine: html.slice(0, m.index).split('\n').length });
  }
  if (!blocks.length) {
    errors.push(`${rel}: 找不到内联 <script>，检查逻辑已失效`);
    return { errors, blocks: 0 };
  }

  let totalBare = 0;
  for (const [i, block] of blocks.entries()) {
    const label = `内联脚本 #${i + 1}（html 第 ${block.startLine} 行起）`;
    try {
      new vm.Script(block.code, { filename: label });
    } catch (e) {
      errors.push(`${rel} ${label}: 语法错误 → ${e.message}`);
      continue; // 语法都不对，后面的检测没意义
    }
    const declared = collectDeclared(block.code);
    for (const hit of findBareAssignments(block.code)) {
      totalBare++;
      if (declared.has(hit.name)) continue;
      if (HOST_GLOBALS.has(hit.name)) continue;
      errors.push(
        `${rel} 第 ${block.startLine + hit.line - 1} 行: 对未声明标识符赋值 \`${hit.name} = ...\`\n` +
        `      'use strict' 下这会抛 ReferenceError，请在作用域内补 var ${hit.name} = ...`
      );
    }
  }
  return { errors, blocks: blocks.length, bare: totalBare };
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2).map((p) => path.resolve(p))
  : DEFAULT;

let failed = 0;
let totalBare = 0;
for (const file of files) {
  if (!fs.existsSync(file)) { console.error(`✗ 找不到文件：${file}`); failed++; continue; }
  const r = checkFile(file);
  totalBare += r.bare || 0;
  if (r.errors.length) {
    failed++;
    r.errors.forEach((e) => console.error(`✗ ${e}`));
  } else {
    console.log(`✓ ${path.relative(ROOT, file)} — ${r.blocks} 段内联脚本，语法通过，${r.bare} 处裸赋值全部有声明`);
  }
}

if (failed) {
  console.error(`\n${failed} 个文件未通过检查。`);
  process.exit(1);
}
console.log(`\n全部通过（共检查 ${totalBare} 处语句级裸赋值）。`);
