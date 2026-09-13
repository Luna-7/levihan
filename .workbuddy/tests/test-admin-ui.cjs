/**
 * 管理员上传台 · 真实浏览器端到端验证
 * - 登录 → 选图（故意乱序，验证自然排序）→ 上传 → 发布 → 公开校验 → 清理
 * - 捕获控制台错误与失败请求，确认没有 CORS / 转码问题
 */
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = 'https://levihan-tudou-d0g7jivue1ccc4a35-1325571558.tcloudbaseapp.com';
const ADMIN = BASE + '/admin/';
const FN = 'https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com/admin-upload';
const CDN = 'https://levihan-1325571558.cos-website.ap-nanjing.myqcloud.com';
const PASSWORD = 'lh-tudou-dvg9j2bq';
const IMGS = ['/tmp/lhtest/p1.png', '/tmp/lhtest/p10.png', '/tmp/lhtest/p2.png']; // 故意乱序

const PASS = [], FAIL = [];
function check(name, cond, detail) {
  (cond ? PASS : FAIL).push(name);
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined ? '  → ' + String(detail).slice(0, 300) : ''));
}

/**
 * 访问 tcloudbaseapp.com 测试域名时，直接导航（无同站 Referer）会先落到
 * CloudBase 的「风险提醒」中间页（倒计时 3 秒 + 确定访问）。此处自动点过。
 */
async function gotoPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (await page.$('#submitBtn')) {
    console.log('      （遇到 CloudBase 测试域名中间页，自动点击「确定访问」）');
    await page.waitForFunction(() => {
      const b = document.getElementById('submitBtn');
      return b && !b.disabled;
    }, { timeout: 20000 });
    await page.click('#submitBtn');
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

  const consoleErrors = [];
  const failedReqs = [];
  const badResponses = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => failedReqs.push(r.url() + ' :: ' + (r.failure() && r.failure().errorText)));
  page.on('response', (r) => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url()); });

  console.log('\n=== 1. 打开上传台 ===');
  await gotoPage(page, ADMIN);
  await page.waitForSelector('#view-login:not(.hide)', { timeout: 25000 });
  check('登录界面出现', await page.isVisible('#view-login'));
  check('页面标题正确', (await page.title()).includes('上传台'), await page.title());

  console.log('\n=== 2. 错误口令 ===');
  await page.fill('#pw', 'definitely-wrong');
  await page.click('#btn-login');
  await page.waitForSelector('#login-msg.show', { timeout: 20000 });
  check('错误口令给出提示', (await page.textContent('#login-msg')).includes('口令不正确'), await page.textContent('#login-msg'));

  console.log('\n=== 3. 正确口令登录 ===');
  await page.fill('#pw', PASSWORD);
  await page.click('#btn-login');
  await page.waitForSelector('#view-main:not(.hide)', { timeout: 25000 });
  check('进入主界面', await page.isVisible('#view-main'));

  await page.waitForFunction(() => {
    const t = document.getElementById('env-info').textContent || '';
    return /已连接|无法连接/.test(t);
  }, { timeout: 30000 });
  const envText = await page.textContent('#env-info');
  check('连接状态正常', envText.includes('已连接'), envText.trim());

  await page.waitForFunction(() => !/加载中/.test(document.getElementById('bk-list').textContent), { timeout: 30000 });
  const listText = await page.textContent('#bk-list');
  check('已收录列表读到远端 archive.json', listText.includes('lh-004'), listText.trim().slice(0, 120));

  console.log('\n=== 4. 填写作品信息 ===');
  await page.click('#btn-nextid');
  const newId = (await page.inputValue('#f-id')).trim();
  check('「下一个」按钮给出未占用编号', /^lh-\d+$/.test(newId) && newId !== 'lh-004', newId);

  await page.fill('#f-titleZh', '_后台自检_请忽略');
  await page.fill('#f-circle', '自检');
  await page.fill('#f-tags', '自检,临时');
  await page.fill('#f-category', '漫画本');

  console.log('\n=== 5. 选择图片（乱序输入，验证自然排序 + WebP 转码） ===');
  await page.setInputFiles('#picker', IMGS);
  await page.waitForFunction(() => document.querySelectorAll('#files .file').length === 3, { timeout: 20000 });
  const shown = await page.$$eval('#files .file .meta span:first-child', (els) => els.map((e) => e.textContent));
  check('三张图片全部进入列表', shown.length === 3, shown.join(','));
  const pagesVal = await page.inputValue('#f-pages');
  check('总页数自动填为 3', pagesVal === '3', pagesVal);
  const countText = await page.textContent('#files-count');
  check('文件计数与体积正确显示', /3 张/.test(countText), countText.trim());

  console.log('\n=== 6. 上传并发布 ===');
  // 在上传前挂一个观察器，记录进度条走到的最大百分比（发布成功后表单会重置）
  await page.evaluate(() => {
    window.__maxPct = 0;
    const bar = document.getElementById('bar');
    new MutationObserver(() => {
      const w = parseFloat(bar.style.width) || 0;
      if (w > window.__maxPct) window.__maxPct = w;
    }).observe(bar, { attributes: true, attributeFilter: ['style'] });
  });
  await page.click('#btn-upload');
  await page.waitForFunction(() => {
    const m = document.getElementById('main-msg');
    return m.classList.contains('show');
  }, { timeout: 180000 });
  const msg = await page.textContent('#main-msg');
  const ok = (await page.getAttribute('#main-msg', 'class')).includes('ok');
  check('上传发布成功', ok, msg.replace(/\s+/g, ' ').slice(0, 260));
  const maxPct = await page.evaluate(() => window.__maxPct);
  check('进度条走到 100%', maxPct === 100, 'maxPct=' + maxPct);
  check('成功提示确认 3 张全部上传', /图片已全部上传（3 张）/.test(msg), msg.replace(/\s+/g, ' ').slice(0, 200));
  const filesAfter = await page.$$eval('#files .file', (els) => els.length);
  check('发布后自动清空待传列表', filesAfter === 0, 'remaining=' + filesAfter);

  await page.screenshot({ path: '/tmp/lhtest/admin-success.png', fullPage: true });
  console.log('      截图已保存 /tmp/lhtest/admin-success.png');

  console.log('\n=== 7. 公开只读校验（站点实际读取路径） ===');
  const httpGet = async (url) => {
    const r = await fetch(url, { redirect: 'follow' });
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  };
  const cover = await httpGet(`${CDN}/${newId}/image01.webp`);
  check('封面 image01.webp 可公开访问', cover.status === 200 && cover.buf.length > 0, `status=${cover.status} bytes=${cover.buf.length}`);
  check('WebP 转码生效（文件头 RIFF/WEBP）',
    cover.buf.slice(0, 4).toString('ascii') === 'RIFF' && cover.buf.slice(8, 12).toString('ascii') === 'WEBP',
    cover.buf.slice(0, 12).toString('hex'));
  const last = await httpGet(`${CDN}/${newId}/image03.webp`);
  check('第 3 页 image03.webp 可访问', last.status === 200, `status=${last.status}`);

  const arc = await httpGet(`${CDN}/archive.json`);
  const books = JSON.parse(arc.buf.toString('utf8'));
  const entry = books.find((b) => b.id === newId);
  check('archive.json 已收录新作品', !!entry, entry ? JSON.stringify(entry).slice(0, 220) : `ids=${books.map(b => b.id)}`);

  console.log('\n=== 8. 列表刷新与删除（清理） ===');
  await page.click('#btn-reload');
  await page.waitForFunction((id) => {
    const t = document.getElementById('bk-list').textContent;
    return t.includes(id);
  }, newId, { timeout: 30000 });
  check('上传后列表出现新作品', true);

  page.once('dialog', (d) => d.accept());
  await page.click(`[data-del="${newId}"]`);
  await page.waitForFunction(() => {
    const m = document.getElementById('main-msg');
    return m.classList.contains('show') && /已删除/.test(m.textContent);
  }, { timeout: 60000 });
  check('删除成功', (await page.textContent('#main-msg')).includes('已删除'), (await page.textContent('#main-msg')).trim());

  const gone = await httpGet(`${CDN}/${newId}/image01.webp`);
  check('删除后图片返回 404', gone.status === 404, `status=${gone.status}`);
  const arc2 = await httpGet(`${CDN}/archive.json`);
  const books2 = JSON.parse(arc2.buf.toString('utf8'));
  check('归档恢复为仅 lh-004', books2.length === 1 && books2[0].id === 'lh-004', books2.map((b) => b.id).join(','));

  console.log('\n=== 9. 控制台 / 网络健康 ===');
  console.log('      全部 4xx/5xx 响应：');
  (badResponses.length ? badResponses : ['（无）']).forEach((x) => console.log('        · ' + x));

  // 已知且预期：favicon；错误口令那一步的 401；归档里 lh-004 的封面可能本就缺图；
  // 首次直达 /admin/ 时 CloudBase 测试域名中间页返回的 404（已被自动点过）
  const known = (x) =>
    /favicon/i.test(x) ||
    /^401 /.test(x) ||
    /\/lh-004\//.test(x) ||
    /admin\/$/.test(x) ||
    /googleapis|gstatic/.test(x);
  const unexpected = badResponses.filter((x) => !known(x));
  check('无非预期的错误响应', unexpected.length === 0, unexpected.join(' | '));

  const realFails = failedReqs.filter((u) => !/favicon/.test(u));
  check('无失败请求', realFails.length === 0, realFails.join(' | '));

  const realErrors = consoleErrors.filter((e) => !/favicon|net::ERR_ABORTED/.test(e));
  console.log('      控制台 error 消息数：' + realErrors.length + '（含预期内的 401 与缺图 404）');
  check('页面无脚本级异常', !realErrors.some((e) => /Uncaught|TypeError|ReferenceError|is not a function/.test(e)),
    realErrors.join(' | '));

  await browser.close();

  console.log('\n' + '='.repeat(58));
  console.log(`通过 ${PASS.length} / ${PASS.length + FAIL.length}`);
  if (FAIL.length) { console.log('失败项：' + FAIL.join(', ')); process.exit(1); }
  console.log('全部通过 ✅');
})().catch(async (err) => {
  console.error('\n✗ 测试异常中断：', err && err.stack ? err.stack : err);
  process.exit(1);
});
