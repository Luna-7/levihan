/* ============================================================
 * 管理台 · 文件工具箱（图片 / PDF 本地处理）
 * 依赖：jsPDF（加密 PDF） / pdf.js（PDF 拆页） / JSZip（打包）
 * 所有运算都在浏览器本地完成，不上传服务器。
 * 独立 IIFE，避免与管理台主脚本的全局函数（如 $）冲突。
 * ============================================================ */
(function () {
  'use strict';

  var CONFIG = {
    pdfPassword: 'levihan',
    maxImageSize: 3 * 1024 * 1024,
    maxImageCount: 200,
    noticeText: '⚠️下有图片，请滑动',
    resourceTail: '土豆群内部资源，严禁外传，违者永久拉黑',
    fontStack: '"DotGothic16","Noto Sans SC",sans-serif'
  };

  var collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
  }

  /* ---------- DOM / 通用小工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function val(id) { return $(id).value.trim(); }

  function msg(id, cls, text) {
    var el = $(id);
    el.className = 'msg show ' + cls;
    el.textContent = text;
  }
  function clearMsg(id) {
    var el = $(id);
    el.className = 'msg';
    el.textContent = '';
  }
  function setBar(barId, textId, current, total, unit) {
    var pct = total > 0 ? Math.round((current / total) * 100) : 0;
    $(barId).style.width = pct + '%';
    $(textId).textContent = '正在处理：第 ' + current + ' / ' + total + ' ' + (unit || '张') + '…（' + pct + '%）';
  }
  function resetBar(barId, textId) {
    $(barId).style.width = '0%';
    $(textId).textContent = '';
  }
  function setBusy(btn, busy, busyText) {
    var el = $(btn);
    if (!el.dataset.text) el.dataset.text = el.textContent;
    el.disabled = !!busy;
    el.textContent = busy ? busyText : el.dataset.text;
  }

  function sortedFiles(list) {
    return Array.prototype.slice.call(list || []).sort(function (a, b) {
      return collator.compare(a.name, b.name);
    });
  }
  function cleanName(v) {
    return String(v || '').trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ');
  }
  function dateStamp(d) {
    d = d || new Date();
    return [
      String(d.getFullYear()).slice(-2),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('');
  }
  function bracketName(parts, ext, suffix) {
    var base = parts.map(cleanName).filter(Boolean).map(function (p) { return '[' + p + ']'; }).join('');
    return (base || '[利韩土豆群资源]') + (suffix || dateStamp()) + ext;
  }
  function joinName(parts, ext) {
    var base = parts.map(cleanName).filter(Boolean).join(' ');
    return (base || '利韩土豆群资源') + ext;
  }
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }
  function updateFileLabel(inputId, labelId) {
    var files = $(inputId).files;
    var el = $(labelId);
    if (files && files.length) {
      el.textContent = files.length === 1 ? files[0].name : '已选择 ' + files.length + ' 个文件（按文件名排序）';
      el.classList.add('has');
    } else {
      el.textContent = '未选择任何文件';
      el.classList.remove('has');
    }
  }
  /* 图片 / PDF 混选时的文件计数提示 */
  function updateMixedLabel(inputId, labelId) {
    var files = Array.prototype.slice.call($(inputId).files || []);
    var el = $(labelId);
    if (!files.length) {
      el.textContent = '未选择任何文件';
      el.classList.remove('has');
      return;
    }
    var nPdf = files.filter(isPdfFile).length;
    var nImg = files.length - nPdf;
    var parts = [];
    if (nImg) parts.push('图片 ' + nImg + ' 张');
    if (nPdf) parts.push('PDF ' + nPdf + ' 个');
    el.textContent = files.length === 1 ? files[0].name : parts.join(' · ') + '（按文件名排序）';
    el.classList.add('has');
  }
  /* ---------- 后台同色系确认弹窗（替代浏览器原生 confirm） ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function askConfirm(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'tk-modal';
      wrap.innerHTML =
        '<div class="tk-modal-box" role="dialog" aria-modal="true">' +
          '<h3><span class="ico">' + esc(opts.icon || '💬') + '</span>' + esc(opts.title || '请确认') + '</h3>' +
          '<p>' + esc(opts.message || '') + '</p>' +
          '<div class="tk-modal-actions">' +
            '<button type="button" class="btn-sm" data-act="cancel">' + esc(opts.cancelText || '取消') + '</button>' +
            '<button type="button" class="btn-sm btn-gold" data-act="ok">' + esc(opts.okText || '确定') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(wrap);
      var settled = false;
      function close(v) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(true); }
      }
      wrap.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (b) close(b.getAttribute('data-act') === 'ok');
        else if (e.target === wrap) close(false);
      });
      document.addEventListener('keydown', onKey, true);
      var okBtn = wrap.querySelector('[data-act=ok]');
      if (okBtn) okBtn.focus();
    });
  }

  function fontsReady() {
    if (document.fonts && document.fonts.ready) return document.fonts.ready.catch(function () {});
    return Promise.resolve();
  }

  /* ---------- 依赖检查 ---------- */
  function needLib(name) {
    var ok = (name === 'jspdf' && window.jspdf && window.jspdf.jsPDF) ||
             (name === 'pdfjs' && window.pdfjsLib) ||
             (name === 'jszip' && window.JSZip);
    if (!ok) throw new Error('依赖 ' + name + ' 未加载（vendor/ 本地资源），请刷新页面后重试。');
  }

  /* ---------- 图像基础 ---------- */
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('无法读取图片：' + file.name)); };
      img.src = url;
    });
  }
  function readAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsArrayBuffer(file);
    });
  }
  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(resolve, type || 'image/jpeg', quality == null ? 0.8 : quality);
    });
  }
  function limitImageSize(width, height, maxWidth) {
    if (width > (maxWidth || 1600)) {
      var ratio = (maxWidth || 1600) / width;
      return { width: maxWidth || 1600, height: height * ratio };
    }
    return { width: width, height: height };
  }
  function wrapLines(ctx, text, maxWidth) {
    var lines = [], line = '';
    Array.from(String(text)).forEach(function (ch) {
      var trial = line + ch;
      if (ctx.measureText(trial).width > maxWidth && line) { lines.push(line); line = ch; }
      else { line = trial; }
    });
    if (line) lines.push(line);
    return lines;
  }
  function drawCenteredWrapped(ctx, text, width, height, fontSize, color) {
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 ' + fontSize + 'px ' + CONFIG.fontStack;
    var lines = wrapLines(ctx, text, width * 0.76);
    var lineHeight = fontSize * 1.16;
    var startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach(function (l, i) { ctx.fillText(l, width / 2, startY + i * lineHeight); });
  }

  function makeWarningCanvas(text, w, h) {
    var lim = limitImageSize(w, h);
    var canvas = document.createElement('canvas');
    canvas.width = lim.width;
    canvas.height = lim.height;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawCenteredWrapped(ctx, '⚠️ ' + (text || '预警'), canvas.width, canvas.height,
      Math.max(42, Math.floor(canvas.width / 12)), '#B4442F');
    return canvas;
  }

  function pickWatermarkColor(ctx, width, height) {
    var size = Math.min(width, height, Math.max(32, Math.floor(Math.min(width, height) / 6)));
    var data = ctx.getImageData(Math.max(0, width - size), Math.max(0, height - size), size, size).data;
    var total = 0, blue = 0, mono = 0;
    for (var i = 0; i < data.length; i += 32) {
      var r = data[i], g = data[i + 1], b = data[i + 2];
      total += 1;
      if (b > r + 18 && b > g + 8) blue += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) < 22) mono += 1;
    }
    if (blue / total > 0.12) return '#1F5B9C';
    return mono / total > 0.5 ? '#22372B' : '#22372B';
  }

  function makeWatermarkedCanvas(img, watermarkLines) {
    var lim = limitImageSize(img.naturalWidth || img.width, img.naturalHeight || img.height);
    var canvas = document.createElement('canvas');
    canvas.width = lim.width;
    canvas.height = lim.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (!watermarkLines || !watermarkLines.length) {
      return canvas;
    }

    var fontSize = Math.max(12, Math.floor(canvas.width / 48));
    var padding = Math.max(10, Math.floor(canvas.width / 90));
    ctx.font = '700 ' + fontSize + 'px ' + CONFIG.fontStack;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    var lines = [];
    watermarkLines.forEach(function (l) { lines = lines.concat(wrapLines(ctx, l, canvas.width * 0.72)); });
    var lineHeight = fontSize * 1.24;
    ctx.fillStyle = pickWatermarkColor(ctx, canvas.width, canvas.height);
    ctx.globalAlpha = 0.5;
    lines.forEach(function (l, i) {
      ctx.fillText(l, canvas.width - padding, canvas.height - padding - (lines.length - 1 - i) * lineHeight);
    });
    ctx.globalAlpha = 1;
    return canvas;
  }

  function createEncryptedPdf(canvas) {
    needLib('jspdf');
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({
      orientation: canvas.width >= canvas.height ? 'l' : 'p',
      unit: 'px',
      format: [canvas.width, canvas.height],
      compress: true,
      encryption: {
        userPassword: CONFIG.pdfPassword,
        ownerPassword: CONFIG.pdfPassword,
        userPermissions: ['print', 'modify', 'copy', 'annot-forms']
      }
    });
    if (typeof doc.encrypt === 'function') {
      doc.encrypt({
        userPassword: CONFIG.pdfPassword,
        ownerPassword: CONFIG.pdfPassword,
        userPermissions: ['print', 'modify', 'copy', 'annot-forms']
      });
    }
    return doc;
  }
  function addCanvasToPdf(doc, canvas, isFirstPage) {
    if (!isFirstPage) doc.addPage([canvas.width, canvas.height], canvas.width >= canvas.height ? 'l' : 'p');
    doc.addImage(canvas.toDataURL('image/jpeg', 0.8), 'JPEG', 0, 0, canvas.width, canvas.height);
  }

  /* ---------- 加长白条 ---------- */
  function makeLongCanvas(img, customText) {
    var lim = limitImageSize(img.naturalWidth || img.width, img.naturalHeight || img.height);
    var w = lim.width, h = lim.height;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h * 3;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawCenteredWrapped(ctx, customText || CONFIG.noticeText, w, h, Math.max(30, Math.floor(w / 15)), '#22372B');
    ctx.drawImage(img, 0, h * 2, w, h);
    return canvas;
  }

  function makeStitchedCanvas(images, customText) {
    if (!images.length) return null;
    var lim = limitImageSize(images[0].naturalWidth || images[0].width, images[0].naturalHeight || images[0].height);
    var w = lim.width;
    var scale = lim.height / (images[0].naturalHeight || images[0].height);
    var total = images.reduce(function (sum, img) {
      return sum + (img.naturalHeight || img.height) * scale * 3;
    }, 0);
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = total;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var fontSize = Math.max(30, Math.floor(w / 15));
    var y = 0;
    images.forEach(function (img, i) {
      var h = (img.naturalHeight || img.height) * scale;
      if (i === 0) drawCenteredWrapped(ctx, customText || CONFIG.noticeText, w, h, fontSize, '#22372B');
      ctx.drawImage(img, 0, y + h * 2, w, h);
      y += h * 3;
    });
    return canvas;
  }

  /* ---------- 线条变色 ---------- */
  function hexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
  }
  function recolorCanvas(canvas, target, threshold) {
    var ctx = canvas.getContext('2d');
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = imageData.data;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (L < threshold) {
        var k = 1 - L / threshold;
        d[i] = Math.round(target.r * k);
        d[i + 1] = Math.round(target.g * k);
        d[i + 2] = Math.round(target.b * k);
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /* ============================================================
   * ① 图片 / 文件（含 PDF）转加密 PDF
   * ============================================================ */
  var PDF_SCALE = 1.5;          // PDF 页渲染倍率
  var PDF_MAX_WIDTH = 2400;     // 单页最大宽度，避免超大开本撑爆内存
  var pdfDocCache = new Map();

  function isPdfFile(f) {
    return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  }
  function getPdfDoc(file) {
    needLib('pdfjs');
    if (pdfDocCache.has(file)) return pdfDocCache.get(file);
    var pr = readAsArrayBuffer(file).then(function (data) {
      return pdfjsLib.getDocument({ data: data }).promise;
    });
    pdfDocCache.set(file, pr);
    return pr;
  }

  /* 按顺序把每个输入文件展开成一页页带水印的 canvas，并交给 onCanvas 消费 */
  async function eachPageCanvas(files, watermarkLines, onCanvas) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (isPdfFile(f)) {
        var pdf = await getPdfDoc(f);
        for (var p = 1; p <= pdf.numPages; p++) {
          var page = await pdf.getPage(p);
          var vp = page.getViewport({ scale: PDF_SCALE });
          if (vp.width > PDF_MAX_WIDTH) vp = page.getViewport({ scale: PDF_SCALE * PDF_MAX_WIDTH / vp.width });
          var c = document.createElement('canvas');
          c.width = Math.floor(vp.width);
          c.height = Math.floor(vp.height);
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          var wc = makeWatermarkedCanvas(c, watermarkLines);
          c.width = 0;
          c.height = 0;
          await onCanvas(wc);
        }
      } else {
        var img = await loadImage(f);
        await onCanvas(makeWatermarkedCanvas(img, watermarkLines));
      }
    }
  }

  function pdfMeta() {
    var source = val('tk-source');
    var sourceText = source;
    if (source === '群友分享实体本') {
      var friend = val('tk-friendName');
      sourceText = friend ? '群友分享（' + friend + '）' : '群友分享（匿名）';
    }
    var hasWatermark = $('tk-hasWatermark') ? $('tk-hasWatermark').checked : true;
    return {
      sourceText: sourceText,
      hasWatermark: hasWatermark,
      watermarkLines: hasWatermark ? [
        '原作者：' + (val('tk-author') || '未填写') +
          ' 来源：' + sourceText +
          ' 汉化：' + (val('tk-translator') || '未填写') +
          ' 嵌字：' + (val('tk-typesetter') || '未填写'),
        CONFIG.resourceTail
      ] : [],
      stem: bracketName([
        $('tk-hasWarning').checked ? '预警' : '',
        val('tk-workTitle'),
        val('tk-author'),
        sourceText
      ], '')
    };
  }

  async function makeEncryptedPdf() {
    var files = sortedFiles($('tk-imageFiles').files);
    if (!files.length) { msg('tk-pdf-msg', 'err', '请先选择图片或 PDF。'); return; }

    var pdfs = files.filter(isPdfFile);
    var imgs = files.filter(function (f) { return !isPdfFile(f); });

    /* 多个 PDF（或图片 / PDF 混选）时，先询问合并策略 */
    var merge = true;
    var askMsg = '';
    if (pdfs.length > 1) {
      askMsg = '检测到 ' + pdfs.length + ' 个 PDF。\n\n· 合并：按文件名顺序合成 1 份加密 PDF\n' +
               '· 分别导出：每个 PDF 各出 1 份，打包成 ZIP 下载';
    } else if (pdfs.length === 1 && imgs.length) {
      askMsg = '检测到图片与 PDF 混选。\n\n· 合并：按文件名顺序合成 1 份加密 PDF\n' +
               '· 分别导出：图片合成一份、PDF 单独一份，打包成 ZIP 下载';
    }
    if (askMsg) {
      merge = await askConfirm({
        icon: '📎',
        title: '这些文件要合并成一个 PDF 吗？',
        message: askMsg,
        okText: '合并为一份',
        cancelText: '分别导出'
      });
    }
    if (files.length > CONFIG.maxImageCount) {
      var goOn = await askConfirm({
        icon: '⚠️',
        title: '文件数量较大',
        message: '一次处理 ' + files.length + ' 个文件，浏览器极易内存溢出甚至崩溃，建议分批处理。\n确定继续吗？',
        okText: '仍要继续',
        cancelText: '取消'
      });
      if (!goOn) return;
    }

    setBusy('tk-makePdf', true, '处理中…');
    clearMsg('tk-pdf-msg');
    msg('tk-pdf-msg', 'info', merge ? '正在合并并加密，请勿关闭页面…' : '正在分别加密导出，请勿关闭页面…');

    try {
      needLib('jspdf');
      if (pdfs.length) needLib('pdfjs');
      if (!merge) needLib('jszip');
      await fontsReady();

      var meta = pdfMeta();
      var hasWarning = $('tk-hasWarning').checked;
      var warningText = val('tk-warningText');

      /* 统计总页数用于进度条 */
      var total = imgs.length;
      for (var i = 0; i < pdfs.length; i++) total += (await getPdfDoc(pdfs[i])).numPages;
      setBar('tk-pdf-bar', 'tk-pdf-bar-text', 0, total, '页');

      var done = 0;
      function attach(doc, canvas, state) {
        if (!doc) {
          if (hasWarning && !state.warningAdded) {
            var wc = makeWarningCanvas(warningText, canvas.width, canvas.height);
            doc = createEncryptedPdf(wc);
            addCanvasToPdf(doc, wc, true);
            wc.width = 0;
            wc.height = 0;
            state.warningAdded = true;
            addCanvasToPdf(doc, canvas, false);
          } else {
            doc = createEncryptedPdf(canvas);
            addCanvasToPdf(doc, canvas, true);
          }
        } else {
          addCanvasToPdf(doc, canvas, false);
        }
        canvas.width = 0;
        canvas.height = 0;
        done += 1;
        setBar('tk-pdf-bar', 'tk-pdf-bar-text', done, total, '页');
        return doc;
      }

      if (merge) {
        var doc = null;
        var st = { warningAdded: false };
        await eachPageCanvas(files, meta.watermarkLines, function (canvas) {
          doc = attach(doc, canvas, st);
        });
        var oneName = meta.stem + '.pdf';
        downloadBlob(doc.output('blob'), oneName);
        msg('tk-pdf-msg', 'ok', '✓ 已合并加密：' + oneName + '（共 ' + done + ' 页，口令 ' + CONFIG.pdfPassword + '）');
      } else {
        var groups = [];
        if (imgs.length) groups.push(imgs);
        pdfs.forEach(function (f) { groups.push([f]); });

        var zip = new JSZip();
        var names = [];
        for (var g = 0; g < groups.length; g++) {
          var gdoc = null;
          var gst = { warningAdded: false };
          await eachPageCanvas(groups[g], meta.watermarkLines, function (canvas) {
            gdoc = attach(gdoc, canvas, gst);
          });
          var nm = meta.stem + (groups.length > 1 ? '-' + (g + 1) : '') + '.pdf';
          zip.file(nm, gdoc.output('blob'));
          names.push(nm);
        }
        if (groups.length === 1) {
          downloadBlob(await zip.files[names[0]].async('blob'), names[0]);
          msg('tk-pdf-msg', 'ok', '✓ 已加密导出：' + names[0] + '（共 ' + done + ' 页，口令 ' + CONFIG.pdfPassword + '）');
        } else {
          var zipName = meta.stem + '_加密打包.zip';
          downloadBlob(await zip.generateAsync({ type: 'blob' }), zipName);
          msg('tk-pdf-msg', 'ok', '✓ 已分别加密 ' + groups.length + ' 份并打包：' + zipName + '（' + names.join('、') + '）');
        }
      }
      resetBar('tk-pdf-bar', 'tk-pdf-bar-text');
    } catch (err) {
      console.error(err);
      msg('tk-pdf-msg', 'err', '✗ 生成失败：' + (err.message || err));
      resetBar('tk-pdf-bar', 'tk-pdf-bar-text');
    } finally {
      setBusy('tk-makePdf', false);
    }
  }

  /* ============================================================
   * ② PDF 转图片
   * ============================================================ */
  async function pdfToImages() {
    var file = $('tk-pdfFile').files[0];
    if (!file) { msg('tk-split-msg', 'err', '请先选择 PDF 文件。'); return; }

    setBusy('tk-splitPdf', true, '拆页中…');
    clearMsg('tk-split-msg');
    msg('tk-split-msg', 'info', '正在按页渲染，请勿关闭页面…');
    setBar('tk-split-bar', 'tk-split-bar-text', 0, 1, '页');

    try {
      needLib('pdfjs');
      needLib('jszip');
      var data = await readAsArrayBuffer(file);
      var pdf = await pdfjsLib.getDocument({ data: data }).promise;
      var zip = new JSZip();

      for (var p = 1; p <= pdf.numPages; p++) {
        setBar('tk-split-bar', 'tk-split-bar-text', p, pdf.numPages, '页');
        var page = await pdf.getPage(p);
        var viewport = page.getViewport({ scale: 2 });
        var canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
        zip.file(String(p).padStart(3, '0') + '.jpg', await canvasToBlob(canvas, 'image/jpeg', 0.8));
        canvas.width = 0;
        canvas.height = 0;
      }

      var name = joinName([file.name.replace(/\.[^.]+$/, ''), 'PDF拆分图片'], '.zip');
      downloadBlob(await zip.generateAsync({ type: 'blob' }), name);
      msg('tk-split-msg', 'ok', '✓ 已导出 ' + pdf.numPages + ' 页 JPG：' + name);
      resetBar('tk-split-bar', 'tk-split-bar-text');
    } catch (err) {
      console.error(err);
      msg('tk-split-msg', 'err', '✗ 转换失败：' + (err.message || err));
      resetBar('tk-split-bar', 'tk-split-bar-text');
    } finally {
      setBusy('tk-splitPdf', false);
    }
  }

  /* ============================================================
   * ③ 加长白条
   * ============================================================ */
  async function processStrip() {
    var files = sortedFiles($('tk-stripFiles').files);
    if (!files.length) { msg('tk-strip-msg', 'err', '请先选择图片。'); return; }

    var exportType = val('tk-stripExport');
    var noticeText = $('tk-customWarning').checked ? val('tk-customWarningText') : CONFIG.noticeText;
    if (exportType === '单张长图' && files.length > 15) {
      var keepGoing = await askConfirm({
        icon: '⚠️',
        title: '图片数量较大',
        message: '把 ' + files.length + ' 张图拼成一张长图，极易导致浏览器崩溃，建议改用「多图 ZIP」。\n确定继续合并吗？',
        okText: '仍要合并',
        cancelText: '取消'
      });
      if (!keepGoing) return;
    }

    setBusy('tk-makeStrip', true, '处理中…');
    clearMsg('tk-strip-msg');
    msg('tk-strip-msg', 'info', '正在处理，请勿关闭页面…');
    setBar('tk-strip-bar', 'tk-strip-bar-text', 0, files.length);

    try {
      needLib('jszip');
      await fontsReady();

      if (exportType === '多图ZIP') {
        var zip = new JSZip();
        for (var i = 0; i < files.length; i++) {
          setBar('tk-strip-bar', 'tk-strip-bar-text', i + 1, files.length);
          var canvas = makeLongCanvas(await loadImage(files[i]), noticeText);
          zip.file(String(i + 1).padStart(3, '0') + '_加白条.jpg', await canvasToBlob(canvas, 'image/jpeg', 0.8));
          canvas.width = 0;
          canvas.height = 0;
        }
        downloadBlob(await zip.generateAsync({ type: 'blob' }), '加长白条.zip');
        msg('tk-strip-msg', 'ok', '✓ 已打包 ' + files.length + ' 张：加长白条.zip');
      } else {
        var images = [];
        for (var j = 0; j < files.length; j++) {
          setBar('tk-strip-bar', 'tk-strip-bar-text', j + 1, files.length);
          images.push(await loadImage(files[j]));
        }
        var stitched = makeStitchedCanvas(images, noticeText);
        downloadBlob(await canvasToBlob(stitched, 'image/jpeg', 0.8), '合并长图.jpg');
        msg('tk-strip-msg', 'ok', '✓ 已生成合并长图.jpg（' + files.length + ' 张拼接）');
      }
      resetBar('tk-strip-bar', 'tk-strip-bar-text');
    } catch (err) {
      console.error(err);
      msg('tk-strip-msg', 'err', '✗ 处理失败：' + (err.message || err));
      resetBar('tk-strip-bar', 'tk-strip-bar-text');
    } finally {
      setBusy('tk-makeStrip', false);
    }
  }

  /* ============================================================
   * ④ 线条变色
   * ============================================================ */
  async function processLineart() {
    var files = sortedFiles($('tk-lineartFiles').files);
    if (!files.length) { msg('tk-lineart-msg', 'err', '请先选择图片或 PDF。'); return; }

    var isPdf = files.some(function (f) {
      return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    });
    if (isPdf && files.length > 1) { msg('tk-lineart-msg', 'err', 'PDF 模式一次只能处理 1 个文件。'); return; }

    var target = hexToRgb($('tk-lineartColor').value);
    if (!target) { msg('tk-lineart-msg', 'err', '目标颜色无效。'); return; }
    var threshold = Math.min(255, Math.max(10, Number($('tk-lineartThreshold').value) || 200));

    setBusy('tk-processLineart', true, '处理中…');
    clearMsg('tk-lineart-msg');
    $('tk-lineartPreview').classList.add('hide');
    msg('tk-lineart-msg', 'info', '正在处理，请勿关闭页面…');
    setBar('tk-lineart-bar', 'tk-lineart-bar-text', 0, 1, isPdf ? '页' : '张');

    try {
      needLib('jszip');
      var out = [];

      if (isPdf) {
        needLib('pdfjs');
        var pdf = await pdfjsLib.getDocument({ data: await readAsArrayBuffer(files[0]) }).promise;
        for (var p = 1; p <= pdf.numPages; p++) {
          setBar('tk-lineart-bar', 'tk-lineart-bar-text', p, pdf.numPages, '页');
          var page = await pdf.getPage(p);
          var vp = page.getViewport({ scale: 1.5 });
          var c = document.createElement('canvas');
          c.width = Math.floor(vp.width);
          c.height = Math.floor(vp.height);
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          out.push(recolorCanvas(c, target, threshold));
        }
      } else {
        for (var i = 0; i < files.length; i++) {
          setBar('tk-lineart-bar', 'tk-lineart-bar-text', i + 1, files.length);
          var img = await loadImage(files[i]);
          var ic = document.createElement('canvas');
          ic.width = img.naturalWidth || img.width;
          ic.height = img.naturalHeight || img.height;
          ic.getContext('2d').drawImage(img, 0, 0);
          out.push(recolorCanvas(ic, target, threshold));
        }
      }

      if (out.length === 1) {
        var base = files[0].name.replace(/\.[^.]+$/, '');
        downloadBlob(await canvasToBlob(out[0], 'image/png'), joinName([base, '线条变色'], '.png'));
        var pv = $('tk-lineartPreview');
        pv.src = out[0].toDataURL('image/png');
        pv.classList.remove('hide');
        msg('tk-lineart-msg', 'ok', '✓ 已导出 PNG（保留透明通道）：' + base + ' 线条变色.png');
      } else {
        var zip = new JSZip();
        for (var k = 0; k < out.length; k++) {
          zip.file(String(k + 1).padStart(3, '0') + '.png', await canvasToBlob(out[k], 'image/png'));
          out[k].width = 0;
          out[k].height = 0;
        }
        downloadBlob(await zip.generateAsync({ type: 'blob' }), '线条变色图片.zip');
        msg('tk-lineart-msg', 'ok', '✓ 已打包 ' + out.length + ' 张：线条变色图片.zip');
      }
      resetBar('tk-lineart-bar', 'tk-lineart-bar-text');
    } catch (err) {
      console.error(err);
      msg('tk-lineart-msg', 'err', '✗ 处理失败：' + (err.message || err));
      resetBar('tk-lineart-bar', 'tk-lineart-bar-text');
    } finally {
      setBusy('tk-processLineart', false);
    }
  }

  /* ============================================================
   * ⑤ 文件名生成
   * ============================================================ */
  function updateFilenamePreview() {
    var source = val('tk-renameSource');
    var sourceText = source === '群友分享实体本' ? (val('tk-renameFriendName') || source) : source;
    $('tk-filenamePreview').value = bracketName([
      $('tk-renameHasWarning').checked ? '预警' : '',
      val('tk-renameTitle'),
      val('tk-renameAuthor'),
      val('tk-renameTranslator'),
      sourceText
    ], '.pdf');
  }
  function copyFilename() {
    var text = $('tk-filenamePreview').value;
    if (!text) { msg('tk-copy-msg', 'err', '请先填写至少一项信息。'); return; }
    var done = function () {
      msg('tk-copy-msg', 'ok', '✓ 已复制文件名到剪贴板。');
      setTimeout(function () { clearMsg('tk-copy-msg'); }, 2200);
    };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { msg('tk-copy-msg', 'err', '复制失败，请手动选中输入框内容复制。'); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  /* ============================================================
   * 二级页签切换 + 事件绑定
   * ============================================================ */
  function switchTool(tool) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'), function (t) {
      t.classList.toggle('active', t.getAttribute('data-tool') === tool);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-tool-page]'), function (p) {
      p.classList.toggle('active', p.getAttribute('data-tool-page') === tool);
    });
  }

  function toggleFriend() {
    $('tk-friendWrap').classList.toggle('hide', val('tk-source') !== '群友分享实体本');
  }
  function toggleRenameFriend() {
    $('tk-renameFriendWrap').classList.toggle('hide', val('tk-renameSource') !== '群友分享实体本');
  }
  function toggleWarning() {
    $('tk-warningWrap').classList.toggle('hide', !$('tk-hasWarning').checked);
  }
  function toggleCustomWarning() {
    $('tk-customWarningWrap').classList.toggle('hide', !$('tk-customWarning').checked);
  }

  function initTools() {
    if (!$('tk-tabs')) return;

    $('tk-tabs').addEventListener('click', function (e) {
      var t = e.target.closest('[data-tool]');
      if (t) switchTool(t.getAttribute('data-tool'));
    });

    $('tk-source').addEventListener('change', toggleFriend);
    $('tk-hasWarning').addEventListener('change', toggleWarning);
    $('tk-renameSource').addEventListener('change', function () { toggleRenameFriend(); updateFilenamePreview(); });
    $('tk-customWarning').addEventListener('change', toggleCustomWarning);

    $('tk-imageFiles').addEventListener('change', function () { updateMixedLabel('tk-imageFiles', 'tk-imageFilesName'); });
    $('tk-pdfFile').addEventListener('change', function () { updateFileLabel('tk-pdfFile', 'tk-pdfFileName'); });
    $('tk-stripFiles').addEventListener('change', function () { updateFileLabel('tk-stripFiles', 'tk-stripFilesName'); });
    $('tk-lineartFiles').addEventListener('change', function () { updateFileLabel('tk-lineartFiles', 'tk-lineartFilesName'); });

    $('tk-lineartColor').addEventListener('input', function () { $('tk-colorHex').textContent = this.value; });

    ['tk-renameHasWarning', 'tk-renameTitle', 'tk-renameAuthor', 'tk-renameTranslator', 'tk-renameFriendName']
      .forEach(function (id) {
        $(id).addEventListener('input', updateFilenamePreview);
        $(id).addEventListener('change', updateFilenamePreview);
      });

    $('tk-makePdf').addEventListener('click', makeEncryptedPdf);
    $('tk-splitPdf').addEventListener('click', pdfToImages);
    $('tk-makeStrip').addEventListener('click', processStrip);
    $('tk-processLineart').addEventListener('click', processLineart);
    $('tk-copyFilename').addEventListener('click', copyFilename);

    toggleFriend();
    toggleRenameFriend();
    toggleWarning();
    toggleCustomWarning();
    updateFilenamePreview();
  }

  initTools();
})();
