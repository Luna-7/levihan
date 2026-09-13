/** 截图：登录页 + 主界面（已填表单 / 已选图片），不写入任何数据 */
const { chromium } = require('playwright-core');
const OUT = '/Users/luna/Downloads/levihan/levihan-repo/.workbuddy/screenshots';
const fs = require('fs');

const BASE = 'https://levihan-tudou-d0g7jivue1ccc4a35-1325571558.tcloudbaseapp.com';
const IMGS = ['/tmp/lhtest/p1.png', '/tmp/lhtest/p10.png', '/tmp/lhtest/p2.png'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const p = await b.newPage({ viewport: { width: 1240, height: 1000 }, deviceScaleFactor: 2 });

  await p.goto(BASE + '/admin/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (await p.$('#submitBtn')) {
    await p.waitForFunction(() => { const x = document.getElementById('submitBtn'); return x && !x.disabled; }, { timeout: 20000 });
    await p.click('#submitBtn');
    await p.waitForLoadState('domcontentloaded');
  }
  await p.waitForSelector('#view-login:not(.hide)', { timeout: 25000 });
  await p.screenshot({ path: OUT + '/admin-1-login.png' });
  console.log('✓ admin-1-login.png');

  await p.fill('#pw', 'lh-tudou-dvg9j2bq');
  await p.click('#btn-login');
  await p.waitForSelector('#view-main:not(.hide)', { timeout: 25000 });
  await p.waitForFunction(() => !/加载中/.test(document.getElementById('bk-list').textContent), { timeout: 30000 });

  await p.click('#btn-nextid');
  await p.fill('#f-titleZh', '示例：夏天的某个午后');
  await p.fill('#f-titleJp', '夏のある午後');
  await p.fill('#f-circle', '示例社团');
  await p.fill('#f-tags', '现代,日常,治愈');
  await p.fill('#f-source', 'web');
  await p.fill('#f-translator', 'LG');
  await p.fill('#f-typesetter', 'LG');
  await p.setInputFiles('#picker', IMGS);
  await p.waitForFunction(() => document.querySelectorAll('#files .file').length === 3, { timeout: 20000 });
  await p.waitForTimeout(600);

  await p.screenshot({ path: OUT + '/admin-2-main.png', fullPage: true });
  console.log('✓ admin-2-main.png');

  // 移动端视图（站长手机上也常用）
  const m = await b.newPage({ viewport: { width: 414, height: 900 }, deviceScaleFactor: 2 });
  await m.goto(BASE + '/admin/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (await m.$('#submitBtn')) {
    await m.waitForFunction(() => { const x = document.getElementById('submitBtn'); return x && !x.disabled; }, { timeout: 20000 });
    await m.click('#submitBtn');
    await m.waitForLoadState('domcontentloaded');
  }
  await m.waitForSelector('#view-login:not(.hide)', { timeout: 25000 });
  await m.screenshot({ path: OUT + '/admin-3-mobile-login.png' });
  console.log('✓ admin-3-mobile-login.png');

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
