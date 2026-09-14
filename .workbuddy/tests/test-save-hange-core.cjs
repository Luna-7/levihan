/**
 * 拯救韩吉（SAVE HANGE）输入手感 + 状态机 + 音效 回归测试
 * —— 真实浏览器 + 真实构建产物
 *
 * 运行方式：
 *   1) 先起预览服务：./node_modules/.bin/vite preview --config vite.save-hange.config.ts --port 4174 --strictPort
 *   2) NODE_PATH=/Users/luna/.workbuddy/binaries/node/workspace/node_modules \
 *        node .workbuddy/tests/test-save-hange-core.cjs
 *
 * 覆盖：
 *   - 点击只选中、绝不移动；非法点击/非法拖拽不会启动游戏
 *   - 拖拽是唯一的位置改变方式（键盘除外）：跟手、轴锁、半格吸附、回弹
 *   - 一次拖拽跨多格只计 1 次移动；pointerup 与 click 不重复触发
 *   - 键盘单格移动、失败给 blocked 反馈
 *   - 倒计时与音频同源；切难度/重开 = 全新对局
 *   - 音频播完 = 失败；胜利后不再触发失败（终态互斥）
 *   - SFX 增益提升且输出经过限幅（实测峰值不削波）
 *   - 宿主 BGM 协议 save-hange-bgm 的 start / end
 */
const { chromium } = require('playwright-core');

const BASE = process.env.SH_BASE || 'http://localhost:4174/save-hange/';

const PASS = [];
const FAIL = [];
function check(name, ok, detail) {
  (ok ? PASS : FAIL).push(name);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined ? '  → ' + String(detail).slice(0, 300) : ''));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readHud(page) {
  return page.evaluate(() => {
    const byLabel = (text) =>
      [...document.querySelectorAll('span')].find((el) => el.textContent.trim() === text);
    const readValue = (text) => {
      const label = byLabel(text);
      if (!label || !label.parentElement) return null;
      const spans = label.parentElement.querySelectorAll('span');
      return spans.length >= 2 ? spans[spans.length - 1].textContent.trim() : null;
    };
    return { remaining: readValue('剩余时间'), moves: readValue('移动次数') };
  });
}

/** SoundManager 里的 <audio> 是脱离 DOM 的 new Audio()，靠 initScript 捕获 */
async function readAudio(page) {
  return page.evaluate(() => {
    const audio = (window.__audios || [])[0];
    if (!audio) return null;
    return {
      currentTime: audio.currentTime,
      duration: Number.isFinite(audio.duration) ? audio.duration : null,
      paused: audio.paused,
      ended: audio.ended,
      src: audio.src,
    };
  });
}

const readMessages = (page) =>
  page.evaluate(() => (window.__msgs || []).map((m) => (m && m.type) + ':' + (m && m.state)));

/** 棋子的网格坐标（由内联 left/top 百分比反推） */
async function pieceGrid(page, id) {
  return page.evaluate((pieceId) => {
    const el = document.getElementById('piece-' + pieceId);
    if (!el) return null;
    return { x: parseFloat(el.style.left) / 25, y: parseFloat(el.style.top) / 20 };
  }, id);
}

/** 棋子是否处于选中态（选中会加 ring-2 描边） */
async function isSelected(page, id) {
  return page.evaluate((pieceId) => {
    const el = document.querySelector('#piece-' + pieceId + ' > div');
    return el ? el.className.includes('ring-2') : false;
  }, id);
}

async function boardMetrics(page) {
  return page.evaluate(() => {
    const board = document.getElementById('piece-hange').parentElement;
    const rect = board.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      cellW: rect.width / 4,
      cellH: rect.height / 5,
    };
  });
}

async function pieceCenter(page, id) {
  return page.evaluate((pieceId) => {
    const el = document.getElementById('piece-' + pieceId);
    const rect = el.getBoundingClientRect();
    return { cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2 };
  }, id);
}

/** 按格子位移拖拽棋子（可传小数，用于测回弹） */
async function dragByCells(page, id, dxCells, dyCells, steps = 4) {
  const before = await pieceCenter(page, id);
  const { cellW, cellH } = await boardMetrics(page);
  const targetX = before.cx + dxCells * cellW;
  const targetY = before.cy + dyCells * cellH;

  await page.mouse.move(before.cx, before.cy);
  await page.mouse.down();
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(
      before.cx + ((targetX - before.cx) * step) / steps,
      before.cy + ((targetY - before.cy) * step) / steps
    );
  }
  await page.mouse.up();
  await sleep(220); // 等 0.14s 吸附动画结束
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const page = await browser.newPage({ viewport: { width: 460, height: 900 } });

  const errors = [];
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });

  // 捕获 SoundManager 创建的 Audio、宿主消息，以及 SFX 总线的实际输出峰值
  await page.addInitScript(() => {
    window.__audios = [];
    window.__msgs = [];
    window.__audioDebug = { gains: [], compressorInChain: false, analyser: null, peak: 0 };

    const NativeAudio = window.Audio;
    window.Audio = function (...args) {
      const el = new NativeAudio(...args);
      window.__audios.push(el);
      return el;
    };
    window.Audio.prototype = NativeAudio.prototype;

    window.addEventListener('message', (event) => window.__msgs.push(event.data));

    const NativeCtx = window.AudioContext;
    const nativeCreateGain = NativeCtx.prototype.createGain;
    NativeCtx.prototype.createGain = function () {
      const node = nativeCreateGain.call(this);
      window.__audioDebug.gains.push(node);
      return node;
    };

    // 在「连到 destination」的最后一段插一个 AnalyserNode，量真实输出峰值。
    // 游戏里只有 SFX 总线走 Web Audio（Bauklötze 是 HTMLAudioElement），
    // 所以这里量到的就是 SFX 的最终电平。
    const nativeConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...rest) {
      try {
        if (destination instanceof AudioDestinationNode) {
          const ctx = destination.context;
          if (!window.__audioDebug.analyser) {
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            window.__audioDebug.analyser = analyser;
            const buffer = new Float32Array(analyser.fftSize);
            const tick = () => {
              analyser.getFloatTimeDomainData(buffer);
              for (let i = 0; i < buffer.length; i++) {
                const value = Math.abs(buffer[i]);
                if (value > window.__audioDebug.peak) window.__audioDebug.peak = value;
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }
          window.__audioDebug.compressorInChain =
            window.__audioDebug.compressorInChain || this instanceof DynamicsCompressorNode;
          nativeConnect.call(window.__audioDebug.analyser, destination);
          return nativeConnect.call(this, window.__audioDebug.analyser, ...rest);
        }
      } catch {
        /* 落回原生连接 */
      }
      return nativeConnect.call(this, destination, ...rest);
    };
  });

  console.log('\n=== SAVE HANGE 输入手感 / 状态机 / 音效 回归 ===\n');

  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#piece-hange', { timeout: 30000 });

  /* ---------- A. 待机态 ---------- */
  await sleep(1200);
  const standbyHud = await readHud(page);
  const standbyAudio = await readAudio(page);
  check('待机：移动次数为 0', standbyHud.moves === '0', standbyHud.moves);
  check('待机：剩余时间为整首终曲', standbyHud.remaining === '03:56', standbyHud.remaining);
  check('待机：音频未播放', !!standbyAudio && standbyAudio.paused && standbyAudio.currentTime === 0);
  check('待机：未发送任何 BGM 消息', (await readMessages(page)).length === 0);

  /* ---------- B. 点击 = 只选中，绝不移动 ---------- */
  const titan1Before = await pieceGrid(page, 'titan_1');
  await page.click('#piece-titan_1');
  await sleep(300);
  const afterClickHud = await readHud(page);
  const titan1AfterClick = await pieceGrid(page, 'titan_1');
  check('点击棋子：移动次数保持 0（不再自动移动）', afterClickHud.moves === '0', afterClickHud.moves);
  check('点击棋子：棋子位置完全没变',
    titan1Before.x === titan1AfterClick.x && titan1Before.y === titan1AfterClick.y,
    `${JSON.stringify(titan1Before)} -> ${JSON.stringify(titan1AfterClick)}`);
  check('点击棋子：不会启动游戏（音频仍暂停）', (await readAudio(page)).paused === true);
  check('点击棋子：不会发送 start', !(await readMessages(page)).includes('save-hange-bgm:start'));
  check('点击棋子：选中态可见', await isSelected(page, 'titan_1'));

  await page.click('#piece-hange');
  await sleep(200);
  check('点击其它棋子：切换选中', (await isSelected(page, 'hange')) && !(await isSelected(page, 'titan_1')));

  /* ---------- C. 非法拖拽（不足半格）→ 回弹、不计步、不启动 ---------- */
  await dragByCells(page, 'titan_1', 0, 0.3);
  const afterTinyDragHud = await readHud(page);
  const titan1AfterTiny = await pieceGrid(page, 'titan_1');
  check('拖拽不足半格：回弹到原格，不计步', afterTinyDragHud.moves === '0' &&
    titan1AfterTiny.x === titan1Before.x && titan1AfterTiny.y === titan1Before.y,
    `moves=${afterTinyDragHud.moves} pos=${JSON.stringify(titan1AfterTiny)}`);
  check('非法拖拽：不会启动游戏计时', (await readAudio(page)).paused === true);
  check('非法拖拽：给出 blocked 抖动反馈', await page.evaluate(() => {
    const el = document.querySelector('#piece-titan_1 > div');
    return el ? el.className.includes('animate-lockedShake') : false;
  }));

  /* ---------- D. 键盘：合法移动 ---------- */
  await page.click('#piece-titan_1'); // 选中
  await page.keyboard.press('ArrowDown');
  await sleep(300);
  const afterKeyHud = await readHud(page);
  const titan1AfterKey = await pieceGrid(page, 'titan_1');
  check('键盘下移：成功移动一格', titan1AfterKey.y === titan1Before.y + 1, JSON.stringify(titan1AfterKey));
  check('键盘下移：移动次数恰好 +1', afterKeyHud.moves === '1', afterKeyHud.moves);
  check('第一次有效移动：音频才开始播放', (await readAudio(page)).paused === false);
  check('第一次有效移动：向宿主发送 start', (await readMessages(page)).includes('save-hange-bgm:start'));

  /* ---------- E. 键盘：非法移动（已在底边） ---------- */
  await page.keyboard.press('ArrowDown');
  await sleep(200);
  const afterKeyBlockedHud = await readHud(page);
  const titan1AfterBlocked = await pieceGrid(page, 'titan_1');
  check('键盘非法移动：位置不变', titan1AfterBlocked.y === titan1AfterKey.y, JSON.stringify(titan1AfterBlocked));
  check('键盘非法移动：不计步', afterKeyBlockedHud.moves === '1', afterKeyBlockedHud.moves);
  check('键盘非法移动：给出 blocked 抖动反馈', await page.evaluate(() => {
    const el = document.querySelector('#piece-titan_1 > div');
    return el ? el.className.includes('animate-lockedShake') : false;
  }));

  /* ---------- F. 倒计时与音频同源 ---------- */
  await sleep(1600);
  const hudF = await readHud(page);
  const audioF = await readAudio(page);
  const expectedRemaining = audioF.duration ? audioF.duration - audioF.currentTime : null;
  const shownSeconds = hudF.remaining
    ? Number(hudF.remaining.split(':')[0]) * 60 + Number(hudF.remaining.split(':')[1])
    : null;
  check('倒计时 = 音频时长 - 已播放位置（误差 ≤1.2s）',
    expectedRemaining !== null && shownSeconds !== null && Math.abs(shownSeconds - expectedRemaining) <= 1.2,
    `UI=${hudF.remaining} 音频=${expectedRemaining === null ? 'n/a' : expectedRemaining.toFixed(2)}`);

  /* ---------- G. 切难度 = 全新对局 ---------- */
  await page.click('#difficulty-selector-btn');
  await page.waitForSelector('text=新兵突破', { timeout: 5000 });
  await page.click('text=新兵突破');
  await sleep(400);
  const afterSwitchHud = await readHud(page);
  const afterSwitchAudio = await readAudio(page);
  check('切难度：移动次数归零', afterSwitchHud.moves === '0', afterSwitchHud.moves);
  check('切难度：倒计时复位为终曲全长', afterSwitchHud.remaining === '03:56', afterSwitchHud.remaining);
  check('切难度：旧音频停止并归零',
    !!afterSwitchAudio && afterSwitchAudio.paused && afterSwitchAudio.currentTime === 0);
  check('切难度：向宿主发送 end', (await readMessages(page)).includes('save-hange-bgm:end'));
  check('切难度：EASY 布局生效（韩吉 x=25%）', (await pieceGrid(page, 'hange')).x === 1);

  /* ---------- H. 一次多格拖拽 = 恰好 1 次移动 ---------- */
  const titan3Before = await pieceGrid(page, 'titan_3');
  check('EASY 初始：titan_3 位于最左列', titan3Before.x === 0 && titan3Before.y === 4, JSON.stringify(titan3Before));

  await dragByCells(page, 'titan_3', 2, 0, 6);
  const afterDragHud = await readHud(page);
  const titan3After = await pieceGrid(page, 'titan_3');
  check('多格拖拽：棋子跟手滑满 2 格', titan3After.x === 2, JSON.stringify(titan3After));
  check('多格拖拽：移动次数恰好 +1（pointerup 与 click 未重复触发）',
    afterDragHud.moves === '1', afterDragHud.moves);
  check('拖拽后：选中态保持', await isSelected(page, 'titan_3'));
  check('拖拽也会启动音乐（第二次 start）',
    (await readMessages(page)).filter((m) => m === 'save-hange-bgm:start').length === 2);

  /* ---------- I. 音频自然播完 = 失败 ---------- */
  await page.evaluate(() => {
    const audio = window.__audios[0];
    audio.currentTime = Math.max(0, audio.duration - 0.4);
  });
  await page.waitForSelector('#defeat-restart-btn', { timeout: 15000 });
  check('音频播完：出现失败弹窗', !!(await page.$('#defeat-restart-btn')));
  check('音频播完：没有同时出现胜利弹窗', !(await page.$('#proceed-to-victory-card-btn')));
  check('音频播完：向宿主发送 end', (await readMessages(page)).includes('save-hange-bgm:end'));

  const movesBeforeLockedClick = (await readHud(page)).moves;
  await page.click('#piece-titan_4').catch(() => {});
  await sleep(300);
  check('终态锁：失败后点击不再计步', (await readHud(page)).moves === movesBeforeLockedClick,
    `${movesBeforeLockedClick} -> ${(await readHud(page)).moves}`);

  /* ---------- J. 重开 ---------- */
  await page.click('#defeat-restart-btn');
  await sleep(400);
  const afterRestartHud = await readHud(page);
  const afterRestartAudio = await readAudio(page);
  check('重开：移动次数归零', afterRestartHud.moves === '0', afterRestartHud.moves);
  check('重开：倒计时复位', afterRestartHud.remaining === '03:56', afterRestartHud.remaining);
  check('重开：旧音频停止且归零（不会继续播）',
    !!afterRestartAudio && afterRestartAudio.paused && afterRestartAudio.currentTime === 0);
  check('重开：失败弹窗消失', !(await page.$('#defeat-restart-btn')));
  check('重开：棋盘回到 EASY 初始布局', (await pieceGrid(page, 'titan_3')).x === 0);

  /* ---------- K. 胜利路径：真实拖拽重放 EASY 的 65 步最优解 ---------- */
  // 由 scripts/verify-save-hange-levels.ts 同源规则 BFS 求出
  const EASY_SOLUTION = [["founding_eren",0,1],["hange",0,1],["titan_1",0,1],["titan_1",1,0],["eren",1,0],["floch",0,-2],["hange",-1,0],["zeke",-1,0],["ymir",0,1],["titan_2",1,0],["titan_1",0,-1],["zeke",0,-1],["titan_4",0,-1],["titan_4",-1,0],["ymir",0,2],["zeke",1,0],["titan_4",0,-2],["hange",1,0],["floch",0,2],["eren",-1,0],["titan_1",-1,0],["titan_2",-1,0],["zeke",0,-1],["ymir",0,-1],["founding_eren",1,0],["titan_3",1,0],["floch",0,1],["eren",0,1],["titan_1",-1,0],["titan_2",-1,0],["titan_4",-1,0],["zeke",-1,0],["ymir",0,-2],["hange",1,0],["titan_4",0,1],["titan_2",0,1],["titan_1",1,0],["eren",0,-1],["floch",0,-1],["titan_3",-1,0],["titan_4",0,2],["hange",-1,0],["ymir",0,2],["zeke",1,0],["titan_1",1,0],["titan_2",1,0],["eren",1,0],["floch",0,-2],["hange",-1,0],["titan_2",0,2],["titan_1",0,2],["zeke",-1,0],["ymir",0,-2],["titan_1",1,0],["titan_2",0,-1],["founding_eren",0,-1],["titan_4",2,0],["titan_3",2,0],["hange",0,1],["titan_2",-2,0],["titan_1",-2,0],["founding_eren",0,-1],["titan_3",0,-1],["titan_3",1,0],["hange",1,0]];

  for (const [pieceId, dx, dy] of EASY_SOLUTION) {
    await dragByCells(page, pieceId, dx, dy);
  }

  let victoryReached = true;
  try {
    await page.waitForSelector('#proceed-to-victory-card-btn', { timeout: 8000 });
  } catch {
    victoryReached = false;
  }
  const finalHud = await readHud(page);
  check('胜利：65 步最优解全部落子后触发胜利', victoryReached, `moves=${finalHud.moves}`);
  check('胜利：移动次数恰好等于操作数 65（无重复计步）', finalHud.moves === '65', finalHud.moves);
  check('胜利：没有同时出现失败弹窗', !(await page.$('#defeat-restart-btn')));
  check('胜利：音频已立即暂停', (await readAudio(page)).paused === true);

  /* ---------- L. 终态互斥 ---------- */
  const endBefore = (await readMessages(page)).filter((m) => m === 'save-hange-bgm:end').length;
  await page.evaluate(() => {
    const audio = window.__audios[0];
    audio.currentTime = Math.max(0, audio.duration - 0.3);
    return audio.play().catch(() => {});
  });
  await sleep(1600);
  const endAfter = (await readMessages(page)).filter((m) => m === 'save-hange-bgm:end').length;
  check('终态互斥：胜利后音频再播完也不会触发失败', !(await page.$('#defeat-restart-btn')));
  check('终态互斥：不会重复发送 end', endAfter === endBefore, `${endBefore} -> ${endAfter}`);

  /* ---------- M. SFX 音量与限幅 ---------- */
  // 注意：增益是用 setValueAtTime 调度的，必须等音频跑起来之后再读同一节点，
  // 否则读到的是调度生效前的默认值 1
  const audioDebug = await page.evaluate(() => ({
    gainValue: window.__audioDebug.gains.length > 0 ? window.__audioDebug.gains[0].gain.value : null,
    compressorInChain: window.__audioDebug.compressorInChain,
    peak: window.__audioDebug.peak,
  }));
  // AudioParam 是 Float32，1.6 读回来是 1.600000023841858，必须带容差比较
  check('SFX 总线增益已提升到 1.6（原 0.65）',
    audioDebug.gainValue !== null && Math.abs(audioDebug.gainValue - 1.6) < 0.001,
    audioDebug.gainValue);
  check('SFX 输出经过限幅器（压缩器在链路中）', audioDebug.compressorInChain === true);
  check('SFX 实测峰值有存在感且未削波（0.05 < peak ≤ 1.0）',
    audioDebug.peak > 0.05 && audioDebug.peak <= 1.0, audioDebug.peak.toFixed(4));

  /* ---------- N. 无页面报错 ---------- */
  const realErrors = errors.filter((e) => !/favicon|ERR_/i.test(e));
  check('无页面报错', realErrors.length === 0, realErrors.join(' | '));

  await browser.close();

  console.log(`\n=== 结果：${PASS.length} 通过 / ${FAIL.length} 失败 ===`);
  if (FAIL.length > 0) {
    console.log('失败项：' + FAIL.join('；'));
    process.exit(1);
  }
})().catch((err) => {
  console.error('测试异常：', err);
  process.exit(1);
});
