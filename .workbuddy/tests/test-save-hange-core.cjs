/**
 * 拯救韩吉（SAVE HANGE）核心状态机回归测试 —— 真实浏览器 + 真实构建产物
 *
 * 运行方式：
 *   1) 先起预览服务：./node_modules/.bin/vite preview --config vite.save-hange.config.ts --port 4174 --strictPort
 *   2) NODE_PATH=/Users/luna/.workbuddy/binaries/node/workspace/node_modules \
 *        node .workbuddy/tests/test-save-hange-core.cjs
 *
 * 覆盖需求里点名的坑：
 *   - 页面加载不自动开始计时（待机态）
 *   - 点击一次只计 1 次移动
 *   - 一次多格拖拽只计 1 次移动（pointerup 与 click 不会重复触发）
 *   - 倒计时与音频同源（剩余时间 = duration - currentTime）
 *   - 切难度 = 全新对局（棋盘/步数/计时/音频全部重置）
 *   - 音频自然结束 → 失败，且终态后不再接受移动
 *   - 宿主 BGM 协议 save-hange-bgm 的 start / end 收发
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

/** 读取 HUD：剩余时间 / 移动次数 */
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

async function readMessages(page) {
  return page.evaluate(() => (window.__msgs || []).map((m) => (m && m.type) + ':' + (m && m.state)));
}

async function pieceXPercent(page, id) {
  return page.evaluate((pieceId) => {
    const el = document.getElementById('piece-' + pieceId);
    return el ? parseFloat(el.style.left) : null;
  }, id);
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

  // 捕获 SoundManager 内部创建的 Audio，并监听 postMessage（顶层打开时 parent === window）
  await page.addInitScript(() => {
    window.__audios = [];
    window.__msgs = [];
    const NativeAudio = window.Audio;
    window.Audio = function (...args) {
      const el = new NativeAudio(...args);
      window.__audios.push(el);
      return el;
    };
    window.Audio.prototype = NativeAudio.prototype;
    window.addEventListener('message', (event) => window.__msgs.push(event.data));
  });

  console.log('\n=== SAVE HANGE 核心状态机回归 ===\n');

  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#piece-hange', { timeout: 30000 });

  /* ---------- A. 待机态：不自动开始计时 ---------- */
  await sleep(1200); // 故意等一会儿，若会自动开始则必然露馅
  const standbyHud = await readHud(page);
  const standbyAudio = await readAudio(page);
  check('待机：移动次数为 0', standbyHud.moves === '0', standbyHud.moves);
  check('待机：剩余时间为整首终曲', standbyHud.remaining === '03:56', standbyHud.remaining);
  check('待机：音频未播放且未走秒', !!standbyAudio && standbyAudio.paused && standbyAudio.currentTime === 0,
    JSON.stringify(standbyAudio));
  check('待机：未发送任何 BGM 消息', (await readMessages(page)).length === 0);

  /* ---------- B. 点击一次 = 恰好 1 次移动，并启动音乐 ---------- */
  await page.click('#piece-titan_1');
  await sleep(300);
  const afterClickHud = await readHud(page);
  const afterClickAudio = await readAudio(page);
  check('点击一次：移动次数恰好 +1', afterClickHud.moves === '1', afterClickHud.moves);
  check('点击一次：音频开始播放', !!afterClickAudio && !afterClickAudio.paused, JSON.stringify(afterClickAudio));
  const msgsAfterClick = await readMessages(page);
  check('点击一次：向宿主发送 start', msgsAfterClick.includes('save-hange-bgm:start'), msgsAfterClick.join(','));

  /* ---------- C. 倒计时与音频同源 ---------- */
  await sleep(1800);
  const hudC = await readHud(page);
  const audioC = await readAudio(page);
  const expectedRemaining = audioC.duration ? audioC.duration - audioC.currentTime : null;
  const shownSeconds = hudC.remaining
    ? Number(hudC.remaining.split(':')[0]) * 60 + Number(hudC.remaining.split(':')[1])
    : null;
  check('倒计时 = 音频时长 - 已播放位置（误差 ≤1.2s）',
    expectedRemaining !== null && shownSeconds !== null && Math.abs(shownSeconds - expectedRemaining) <= 1.2,
    `UI=${hudC.remaining} 音频=${expectedRemaining === null ? 'n/a' : expectedRemaining.toFixed(2)} currentTime=${audioC.currentTime?.toFixed(2)}`);

  /* ---------- D. 切难度 = 全新对局 ---------- */
  await page.click('#difficulty-selector-btn');
  await page.waitForSelector('text=新兵突破', { timeout: 5000 });
  await page.click('text=新兵突破');
  await sleep(400);
  const afterSwitchHud = await readHud(page);
  const afterSwitchAudio = await readAudio(page);
  check('切难度：移动次数归零', afterSwitchHud.moves === '0', afterSwitchHud.moves);
  check('切难度：倒计时复位为终曲全长', afterSwitchHud.remaining === '03:56', afterSwitchHud.remaining);
  check('切难度：旧音频已停止并归零',
    !!afterSwitchAudio && afterSwitchAudio.paused && afterSwitchAudio.currentTime === 0,
    JSON.stringify(afterSwitchAudio));
  check('切难度：向宿主发送 end', (await readMessages(page)).includes('save-hange-bgm:end'));
  check('切难度：EASY 布局生效（韩吉 x=25%）', (await pieceXPercent(page, 'hange')) === 25);

  /* ---------- E. 一次多格拖拽 = 恰好 1 次移动 ---------- */
  const boardBox = await page.evaluate(() => {
    const board = document.getElementById('piece-hange').parentElement;
    const r = board.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const cellW = boardBox.width / 4;
  const cellH = boardBox.height / 5;

  const titan3 = await page.evaluate(() => {
    const el = document.getElementById('piece-titan_3');
    const r = el.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, left: parseFloat(el.style.left) };
  });
  check('EASY 初始：titan_3 位于最左列', titan3.left === 0, titan3.left);

  await page.mouse.move(titan3.cx, titan3.cy);
  await page.mouse.down();
  // 分步移动，越过 6px 轴锁定阈值，最终要求右移 2 格
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(titan3.cx + (cellW * 2 * step) / 6, titan3.cy, { steps: 1 });
    await sleep(30);
  }
  await page.mouse.up();
  await sleep(450);

  const afterDragHud = await readHud(page);
  const titan3After = await pieceXPercent(page, 'titan_3');
  check('多格拖拽：移动次数恰好 +1（pointerup 与 click 未重复触发）',
    afterDragHud.moves === '1', afterDragHud.moves);
  check('多格拖拽：棋子确实滑动了 2 格', titan3After === 50, titan3After);
  check('多格拖拽：拖拽也启动了音乐',
    (await readMessages(page)).filter((m) => m === 'save-hange-bgm:start').length === 2,
    (await readMessages(page)).join(','));

  /* ---------- F. 音频自然播完 = 失败 ---------- */
  await page.evaluate(() => {
    const audio = window.__audios[0];
    audio.currentTime = Math.max(0, audio.duration - 0.4);
  });
  await page.waitForSelector('#defeat-restart-btn', { timeout: 15000 });
  check('音频播完：出现失败弹窗', !!(await page.$('#defeat-restart-btn')));
  check('音频播完：没有同时出现胜利弹窗', !(await page.$('#victory-restart-btn')));
  const msgsAfterDefeat = await readMessages(page);
  check('音频播完：向宿主发送 end', msgsAfterDefeat.includes('save-hange-bgm:end'));

  const movesBeforeLockedClick = (await readHud(page)).moves;
  await page.evaluate(() => {
    // 终态下棋盘被锁，点击不应再产生任何移动
    document.getElementById('piece-titan_4')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
  });
  await sleep(300);
  check('终态锁：失败后点击不再计步', (await readHud(page)).moves === movesBeforeLockedClick,
    `${movesBeforeLockedClick} -> ${(await readHud(page)).moves}`);

  /* ---------- G. 重开 ---------- */
  await page.click('#defeat-restart-btn');
  await sleep(400);
  const afterRestartHud = await readHud(page);
  const afterRestartAudio = await readAudio(page);
  check('重开：移动次数归零', afterRestartHud.moves === '0', afterRestartHud.moves);
  check('重开：倒计时复位', afterRestartHud.remaining === '03:56', afterRestartHud.remaining);
  check('重开：旧音频停止且归零（不会继续播）',
    !!afterRestartAudio && afterRestartAudio.paused && afterRestartAudio.currentTime === 0,
    JSON.stringify(afterRestartAudio));
  check('重开：失败弹窗消失', !(await page.$('#defeat-restart-btn')));
  check('重开：棋盘回到 EASY 初始布局', (await pieceXPercent(page, 'titan_3')) === 0);

  /* ---------- H. 胜利路径：用真实拖拽重放 EASY 的 65 步最优解 ---------- */
  // 由 scripts/verify-save-hange-levels.ts 同源规则 BFS 求出（见交付说明）
  const EASY_SOLUTION = [["founding_eren",0,1],["hange",0,1],["titan_1",0,1],["titan_1",1,0],["eren",1,0],["floch",0,-2],["hange",-1,0],["zeke",-1,0],["ymir",0,1],["titan_2",1,0],["titan_1",0,-1],["zeke",0,-1],["titan_4",0,-1],["titan_4",-1,0],["ymir",0,2],["zeke",1,0],["titan_4",0,-2],["hange",1,0],["floch",0,2],["eren",-1,0],["titan_1",-1,0],["titan_2",-1,0],["zeke",0,-1],["ymir",0,-1],["founding_eren",1,0],["titan_3",1,0],["floch",0,1],["eren",0,1],["titan_1",-1,0],["titan_2",-1,0],["titan_4",-1,0],["zeke",-1,0],["ymir",0,-2],["hange",1,0],["titan_4",0,1],["titan_2",0,1],["titan_1",1,0],["eren",0,-1],["floch",0,-1],["titan_3",-1,0],["titan_4",0,2],["hange",-1,0],["ymir",0,2],["zeke",1,0],["titan_1",1,0],["titan_2",1,0],["eren",1,0],["floch",0,-2],["hange",-1,0],["titan_2",0,2],["titan_1",0,2],["zeke",-1,0],["ymir",0,-2],["titan_1",1,0],["titan_2",0,-1],["founding_eren",0,-1],["titan_4",2,0],["titan_3",2,0],["hange",0,1],["titan_2",-2,0],["titan_1",-2,0],["founding_eren",0,-1],["titan_3",0,-1],["titan_3",1,0],["hange",1,0]];

  const dragPiece = async (pieceId, dx, dy) => {
    const box = await page.evaluate((id) => {
      const el = document.getElementById('piece-' + id);
      const rect = el.getBoundingClientRect();
      const board = el.parentElement.getBoundingClientRect();
      return {
        cx: rect.x + rect.width / 2,
        cy: rect.y + rect.height / 2,
        cellW: board.width / 4,
        cellH: board.height / 5,
      };
    }, pieceId);

    const targetX = box.cx + dx * box.cellW;
    const targetY = box.cy + dy * box.cellH;

    await page.mouse.move(box.cx, box.cy);
    await page.mouse.down();
    for (let step = 1; step <= 4; step++) {
      await page.mouse.move(
        box.cx + ((targetX - box.cx) * step) / 4,
        box.cy + ((targetY - box.cy) * step) / 4
      );
    }
    await page.mouse.up();
    // 等 CSS 落格动画（0.18s）结束，避免下一次拖拽起点落在过渡中的位置
    await sleep(220);
  };

  for (const [pieceId, dx, dy] of EASY_SOLUTION) {
    await dragPiece(pieceId, dx, dy);
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
  check('胜利：已向宿主发送 end', (await readMessages(page)).includes('save-hange-bgm:end'));

  // 终态互斥：胜利后再让音频播到结束，绝不能反过来触发失败
  const endMessagesBefore = (await readMessages(page)).filter((m) => m === 'save-hange-bgm:end').length;
  await page.evaluate(() => {
    const audio = window.__audios[0];
    audio.currentTime = Math.max(0, audio.duration - 0.3);
    return audio.play().catch(() => {});
  });
  await sleep(1600);
  const endMessagesAfter = (await readMessages(page)).filter((m) => m === 'save-hange-bgm:end').length;
  check('终态互斥：胜利后音频再播完也不会触发失败',
    !(await page.$('#defeat-restart-btn')) && victoryReached !== false);
  check('终态互斥：不会重复发送 end', endMessagesAfter === endMessagesBefore,
    `${endMessagesBefore} -> ${endMessagesAfter}`);

  /* ---------- J. 控制台零错误 ---------- */
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
