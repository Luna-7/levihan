/**
 * 注册流程「密码在答题后丢失」回归测试。
 *
 * 背景：注册分三步 —— ① 填昵称+密码 → ② 答题验证 → ③ 凭票据+密码完成注册。
 * 早期实现里第 ① 步切到答题页时调用了 switchView('quiz')，而 switchView 会
 * clearSecrets() 把密码清空；于是第 ③ 步 post 出去的是空密码，服务端报
 * 「密码需要 6–64 位」。用户明明填了很长的密码，却卡在这一步。
 *
 * 另外：浏览器密码管理器 / iCloud 钥匙串的自动填充不一定触发 React 的 onChange，
 * 只看 React state 同样会拿到空串。所以第 ① 步必须从表单 DOM 读值，且第 ②→③
 * 之间的密码要靠 ref 保险箱保住，不能被任何视图切换清空。
 *
 * 这里钉住三件事，免得改动把它复辟回去：
 *   1) 切到答题页用 setView('quiz') 而不是 switchView('quiz')；
 *   2) confirmRegister 用 pendingRegister 保险箱里的密码（saved?.password || password）；
 *   3) 提示 toast 的层级必须高于用户弹窗（否则错误提示被遮罩压到后面，看不清）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'components', 'UserEntry.tsx');
const APP = path.join(ROOT, 'src', 'App.tsx');

const entrySrc = fs.readFileSync(ENTRY, 'utf8');
const appSrc = fs.readFileSync(APP, 'utf8');

test('切到答题页不得清空密码（用 setView 而非 switchView）', () => {
  // 必须存在 setView('quiz') 这条过渡
  assert.match(entrySrc, /setView\('quiz'\)/, "缺少 setView('quiz') —— 切到答题页必须保留密码");
  // 不能再有 switchView('quiz')（那会触发 clearSecrets）
  const switchQuiz = /switchView\('quiz'\)/.test(entrySrc);
  assert.equal(switchQuiz, false, "切到答题页不得用 switchView('quiz')，否则密码被 clearSecrets 清空");
  // 保险箱 ref 必须存在，且 confirmRegister 优先用它
  assert.match(entrySrc, /useRef<\{[^}]*nickname[^}]*password[^}]*\}[^>]*>\(\s*null\s*\)/, '缺少 pendingRegister 保险箱 ref');
  assert.match(entrySrc, /saved\?\.password\s*\|\|\s*password/, 'confirmRegister 必须优先用保险箱里的密码');
});

test('第 ① 步从表单 DOM 读值（兼容浏览器自动填充）', () => {
  // 统一从 FormData 读，FormData 取的是输入框真实当前值（自动填充也算）
  assert.match(entrySrc, /new FormData\(form\)\.get\(name\)/, '缺少从 FormData 读取表单值的 helper');
  assert.match(entrySrc, /readField\(form, 'nickname'/, 'startRegister 应从表单读 nickname');
  assert.match(entrySrc, /readField\(form, 'password'/, 'startRegister 应从表单读 password');
  // 三个输入都要有 name 属性，FormData 才能取到
  assert.match(entrySrc, /<input\s+name="nickname"/, '昵称输入框缺少 name="nickname"');
  assert.match(entrySrc, /name="password"[^>]*type="password"/, '密码输入框缺少 name="password"');
  assert.match(entrySrc, /name="confirmPassword"/, '确认密码输入框缺少 name');
});

test('错误提示 toast 必须盖在用户弹窗之上', () => {
  // UserEntry 弹窗 z-[100]
  assert.match(entrySrc, /fixed inset-0 z-\[100\]/, '用户弹窗层级约定为 z-[100]');
  // App.tsx 的 toast 必须高于 100
  const m = appSrc.match(/z-\[(\d+)\][^>]*rounded-full/);
  assert.ok(m, 'App.tsx 的 toast 没有定位层级 z-[N]');
  const toastZ = Number(m[1]);
  assert.ok(toastZ > 100, `提示 toast 的层级 z-[${toastZ}] 必须高于用户弹窗 z-[100]，否则错误提示被压到遮罩后面`);
});
