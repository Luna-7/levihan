#!/usr/bin/env python3
"""
build-ladder-lab.py — 生成「压缩阶梯实验台」单文件页面。

为什么是生成、而不是手写一份实验台：

  实验台要测的是两个**生产**实现 ——
    · public/admin/secure-upload.js 里的 runCompressLadder / describeLadder / vaultPartSize
    · public/admin/index.html 里的 renderPdfPagesForVault / getPdfDocument / canvasToJpegBlob

  手抄一份等于测了个假货：抄的那一刻就与生产分叉，之后生产改了什么都不知道。
  所以这里直接从源文件**原样抽取**，并把两个源的 SHA-256 前 8 位印在页面上 ——
  一旦生产改动而实验台没重新生成，打开页面就能看见 hash 对不上。

  抽取用括号配平（会跳过字符串与注释），抽完还要过一遍 `node --check`，
  语法不过就直接拒绝产出，绝不把半截代码写进页面。

产物：docs/ladder-lab.html（单文件，双击即开；仅依赖 jsPDF / pdf.js 两个 CDN）
用法：npm run build:lab
"""

import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_MODULE = os.path.join(ROOT, 'public', 'admin', 'secure-upload.js')
SRC_PAGE = os.path.join(ROOT, 'public', 'admin', 'index.html')
OUT_PAGE = os.path.join(ROOT, 'docs', 'ladder-lab.html')

# 需要从 index.html 抽取的函数（第一个参数是源码里的名字，第二个是输出时的分组标题）
FUNCS = [
    'canvasToJpegBlob',
    'pdfJsReady',
    'readFileBytes',
    'getPdfDocument',
    'renderPdfPagesForVault',
]
# 需要从 index.html 抽取的单行常量声明
CONSTS = [
    r'var PDF_VAULT_MAX_SCALE\s*=\s*3;',
    r'var pdfDocCache\s*=\s*new Map\(\);',
]


# --------------------------------------------------------------------------
# 抽取
# --------------------------------------------------------------------------

def skip_string(src, i):
    """i 指向引号，返回闭引号之后的下标。反斜杠转义安全跳过。"""
    quote = src[i]
    i += 1
    n = len(src)
    while i < n:
        c = src[i]
        if c == '\\':
            i += 2
            continue
        if c == quote:
            return i + 1
        i += 1
    raise ValueError('字符串字面量未闭合，源码可能已被截断')


def slice_balanced(src, start, label):
    """
    从 start（某个 function 关键字的位置）扫到与之配平的那个右大括号。
    扫描时跳过字符串与注释，所以肉眼看像是"括号"的字符不会误算深度。
    """
    n = len(src)
    depth = 0
    k = start
    while k < n:
        c = src[k]
        if c in '\'"`':
            k = skip_string(src, k)
            continue
        if c == '/' and k + 1 < n and src[k + 1] == '/':
            nl = src.find('\n', k)
            if nl == -1:
                break
            k = nl + 1
            continue
        if c == '/' and k + 1 < n and src[k + 1] == '*':
            end = src.find('*/', k)
            if end == -1:
                raise ValueError(f'{label}: 块注释未闭合')
            k = end + 2
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return src[start:k + 1]
        k += 1
    raise ValueError(f'{label}: 大括号未配平（抽取失败）')


def extract_func(src, name):
    pat = re.compile(r'^(?:async[ \t]+)?function[ \t]+' + re.escape(name) + r'[ \t]*\(', re.M)
    m = pat.search(src)
    if not m:
        raise LookupError(f'index.html 里找不到函数 {name}()，生产代码可能改过结构')
    return slice_balanced(src, m.start(), name)


def extract_const(src, pattern):
    m = re.search(pattern, src, re.M)
    if not m:
        raise LookupError(f'index.html 里找不到常量声明 /{pattern}/，生产代码可能改过结构')
    return m.group(0)


def read(path):
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def short_hash(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:8]


def guard_script_tag(code, label):
    """内联进 <script> 的代码里若含 </script，会把脚本块提前截断。"""
    if re.search(r'</script', code, re.I):
        raise ValueError(f'{label} 含 </script 字面量，无法安全内联')


# --------------------------------------------------------------------------
# 拼装
# --------------------------------------------------------------------------

def build():
    module_src = read(SRC_MODULE)
    page_src = read(SRC_PAGE)

    guard_script_tag(module_src, 'secure-upload.js')

    snippet_lines = []
    for pat in CONSTS:
        snippet_lines.append(extract_const(page_src, pat))
    for name in FUNCS:
        snippet_lines.append(extract_func(page_src, name))
    snippets = '\n\n'.join(snippet_lines)
    guard_script_tag(snippets, 'index.html 抽取片段')

    # 抽取结果的语法自检：拼成一个完整 script，交给 node 解析（只编译不执行）
    check = snippets + '\nif (typeof renderPdfPagesForVault !== "function") throw new Error("nope");\n'
    node = shutil.which('node') or '/opt/homebrew/bin/node'
    tmp = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8')
    try:
        tmp.write(check)
        tmp.close()
        proc = subprocess.run([node, '--check', tmp.name], capture_output=True, text=True)
        if proc.returncode != 0:
            raise SystemExit('抽取片段语法校验未通过，已中止：\n' + (proc.stderr or proc.stdout))
    finally:
        os.unlink(tmp.name)

    meta = {
        'module_hash': short_hash(module_src),
        'page_hash': short_hash(page_src),
        'module_lines': module_src.count('\n') + 1,
        'page_lines': page_src.count('\n') + 1,
        'built_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'module_bytes': len(module_src.encode('utf-8')),
    }

    out = TEMPLATE
    out = out.replace('__SECURE_MODULE__', module_src)
    out = out.replace('__PAGE_SNIPPETS__', snippets)
    out = out.replace('__MODULE_HASH__', meta['module_hash'])
    out = out.replace('__PAGE_HASH__', meta['page_hash'])
    out = out.replace('__MODULE_LINES__', str(meta['module_lines']))
    out = out.replace('__PAGE_LINES__', str(meta['page_lines']))
    out = out.replace('__MODULE_KB__', str(round(meta['module_bytes'] / 1024)))
    out = out.replace('__BUILT_AT__', meta['built_at'])

    os.makedirs(os.path.dirname(OUT_PAGE), exist_ok=True)
    with open(OUT_PAGE, 'w', encoding='utf-8') as fh:
        fh.write(out)

    print(f'✓ 抽取函数 {len(FUNCS)} 个 + 常量 {len(CONSTS)} 个，node --check 通过')
    print(f'  源：secure-upload.js @ {meta["module_hash"]}（{meta["module_lines"]} 行）')
    print(f'      index.html       @ {meta["page_hash"]}（{meta["page_lines"]} 行）')
    print(f'  产物：{os.path.relpath(OUT_PAGE, ROOT)}（{round(len(out.encode("utf-8"))/1024)} KB）')


# --------------------------------------------------------------------------
# 页面模板
# --------------------------------------------------------------------------

TEMPLATE = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>压缩阶梯实验台 — 深度加密上传</title>
<style>
  :root{
    --ink:#1a1a18; --muted:#5F5E5A; --line:#e2e0d8; --paper:#fff; --bg:#f7f6f1;
    --gold:#8a6d1f; --green:#0F6E56; --red:#A32D2D; --blue:#1F4E79; --slot:#efece3;
  }
  *{box-sizing:border-box}
  body{
    margin:0;padding:36px 24px 72px;background:var(--bg);color:var(--ink);
    font:15px/1.7 -apple-system,"PingFang SC","Helvetica Neue",sans-serif;
  }
  .wrap{max-width:1000px;margin:0 auto}
  h1{font-size:25px;font-weight:600;margin:0 0 6px;letter-spacing:-.2px}
  .sub{color:var(--muted);font-size:14px;margin:0 0 18px}
  .meta{
    font:12px/1.9 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);
    background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin-bottom:24px;
  }
  .meta b{color:var(--ink);font-weight:600}
  .meta .warn{color:var(--gold)}
  .card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin-bottom:18px}
  .card h2{font-size:15px;font-weight:600;margin:0 0 14px;padding-bottom:9px;border-bottom:1px solid var(--line)}

  .drop{
    border:1.5px dashed #c9c5b6;border-radius:10px;padding:34px 20px;text-align:center;
    color:var(--muted);font-size:14px;cursor:pointer;transition:.15s;background:#fbfaf6;
  }
  .drop:hover,.drop.over{border-color:var(--gold);background:#faf7ec;color:var(--ink)}
  .drop b{color:var(--ink)}
  .drop small{display:block;margin-top:6px;font-size:12px;opacity:.75}

  .files{margin-top:12px;display:flex;flex-direction:column;gap:6px}
  .frow{
    display:flex;gap:10px;align-items:baseline;font-size:13px;
    padding:7px 11px;background:#fbfaf6;border:1px solid var(--line);border-radius:7px;
  }
  .frow .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .frow .sz{color:var(--muted);font:12px ui-monospace,Menlo,monospace}
  .tag{font-size:11px;padding:1px 7px;border-radius:20px;border:1px solid var(--line);color:var(--muted)}

  .params{display:flex;flex-wrap:wrap;gap:20px;align-items:center;margin:18px 0 4px;font-size:13.5px}
  .params label{display:flex;align-items:center;gap:7px}
  .params input[type=number]{
    width:78px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;
    font:13px ui-monospace,Menlo,monospace;background:#fff;color:var(--ink)
  }
  .params input[type=checkbox]{width:16px;height:16px;accent-color:var(--green)}
  .quick{border:1px solid var(--line);background:#fff;border-radius:20px;padding:2px 10px;font-size:12px;cursor:pointer;color:var(--muted)}
  .quick:hover{border-color:var(--gold);color:var(--ink)}

  .actions{display:flex;gap:10px;margin-top:18px}
  button.main{
    background:var(--ink);color:#fff;border:0;border-radius:8px;padding:11px 24px;
    font-size:14px;font-weight:500;cursor:pointer;font-family:inherit
  }
  button.main:hover:not(:disabled){background:#000}
  button.main:disabled{opacity:.35;cursor:not-allowed}
  button.ghost{
    background:#fff;color:var(--muted);border:1px solid var(--line);border-radius:8px;
    padding:11px 18px;font-size:14px;cursor:pointer;font-family:inherit
  }
  button.ghost:hover{color:var(--ink);border-color:#c9c5b6}

  .bar{height:6px;background:var(--slot);border-radius:4px;overflow:hidden;margin:14px 0 8px}
  .bar i{display:block;height:100%;width:0;background:var(--gold);transition:width .25s}
  .ptext{font-size:13px;color:var(--muted);min-height:22px}

  .verdict{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:18px}
  .v{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:#fbfaf6}
  .v .k{font-size:11.5px;color:var(--muted);letter-spacing:.4px;text-transform:uppercase;margin-bottom:5px}
  .v .n{font-size:22px;font-weight:600;letter-spacing:-.4px;line-height:1.25}
  .v .d{font-size:12px;color:var(--muted);margin-top:3px}
  .v.ok .n{color:var(--green)}
  .v.bad .n{color:var(--red)}
  .v.warn .n{color:var(--gold)}

  table{width:100%;border-collapse:collapse;font-size:13px}
  th{
    text-align:left;font-weight:600;font-size:11.5px;color:var(--muted);
    letter-spacing:.4px;text-transform:uppercase;padding:0 10px 8px 0;border-bottom:1px solid var(--line)
  }
  td{padding:9px 10px 9px 0;border-bottom:1px solid #f1efe7;vertical-align:middle}
  tr.chosen td{background:#f7faf7}
  tr:last-child td{border-bottom:0}
  .mono{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace}
  .mark{font-size:12px;color:var(--muted)}
  .mark.skip{color:var(--muted);font-style:italic}
  .mark.pick{color:var(--green);font-weight:600}

  .track{height:16px;background:var(--slot);border-radius:4px;overflow:hidden;min-width:60px}
  .track i{display:block;height:100%;background:#c8c3b0}
  tr.chosen .track i{background:var(--green)}
  .track.dim i{background:#ded9c9}

  .upl{border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-top:6px}
  .upl .r{display:flex;justify-content:space-between;gap:16px;padding:10px 14px;font-size:13px;border-bottom:1px solid #f1efe7}
  .upl .r:last-child{border-bottom:0}
  .upl .r:nth-child(odd){background:#fbfaf6}
  .upl .k{color:var(--muted)}
  .upl .v{font:12.5px ui-monospace,Menlo,monospace;text-align:right}
  .pill{display:inline-block;font-size:11.5px;padding:1px 8px;border-radius:20px;border:1px solid}
  .pill.single{color:var(--green);border-color:#bfd9cf;background:#f2f8f5}
  .pill.multi{color:var(--blue);border-color:#c2d3e3;background:#f3f7fb}

  .quote{
    margin-top:14px;padding:12px 16px;border-left:3px solid var(--gold);background:#fbf8ef;
    font-size:13.5px;color:var(--ink)
  }
  .quote em{font-style:normal;color:var(--muted);display:block;font-size:12px;margin-top:4px}

  .err{border-left:3px solid var(--red);background:#fdf4f4;padding:12px 16px;border-radius:0 8px 8px 0;font-size:13.5px}
  .err pre{margin:8px 0 0;font-size:12px;white-space:pre-wrap;color:var(--muted)}
  .caveat{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.75}
  .caveat code{font:12px ui-monospace,Menlo,monospace;background:#f1efe7;padding:1px 5px;border-radius:4px}
  footer{font-size:12px;color:var(--muted);margin-top:32px;line-height:1.9}
  @media(max-width:720px){.verdict{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">

  <h1>压缩阶梯实验台</h1>
  <p class="sub">
    拖入图片（可多张）或一个 PDF，<b>只跑压缩、不加密、不上传</b>。
    告诉你：停在哪一档、产出多大、有没有降画质、真上传时会走单次还是分片。
  </p>

  <div class="meta">
    生产源码快照 —
    <b>secure-upload.js</b> @ __MODULE_HASH__（__MODULE_LINES__ 行 / __MODULE_KB__ KB）&nbsp;·&nbsp;
    <b>index.html</b> @ __PAGE_HASH__（__PAGE_LINES__ 行）<br>
    生成于 __BUILT_AT__ ——
    <span class="warn">若生产已改动而本页未重新生成，下面的 hash 会对不上，请跑 <b>npm run build:lab</b></span>
  </div>

  <section class="card">
    <h2>1 · 选择文件</h2>
    <div class="drop" id="drop">
      把 <b>图片</b>（可多张，将按文件名自然序合并成 PDF）或 <b>一个 PDF</b> 拖到这里
      <small>或点击此区域选择文件</small>
    </div>
    <input type="file" id="picker" multiple accept="image/*,application/pdf" hidden>
    <div class="files" id="files"></div>

    <div class="params">
      <label>目标体积
        <input type="number" id="target" value="60" min="0.05" max="2048" step="0.05"> MB
      </label>
      <button class="quick" data-mb="3">3（物理单次上限）</button>
      <button class="quick" data-mb="60">60（业务目标）</button>
      <label><input type="checkbox" id="autodown" checked> 自动降到够用为止</label>
    </div>

    <div class="actions">
      <button class="main" id="run" disabled>跑压缩阶梯</button>
      <button class="ghost" id="reset">清空</button>
    </div>
  </section>

  <section class="card" id="progressCard" hidden>
    <h2>2 · 进度</h2>
    <div class="bar"><i id="pbar"></i></div>
    <div class="ptext" id="ptext">等待开始…</div>
  </section>

  <section class="card" id="resultCard" hidden>
    <h2>3 · 结果</h2>
    <div class="verdict" id="verdict"></div>
    <div id="ladderQuote"></div>
    <div id="attempts"></div>
    <h2 style="margin-top:26px">真上传会怎么走</h2>
    <div class="upl" id="upload"></div>
    <div class="caveat" id="caveat"></div>
  </section>

  <section class="card" id="errCard" hidden>
    <h2>出错了</h2>
    <div class="err" id="err"></div>
  </section>

  <footer>
    本页不是生产管理台：它**不做加密、不连云函数、不写 COS**，只把 <code>runCompressLadder()</code>
    这一段的真实行为暴露出来。<br>
    依赖两个 CDN：jsPDF 2.5.1（与生产同版本）、pdf.js 3.11.174（与生产同版本、含 worker）——
    首次打开需要联网。
  </footer>

</div>

<!-- 两个运行时依赖：与 public/admin/index.html 用的 URL、版本完全一致 -->
<script src="https://cdn.staticfile.net/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdn.staticfile.net/pdf.js/3.11.174/pdf.min.js"></script>

<!-- ============================================================
     生产模块：public/admin/secure-upload.js（原样内联，未改动）
     ============================================================ -->
<script>
__SECURE_MODULE__
</script>

<!-- ============================================================
     生产页面片段：从 public/admin/index.html 原样抽取
     ============================================================ -->
<script>
__PAGE_SNIPPETS__
</script>

<!-- ============================================================
     实验台驱动逻辑（本文件独有）
     ============================================================ -->
<script>
(function(){
  'use strict';

  var V = window.LeVihanVault;
  var drop = document.getElementById('drop');
  var picker = document.getElementById('picker');
  var filesBox = document.getElementById('files');
  var runBtn = document.getElementById('run');
  var resetBtn = document.getElementById('reset');
  var targetEl = document.getElementById('target');
  var autoEl = document.getElementById('autodown');
  var progressCard = document.getElementById('progressCard');
  var pbar = document.getElementById('pbar');
  var ptext = document.getElementById('ptext');
  var resultCard = document.getElementById('resultCard');
  var errCard = document.getElementById('errCard');
  var picked = [];

  if (!V || typeof V.runCompressLadder !== 'function') {
    fail('生产模块未加载', 'window.LeVihanVault 取不到，或该版本还没有 runCompressLadder（两段式是后加的）。');
    return;
  }
  // PDF 档要靠页面注入渲染器，与生产管理台的接线方式完全一致
  V.configure({ renderPdfPages: renderPdfPagesForVault });

  // 启动自检：依赖没到就别让人拖完文件才发现。缺 jsPDF 连无损档都跑不了；
  // 缺 pdf.js 只是 PDF 档会被跳过，图片仍可测，所以分开说。
  (function(){
    var missing = [];
    if (!(window.jspdf && typeof window.jspdf.jsPDF === 'function')) missing.push('jsPDF 2.5.1');
    if (!window.pdfjsLib) missing.push('pdf.js 3.11.174');
    if (!missing.length) return;
    fail('运行时依赖没加载：' + missing.join('、'),
      '这两个库从 cdn.staticfile.net 取（与生产管理台同一个 URL、同一个版本），请确认网络后刷新。\n' +
      '· 缺 jsPDF → 连「无损直通」档都跑不了，任何输入都会失败。\n' +
      '· 缺 pdf.js → 只有 PDF 输入受影响（PDF 档会被跳过），图片仍可正常测。');
  })();

  function fmt(n){
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }
  function esc(s){
    return String(s).replace(/[&<>"]/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
    });
  }
  function fail(title, detail){
    errCard.hidden = false;
    document.getElementById('err').innerHTML =
      '<b>' + esc(title) + '</b>' + (detail ? '<pre>' + esc(detail) + '</pre>' : '');
  }
  function clearErr(){ errCard.hidden = true; }
  function isPdf(f){ return /\.pdf$/i.test(f.name || '') || f.type === 'application/pdf'; }

  /* ---------------- 选文件 ---------------- */

  function accept(list){
    var arr = Array.prototype.slice.call(list || []).filter(Boolean);
    if (!arr.length) return;
    var pdfs = arr.filter(isPdf);
    var imgs = arr.filter(function(f){ return !isPdf(f); });
    if (pdfs.length && imgs.length) {
      clearErr();
      fail('不能混着来', '一次只能测一种：要么多张图片，要么一个 PDF。生产管线本身也是二选一。');
      return;
    }
    if (pdfs.length > 1) {
      clearErr();
      fail('只能一个 PDF', '收到 ' + pdfs.length + ' 个 PDF。压缩阶梯的 PDF 档只处理单文件输入。');
      return;
    }
    clearErr();
    picked = arr;
    renderFiles();
  }

  function renderFiles(){
    filesBox.innerHTML = picked.map(function(f){
      return '<div class="frow">' +
        '<span class="tag">' + (isPdf(f) ? 'PDF' : 'IMG') + '</span>' +
        '<span class="nm">' + esc(f.name) + '</span>' +
        '<span class="sz">' + fmt(f.size) + '</span>' +
      '</div>';
    }).join('');
    runBtn.disabled = !picked.length;
  }

  drop.addEventListener('click', function(){ picker.click(); });
  picker.addEventListener('change', function(){ accept(picker.files); picker.value = ''; });
  ['dragenter','dragover'].forEach(function(ev){
    drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave','drop'].forEach(function(ev){
    drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function(e){
    if (e.dataTransfer && e.dataTransfer.files) accept(e.dataTransfer.files);
  });

  Array.prototype.forEach.call(document.querySelectorAll('.quick'), function(b){
    b.addEventListener('click', function(){ targetEl.value = b.getAttribute('data-mb'); });
  });

  resetBtn.addEventListener('click', function(){
    picked = []; renderFiles(); clearErr();
    resultCard.hidden = true; progressCard.hidden = true; pbar.style.width = '0';
  });

  /* ---------------- 跑 ---------------- */

  runBtn.addEventListener('click', async function(){
    if (!picked.length) return;
    var mb = Number(targetEl.value);
    if (!(mb > 0)) { fail('目标体积不合法', '目标必须是正数 MB。'); return; }

    clearErr();
    resultCard.hidden = true;
    progressCard.hidden = false;
    pbar.style.width = '0';
    ptext.textContent = '准备中…';
    runBtn.disabled = true;
    runBtn.textContent = '跑着…';

    // 与生产同样的注入方式；这两个旋钮就是两段式的判定靶心与降档开关
    V.configure({
      renderPdfPages: renderPdfPagesForVault,
      MAX_OUTPUT_BYTES: Math.round(mb * 1024 * 1024),
      AUTO_DOWNSCALE: !!autoEl.checked,
    });

    var inputBytes = picked.reduce(function(s, f){ return s + f.size; }, 0);
    var t0 = performance.now();
    try {
      var res = await V.runCompressLadder(picked, function(p){
        if (!p) return;
        ptext.textContent = p.text || p.stage || '';
        if (typeof p.ratio === 'number' && p.ratio > 0 && p.ratio <= 1) {
          pbar.style.width = Math.round(p.ratio * 100) + '%';
        }
      }, function(){});
      pbar.style.width = '100%';
      ptext.textContent = '完成。';
      render(res, inputBytes, performance.now() - t0);
    } catch (e) {
      ptext.textContent = '失败。';
      fail('压缩没跑通', (e && e.message) || String(e));
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = '跑压缩阶梯';
    }
  });

  /* ---------------- 展示 ---------------- */

  function render(res, inputBytes, ms){
    var L = res.ladder || {};
    var outBytes = res.pdfBytes ? res.pdfBytes.length : 0;
    var degraded = !!L.degraded;
    var within = !!L.withinTarget;

    /* 三块大字：停在哪档 / 产出多少 / 画质动没动 */
    var v = [];
    v.push('<div class="v"><div class="k">停在哪一档</div>' +
           '<div class="n">' + esc(L.chosenLabel || '—') + '</div>' +
           '<div class="d">' + esc(L.chosenId || '') + (L.pdfRerendered ? ' · 逐页重渲染' : '') + '</div></div>');
    v.push('<div class="v ' + (within ? 'ok' : 'warn') + '"><div class="k">产出 PDF</div>' +
           '<div class="n">' + fmt(outBytes) + '</div>' +
           '<div class="d">目标 ' + fmt(L.targetBytes || 0) +
           ' · 占源图 ' + (inputBytes ? (outBytes / inputBytes * 100).toFixed(0) + '%' : '—') + '</div></div>');
    v.push('<div class="v ' + (degraded ? 'bad' : 'ok') + '"><div class="k">画质</div>' +
           '<div class="n">' + (degraded ? '已降档' : '无损') + '</div>' +
           '<div class="d">' + (degraded ? '为了让体积达标动了画质' : '原始字节直通，零重编码') + '</div></div>');
    document.getElementById('verdict').innerHTML = v.join('');

    document.getElementById('ladderQuote').innerHTML =
      '<div class="quote">' + esc(V.describeLadder(L)) +
      '<em>上面这句由生产模块的 describeLadder() 生成，与真实上传完成后面板上看到的完全一致。</em></div>';

    /* 逐档实测表 */
    var attempts = L.attempts || [];
    var maxBytes = attempts.reduce(function(m, a){ return Math.max(m, a.bytes || 0); }, 0);
    var measured = attempts.filter(function(a){ return a.bytes != null; });
    var lastMeasured = -1;
    attempts.forEach(function(a, i){ if (a.bytes != null) lastMeasured = i; });

    var rows = attempts.map(function(a, i){
      var chosen = a.id === L.chosenId && a.bytes != null;
      var bytes = a.bytes == null ? null : a.bytes;
      var pct = bytes != null && maxBytes ? Math.max(2, Math.round(bytes / maxBytes * 100)) : 0;

      var cls = '', txt = '';
      if (a.skipped) { cls = 'skip'; txt = '跳过：' + a.skipped; }
      else if (chosen) { cls = 'pick'; txt = '✓ 采用'; }
      else if (bytes != null) {
        // 到底了就不能再说"继续降" —— 后面没有档了，说继续降是骗人
        if (i === lastMeasured) { cls = 'skip'; txt = within ? '' : '未达标（已到底）'; }
        else { txt = '未达标，继续降'; }
      }

      return '<tr class="' + (chosen ? 'chosen' : '') + '">' +
        '<td><b>' + esc(a.label || a.id) + '</b><br><span class="mono" style="color:#5F5E5A">' + esc(a.id) + '</span></td>' +
        '<td class="mono" style="white-space:nowrap">' + (bytes == null ? '—' : fmt(bytes)) + '</td>' +
        '<td style="width:34%">' + (bytes == null ? '' :
          '<div class="track' + (chosen ? '' : ' dim') + '"><i style="width:' + pct + '%"></i></div>') + '</td>' +
        '<td class="mark ' + cls + '">' + esc(txt) + '</td>' +
      '</tr>';
    }).join('');

    // 一个容易被误读的结果：所有档都没达标、而第一档产出反而最小 →
    // 按"取实测最小者"回到无损档。这不是 bug，但不解释的话用户会以为降档白跑了。
    var backToFirst = !within && measured.length > 1 && attempts.length &&
                      L.chosenId === attempts[0].id;
    var note = backToFirst
      ? '<div class="caveat"><b>为什么停在第一档？</b>这次所有档都没达到目标，而' +
        '<b>第一档产出反而最小</b>（重渲染/降采样之后体积变大了），于是按「取实测最小者」回到' +
        '无损直通 —— 既然都到不了目标，就没必要白降画质。' +
        '对内容很少或矢量为主的 PDF 很容易出现这种情况。</div>'
      : '';

    document.getElementById('attempts').innerHTML =
      '<h2 style="margin-top:26px">逐档实测' + (attempts.length ? '（' + attempts.length + ' 档）' : '') + '</h2>' +
      '<table><thead><tr><th>档位</th><th>产出</th><th>相对体积</th><th>判定</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' + note +
      '<div class="caveat">每档都会把 patch 临时写进 CONFIG、跑完立刻还原（异常路径也还原）——' +
      '所以上面这些数字是各档独立跑出来的，不是累加降级的结果。总耗时 ' + Math.round(ms) + ' ms。</div>';

    /* 上传预演 */
    renderUpload(outBytes, L);

    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderUpload(outBytes, L){
    var CIPHER_RATIO = 1.3334;                 // AES-256-CBC 密文 ≈ 同尺寸，Base64 后 ×4/3
    var VAULT_SINGLE_MAX_PDF = 4 * 1024 * 1024 / CIPHER_RATIO;  // 云函数 MAX_BYTES(4MB) 反推的 PDF 上限
    var cipherBytes = Math.ceil(outBytes * CIPHER_RATIO);
    var partSize = (typeof V.vaultPartSize === 'function') ? V.vaultPartSize() : 4 * 1024 * 1024;
    var parts = cipherBytes > partSize ? Math.ceil(cipherBytes / partSize) : 0;

    var rows = [];
    rows.push(['产出 PDF', fmt(outBytes)]);
    rows.push(['加密后密文', fmt(cipherBytes) + ' &nbsp;<span style="color:#5F5E5A">(≈ PDF × 1.3334)</span>']);
    rows.push(['单次上限反推的 PDF 天花板', fmt(VAULT_SINGLE_MAX_PDF) + ' &nbsp;<span style="color:#5F5E5A">(云函数 MAX_BYTES 4MB ÷ 1.3334)</span>']);
    rows.push(['通道', parts
      ? '<span class="pill multi">COS 分片</span> 共 ' + parts + ' 片（每片 ' + fmt(partSize) + '）'
      : '<span class="pill single">单次上传</span> vaultUpload']);
    if (parts) {
      rows.push(['为何免于 413', '分片按密文文本字节切，各片原样拼接即完整密文 ' +
        '<span style="color:#5F5E5A">（这是分片上传解绑 6MB 请求体上限的地方）</span>']);
    }
    if (!L.withinTarget) {
      rows.push(['注意', '<span style="color:#8a6d1f">已压到最低档仍超业务目标 ' + fmt(L.targetBytes) +
        '。上传本身不受影响（分片兜底），超的只是"单本多大算合理"这条业务线。</span>']);
    }

    document.getElementById('upload').innerHTML = rows.map(function(r){
      return '<div class="r"><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>';
    }).join('');

    document.getElementById('caveat').innerHTML =
      '<code>' + Number(targetEl.value) + ' MB</code> 是业务目标（压缩阶梯以它为靶心）；' +
      '真正卡住上传的是 <code>MAX_BYTES = 4MB</code>，反推回 PDF 约 3.0 MB —— 超过就走分片。' +
      (autoEl.checked
        ? (L.withinTarget
            ? '本页开着自动降档，但它<b>达标即停</b>：既然已经达标，就不会再多降一档。'
            : '本页开着自动降档，阶梯已跑到底仍超目标 —— 上传本身不受影响（分片兜底），' +
              '超的只是「单本多大算合理」这条业务线。')
        : '本页<b>关掉了</b>自动降档，所以只跑第一档，产出超目标也不再往下压 —— 这正是关掉它的意义。');
  }
})();
</script>
</body>
</html>
'''


if __name__ == '__main__':
    try:
        build()
    except (LookupError, ValueError) as exc:
        print(f'✗ {exc}', file=sys.stderr)
        sys.exit(1)
