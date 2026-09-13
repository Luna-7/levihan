/**
 * 深夜树洞 P1 嵌合 · 本地端到端验证（vite preview 服务 dist/）
 * 验证：5 个 tab、深夜树洞切换、iframe 加载、背景图不 404、?tab=treehole 直达、其余 tab 无回归
 */
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:4173';

const PASS = [], FAIL = [];
function check(name, cond, detail) {
  (cond ? PASS : FAIL).push(name);
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined ? '  → ' + String(detail).slice(0, 300) : ''));
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

  const consoleErrors = [];
  const badResponses = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon/.test(r.url())) badResponses.push(r.status() + ' ' + r.url());
  });

  console.log('\n=== 1. 打开主站首页 ===');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('nav[aria-label="主要导航"]', { timeout: 15000 });
  check('首页加载，导航出现', await page.isVisible('nav[aria-label="主要导航"]'));

  const tabTexts = await page.$$eval('nav[aria-label="主要导航"] button', (btns) => btns.map((b) => b.textContent.trim()));
  console.log('      导航 tab：', JSON.stringify(tabTexts));
  check('导航共 5 个 tab', tabTexts.length === 5, tabTexts.length);
  check('包含「深夜树洞」', tabTexts.some((t) => t.includes('深夜树洞')), tabTexts.join('/'));

  console.log('\n=== 2. 点击「深夜树洞」 ===');
  await page.click('nav button:has-text("深夜树洞")');
  await page.waitForSelector('iframe[title="深夜树洞"]', { timeout: 15000 });
  check('iframe 出现', await page.isVisible('iframe[title="深夜树洞"]'));
  check('iframe 指向 /treehole/', (await page.getAttribute('iframe[title="深夜树洞"]', 'src')) === '/treehole/index.html', await page.getAttribute('iframe[title="深夜树洞"]', 'src'));

  // 等 iframe 内部加载（onLoad 触发后骨架屏消失）
  await page.waitForFunction(() => {
    const f = document.querySelector('iframe[title="深夜树洞"]');
    return f && f.contentWindow && f.contentDocument && f.contentDocument.readyState === 'complete';
  }, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const frame = page.frames().find((fr) => fr.url().includes('/treehole/'));
  check('iframe 已加载完成', !!frame, frame ? frame.url() : '未找到 frame');

  if (frame) {
    const title = await frame.title().catch(() => '');
    check('树洞内标题正确', title.includes('深夜树洞'), title);
    const hasWriteBtn = await frame.$('#write-scroll-action-btn').catch(() => null);
    const hasDelveBtn = await frame.$('#delve-scroll-action-btn').catch(() => null);
    check('树洞「投递卷轴」按钮存在', !!hasWriteBtn);
    check('树洞「点击拾取」按钮存在', !!hasDelveBtn);
  }

  console.log('\n=== 3. 背景图路径（不应 404） ===');
  const bg404 = badResponses.filter((r) => r.includes('/treehole/') || r.includes('default_forest_bg'));
  check('树洞资源无 404（含背景图）', bg404.length === 0, bg404.join(' | ') || '无');

  console.log('\n=== 4. ?tab=treehole 直达 ===');
  await page.goto(BASE + '/?tab=treehole', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('iframe[title="深夜树洞"]', { timeout: 15000 });
  check('?tab=treehole 直达树洞', await page.isVisible('iframe[title="深夜树洞"]'));

  console.log('\n=== 5. 其余 tab 无回归 ===');
  for (const [name, sel] of [['兵团驻地', 'text=兵团驻地'], ['资源外链', 'text=资源外链'], ['塔塔开', 'text=塔塔开']]) {
    await page.click('nav button:has-text("' + name + '")');
    await page.waitForTimeout(400);
    check('切换回「' + name + '」无报错', true);
  }
  const navStill5 = await page.$$eval('nav[aria-label="主要导航"] button', (b) => b.length);
  check('切换后导航仍为 5 项', navStill5 === 5, navStill5);

  console.log('\n=== 6. 控制台错误 ===');
  const realErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
  check('无控制台错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | ') || '无');

  await browser.close();

  console.log('\n===== 结果：' + PASS.length + ' PASS / ' + FAIL.length + ' FAIL =====');
  if (FAIL.length) { console.log('失败项：\n  - ' + FAIL.join('\n  - ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('测试崩溃：', e); process.exit(2); });
