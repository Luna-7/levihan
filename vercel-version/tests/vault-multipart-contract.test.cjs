/**
 * ============================================================================
 * vault-multipart-contract.test.cjs — 密文分片上传的端到端契约
 * ----------------------------------------------------------------------------
 * 两张契约必须同时成立，缺一个都传不上去：
 *
 *   ① 云函数侧（静态契约）：vaultUpload / vaultInit / vaultPart /
 *      vaultComplete / vaultAbort 五个 action 存在、只放行 comic_vault/ 前缀、
 *      必须是 token 保护的、两个入口的鉴权白名单保持同步。
 *      本地没有 node_modules，require 不进 cos-nodejs-sdk-v5，所以这里做**静态**校验
 *      （与 admin-pdf-expand-contract.test.cjs 同一套路），而不是真跑 SDK。
 *
 *   ② 客户端侧（真跑）：分片按密文文本切分、原样拼接即完整密文、
 *      分片号从 1 连续、失败必须 abort 清理。用 stub fetch 驱动真实代码路径。
 *
 * 运行：node --test tests/vault-multipart-contract.test.cjs
 * ============================================================================
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_PATH = path.join(__dirname, '..', 'public', 'admin', 'secure-upload.js');
const FN_PATH = path.join(__dirname, '..', 'cloudbase', 'functions', 'admin-upload', 'index.js');

const fnSrc = fs.readFileSync(FN_PATH, 'utf8');
const clientSrc = fs.readFileSync(CLIENT_PATH, 'utf8');

vm.runInThisContext(clientSrc, { filename: CLIENT_PATH });
const vault = globalThis.LeVihanVault;
assert.ok(vault && typeof vault.uploadCipher === 'function', 'secure-upload.js 未导出 LeVihanVault');

/* ==========================================================================
 * ① 云函数静态契约
 * ======================================================================== */

const VAULT_ACTIONS = ['vaultUpload', 'vaultInit', 'vaultPart', 'vaultComplete', 'vaultAbort'];

test('云函数已实现五个 vault action', () => {
  VAULT_ACTIONS.forEach((a) => {
    assert.ok(
      fnSrc.includes(`case '${a}':`),
      '缺少 action: ' + a + ' —— 前端会拿到"未知操作"而整条加密上传失败'
    );
  });
});

test('vault 系列必须受 token 保护：不能进公开白名单', () => {
  // 鉴权收口在 PUBLIC_ACTIONS（Set）：不在公开集合里的 action 一律先过 verifyToken。
  // vault 写桶绝不能出现在 PUBLIC_ACTIONS 里。
  const pub = fnSrc.match(/const PUBLIC_ACTIONS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(pub, '未找到 PUBLIC_ACTIONS 定义');
  VAULT_ACTIONS.forEach((a) => {
    assert.ok(!pub[1].includes(`'${a}'`), `PUBLIC_ACTIONS 不该放行匿名 ${a}`);
  });
  const gates = [...fnSrc.matchAll(/!PUBLIC_ACTIONS\.has\(action\)/g)].length;
  assert.ok(gates >= 2, '应有 HTTP 与 SCF 两个入口各自的鉴权判断');
});

test('两个入口的鉴权判断必须完全一致，避免一处改了另一处漏', () => {
  const gates = [...fnSrc.matchAll(/else if \(!PUBLIC_ACTIONS\.has\(action\) && !verifyToken\(token\)\)/g)].map((m) => m[0]);
  assert.ok(gates.length >= 2, '应有 HTTP 与 SCF 两个入口');
  assert.equal(new Set(gates).size, 1, '两个入口的鉴权写法已分叉：\n' + gates.join('\n---\n'));
});

test('密文 key 正则：只收 comic_vault/<标识>_secure.txt，堵住穿越与嵌套', () => {
  const m = fnSrc.match(/const VAULT_KEY_RE = (\/[^\n]*?\/);/);
  assert.ok(m, '未找到 VAULT_KEY_RE');
  const re = vm.runInNewContext('(' + m[1] + ')');

  // 前端 buildVaultKey 的真实产物，必须放行
  assert.ok(re.test('comic_vault/lh-123_secure.txt'), 'bookId 形式应放行');
  assert.ok(re.test('comic_vault/1758252800000_secure.txt'), '时间戳形式应放行');
  assert.ok(re.test('comic_vault/doc_a-1_secure.txt'));

  // 越权与穿越一律拒绝
  [
    ['comic_vault/../secret_secure.txt', '路径穿越'],
    ['comic_vault/a/b_secure.txt', '嵌套目录'],
    ['other/lh-1_secure.txt', '自选前缀'],
    ['comic_vault/lh-1.txt', '后缀不符'],
    ['comic_vault/lh-1_secure.txt.bak', '后缀被续写'],
    ['comic_vault/lh-1_secure.TXT', '后缀大小写不符'],
    ['comic_vault/_secure.txt', '标识为空'],
    ['comic_vault/' + 'a'.repeat(41) + '_secure.txt', '标识超长'],
  ].forEach(([key, why]) => {
    assert.ok(!re.test(key), why + ' 应被拒绝：' + key);
  });
});

test('云函数已 promisify 分片四件套（Node 端 SDK 方法名）', () => {
  // 方法名务必与 **Node 端** cos-nodejs-sdk-v5 对齐：multipartInit / multipartUpload /
  // multipartComplete / multipartAbort。浏览器端 cos-js-sdk-v5 才叫 createMultipartUpload /
  // uploadPart / completeMultipartUpload / abortMultipartUpload —— 两边命名不同，
  // 曾按浏览器那套写，cos.createMultipartUpload 是 undefined，顶层 .bind() 直接抛
  // TypeError，模块加载失败、进程 145 退出，表现为整个函数 FUNCTIONS_INVOCATION_FAILED。
  ['multipartInit', 'multipartUpload', 'multipartComplete', 'multipartAbort'].forEach((m) => {
    assert.match(
      fnSrc,
      new RegExp('promisify\\(cos\\.' + m + '\\.bind\\(cos\\)\\)'),
      '缺少 ' + m + ' 的 promisify —— 忘了它会在 await 处拿到 undefined'
    );
  });
});

test('分片号约束与 COS 一致：1~10000 的整数', () => {
  assert.match(fnSrc, /const MAX_PART_NUMBER = 10000;/);
  assert.match(fnSrc, /n < 1 \|\| n > MAX_PART_NUMBER/, 'assertPartNumber 必须双侧卡边界');
});

test('合计分片时必须按序且从 1 连续，否则会合并出空洞对象', () => {
  const body = fnSrc.slice(fnSrc.indexOf("case 'vaultComplete'"));
  assert.match(body, /\.sort\(\(a, b\) => a\.PartNumber - b\.PartNumber\)/, '必须按分片号排序');
  assert.match(body, /PartNumber !== i \+ 1/, '必须校验从 1 连续');
  assert.match(body, /每个分片都必须带 etag/);
});

test('中止分片必须真的调 multipartAbort，否则残片永久占存储', () => {
  // Node 端 SDK 的方法名是 multipartAbort（浏览器端才叫 abortMultipartUpload）
  const body = fnSrc.slice(fnSrc.indexOf("case 'vaultAbort'"));
  assert.match(body.slice(0, 600), /multipartAbort\(\{/, 'vaultAbort 没有调用 multipartAbort');
});

test('两条通道的缓存策略与 Content-Type 必须逐字一致', () => {
  // 直传与中转只要有一条写得不同，同一个 key 就会因通道不同而行为不同，极难排查
  const cloudCache = fnSrc.match(/const VAULT_CACHE_CONTROL = '([^']+)'/);
  const cloudType = fnSrc.match(/const VAULT_CIPHER_TYPE = '([^']+)'/);
  assert.ok(cloudCache && cloudType, '云函数缺少缓存或类型常量');

  assert.equal(cloudCache[1], vault.CONFIG.CacheControl, 'Cache-Control 与前端 CONFIG.CacheControl 不一致');
  assert.equal(cloudType[1], vault.CONFIG.CIPHER_CONTENT_TYPE, 'Content-Type 与前端不一致');
});

test('前端分片大小必须 ≤ 云函数单次上限，否则每个分片都会被 413 挡回', () => {
  // 云函数的单次上限写死在 MAX_BYTES 里，前端不能假设它更大
  const m = fnSrc.match(/const MAX_BYTES = (\d+) \* 1024 \* 1024;/);
  assert.ok(m, '未找到 MAX_BYTES');
  const cloudMax = Number(m[1]) * 1024 * 1024;

  vault.configure({ VAULT_PART_BYTES: 16 * 1024 * 1024 }); // 故意配过头
  const clamped = vault.vaultPartSize();
  assert.ok(clamped <= cloudMax, 'vaultPartSize 必须自行夹到云函数上限内，实测 ' + clamped);
  vault.configure({ VAULT_PART_BYTES: 4 * 1024 * 1024 });
});

test('分片大小下界锁 1MB：COS 对非末片有硬性下限', () => {
  vault.configure({ VAULT_PART_BYTES: 1024 }); // 配得离谱地小
  assert.equal(vault.vaultPartSize(), 1024 * 1024, '低于 1MB 必须被抬到 1MB');
  vault.configure({ VAULT_PART_BYTES: 4 * 1024 * 1024 });
});

/* ==========================================================================
 * ② 客户端分片行为（stub fetch 驱动真实代码路径）
 * ======================================================================== */

let requests = [];
let responder = null;

globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  requests.push({ url, body, headers: init.headers });
  const data = responder ? responder(body, requests.length) : { ok: true };
  const status = data.status || 200;
  return { ok: status < 400, status: status, json: async () => data };
};

const KEY = 'comic_vault/lh-123_secure.txt';
/** > 4MB，强制走分片；9MB 恰好切 3 片（4MB + 4MB + 1MB） */
const CIPHER = 'A'.repeat(9 * 1024 * 1024);

test.beforeEach(() => {
  requests = [];
  responder = null;
  vault.configure({
    apiEndpoint: 'https://fn.example.test/admin-upload',
    getToken: () => 'tk-test',
    VAULT_PART_BYTES: 4 * 1024 * 1024,
    UPLOAD_MODE: 'proxy',
  });
});

test('分片上传：init → part ×N → complete 的顺序与字段', async () => {
  const progress = [];
  responder = (body) => {
    if (body.action === 'vaultInit') return { ok: true, key: body.key, uploadId: 'UP-1' };
    if (body.action === 'vaultPart') return { ok: true, partNumber: body.partNumber, etag: 'ETAG-' + body.partNumber };
    if (body.action === 'vaultComplete') return { ok: true, key: body.key, etag: 'FINAL' };
    return { ok: true };
  };

  const res = await vault.uploadCipherViaMultipart(CIPHER, KEY, (p) => progress.push(p));
  const actions = requests.map((r) => r.body.action);

  assert.equal(actions[0], 'vaultInit', '第一个请求必须是 init');
  assert.equal(actions[actions.length - 1], 'vaultComplete', '最后一个请求必须是 complete');
  assert.ok(actions.slice(1, -1).every((a) => a === 'vaultPart'), '中间全是 part');

  const parts = requests.filter((r) => r.body.action === 'vaultPart');
  assert.equal(parts.length, 3, '9MB / 4MB 应切 3 片');
  parts.forEach((r, i) => assert.equal(r.body.partNumber, i + 1, '分片号必须从 1 连续递增'));

  assert.equal(res.channel, 'proxy-multipart');
  assert.equal(res.parts, 3);
  assert.equal(res.key, KEY);
  assert.ok(res.url.includes(KEY), 'URL 应由 Key 反推');

  // 首片应报告 0 起点、末片应到 1
  assert.ok(progress.length >= 3);
  assert.equal(progress[progress.length - 1].ratio, 1, '结束后进度必须到 1');
});

test('分片内容原样拼接必须还原出完整密文（不做二次 base64 的关键保证）', async () => {
  responder = (body) => {
    if (body.action === 'vaultInit') return { ok: true, uploadId: 'UP-1' };
    if (body.action === 'vaultPart') return { ok: true, etag: 'E' + body.partNumber };
    return { ok: true };
  };

  await vault.uploadCipherViaMultipart(CIPHER, KEY);

  const rebuilt = requests
    .filter((r) => r.body.action === 'vaultPart')
    .map((r) => r.body.dataText)
    .join('');

  assert.equal(rebuilt.length, CIPHER.length, '拼接后长度必须与原文一致');
  assert.equal(rebuilt, CIPHER, '拼接后必须与原密文逐字相同 —— 密文本身已是文本，不该再套一层编码');

  const partSize = vault.vaultPartSize();
  requests
    .filter((r) => r.body.action === 'vaultPart')
    .forEach((r, i, arr) => {
      assert.ok(
        r.body.dataText.length <= partSize,
        '第 ' + (i + 1) + ' 片 ' + r.body.dataText.length + ' 超过单次上限 ' + partSize
      );
      if (i < arr.length - 1) {
        assert.equal(r.body.dataText.length, partSize, '非末片必须切满，否则分片数会虚高');
      }
    });
});

test('complete 的 parts 必须从 1 连续排列，并带上各片 ETag', async () => {
  responder = (body) => {
    if (body.action === 'vaultInit') return { ok: true, uploadId: 'UP-1' };
    if (body.action === 'vaultPart') return { ok: true, etag: 'ETAG-' + body.partNumber };
    return { ok: true };
  };

  await vault.uploadCipherViaMultipart(CIPHER, KEY);

  const complete = requests.find((r) => r.body.action === 'vaultComplete').body;
  assert.equal(complete.uploadId, 'UP-1');
  assert.equal(complete.parts.length, 3);
  complete.parts.forEach((p, i) => {
    assert.equal(p.partNumber, i + 1, 'parts 必须从 1 连续');
    assert.equal(p.etag, 'ETAG-' + (i + 1), '每片必须回传自己的 ETag');
  });
});

test('每个请求都带 token（vault 系列是受保护的 action）', async () => {
  responder = (body) => {
    if (body.action === 'vaultInit') return { ok: true, uploadId: 'UP-1' };
    if (body.action === 'vaultPart') return { ok: true, etag: 'E' + body.partNumber };
    return { ok: true };
  };
  await vault.uploadCipherViaMultipart(CIPHER, KEY);

  assert.ok(requests.length > 0);
  requests.forEach((r) => assert.equal(r.body.token, 'tk-test', '缺少 token 会被云函数判 401'));
});

test('某片失败必须 abort 清理，并把原始错误原样抛出', async () => {
  responder = (body) => {
    if (body.action === 'vaultInit') return { ok: true, uploadId: 'UP-42' };
    if (body.action === 'vaultPart' && body.partNumber === 2) {
      return { ok: false, error: '分片 2 上传后未返回 ETag' };
    }
    if (body.action === 'vaultPart') return { ok: true, etag: 'E' + body.partNumber };
    return { ok: true };
  };

  await assert.rejects(
    () => vault.uploadCipherViaMultipart(CIPHER, KEY),
    /未返回 ETag/,
    '必须把服务端的原始错误抛出来，不能换成泛泛的"上传失败"'
  );

  const abort = requests.find((r) => r.body.action === 'vaultAbort');
  assert.ok(abort, '失败后必须调用 vaultAbort，否则残片永久占存储');
  assert.equal(abort.body.uploadId, 'UP-42', 'abort 必须带上同一次任务的 uploadId');
  assert.equal(abort.body.key, KEY);

  assert.ok(
    !requests.some((r) => r.body.action === 'vaultComplete'),
    '失败后绝不能继续 complete'
  );
});

test('abort 自身失败也不能盖掉原始错误', async () => {
  responder = (body) => {
    if (body.action === 'vaultInit') return { ok: true, uploadId: 'UP-1' };
    if (body.action === 'vaultPart') return { ok: false, error: '原始错误：分片被拒' };
    if (body.action === 'vaultAbort') return { ok: false, error: '中止失败' };
    return { ok: true };
  };

  await assert.rejects(
    () => vault.uploadCipherViaMultipart(CIPHER, KEY),
    /原始错误：分片被拒/,
    '清理失败不该改变用户看到的根因'
  );
});

test('uploadCipher 按体积分流：小的单次、大的分片', async () => {
  responder = (body) => (body.action === 'vaultInit' ? { ok: true, uploadId: 'UP-1' } : { ok: true, etag: 'E' });

  // 小密文 → 只发一个 vaultUpload
  const small = await vault.uploadCipher('A'.repeat(1000), null, KEY);
  assert.equal(small.channel, 'proxy');
  assert.deepEqual(requests.map((r) => r.body.action), ['vaultUpload']);

  requests = [];
  // 大密文 → 走分片
  const big = await vault.uploadCipher(CIPHER, null, KEY);
  assert.equal(big.channel, 'proxy-multipart');
  assert.equal(requests[0].body.action, 'vaultInit');
});

test('单次上传的字段名是 dataText，且不再传 contentType', async () => {
  responder = () => ({ ok: true, key: KEY, etag: 'E1' });
  await vault.uploadCipherViaProxy('CIPHER-TEXT', KEY);

  const body = requests[0].body;
  assert.equal(body.action, 'vaultUpload');
  assert.equal(body.dataText, 'CIPHER-TEXT', '字段名必须与云函数一致');
  assert.equal(body.dataBase64, undefined, '不该再叫 dataBase64 —— 这个值本身就是密文，不是"某对象的 base64"');
  assert.equal(body.contentType, undefined, 'ContentType 由服务端强制，客户端传了也不作数');
});

/* ==========================================================================
 * ③ 通道 A（浏览器直传）的进度语义
 *    回归：cos-js-sdk-v5 的 onProgress 里 percent 是 0~1 比例
 *    （源码 Math.floor(loaded/total*100)/100），不是 0~100 的百分数。
 *    曾经被当百分数除以 100，导致直传全程进度条停在 0%、文案停在「上传中/0%/1%」。
 * ======================================================================== */

test('直传进度按 0~1 比例换算：ratio 直通、文案显示真实百分比', async () => {
  const events = [
    { loaded: 0, total: 1000, percent: 0 },      // SDK 起步：percent 为 0（旧代码误判成「无进度」显示「上传中」）
    { loaded: 370, total: 1000, percent: 0.37 }, // SDK 中段：旧代码会显示 0%、进度条 0%
    { loaded: 1000, total: 1000, percent: 1 },   // SDK 收尾：旧代码只会显示 1%，永远到不了 100%
  ];
  class FakeCOS {
    constructor(options) { this.options = options; }  // 像 SDK 一样持有 getAuthorization
    putObject(params, cb) {
      // 像 SDK 一样走回调式鉴权：调用 getAuthorization(options, cb) 并等待 cb ——
      // 如果实现错写成 return Promise，这里永远等不到 callback，测试会超时失败
      this.options.getAuthorization({}, (auth) => {
        assert.ok(auth && auth.TmpSecretId === 'tmp-id', 'SDK 必须通过 callback 拿到凭证');
        events.forEach((e) => params.onProgress(e));
        cb(null, { ETag: '"fake-etag"' });
      });
    }
  }
  globalThis.COS = FakeCOS;
  vault.configure({ UPLOAD_MODE: 'sdk' });
  responder = (body) => (body.action === 'cosCredential'
    ? { ok: true, credentials: { tmpSecretId: 'tmp-id', tmpSecretKey: 'tmp-key', sessionToken: 'tok', startTime: Math.floor(Date.now() / 1000), expiredTime: Math.floor(Date.now() / 1000) + 1800 } }
    : { ok: true });
  const seen = [];
  try {
    const res = await vault.uploadCipher(
      'aGVsbG8=', vault.wrapBase64AsTextBlob('aGVsbG8='), KEY, (info) => seen.push(info)
    );
    assert.equal(res.channel, 'sdk');
    assert.deepEqual(seen.map((i) => i.ratio), [0, 0, 0.37, 1], 'ratio 必须与 SDK percent（0~1）直通');
    assert.deepEqual(
      seen.map((i) => i.text),
      ['开始直传 COS…', '直传 COS：0%', '直传 COS：37%', '直传 COS：100%'],
      '文案必须显示换算后的真实百分比'
    );
    assert.ok(!seen.some((i) => i.text === '直传 COS：上传中' || i.text === '直传 COS：1%'), '不允许再出现旧 bug 的文案');
  } finally {
    delete globalThis.COS;
    vault.configure({ UPLOAD_MODE: 'auto' });
  }
});

test('getAuthorization 必须是回调风格：SDK 1.8.x 会忽略返回的 Promise', () => {
  // 回归：曾写成 `return fetchCosCredential().then(...)` —— SDK 只把内部回调作为第二个
  // 参数传入并等待它被调用，返回值被完全忽略。putObject 因此无限挂起（鉴权失败的
  // rejection 无人接住，不报错、不降级），界面表现为进度永远停在「直传 COS：0%」。
  const body = clientSrc.slice(clientSrc.indexOf('function getCosInstance'), clientSrc.indexOf('function putCipherToCos'));
  assert.match(body, /getAuthorization: function \(options, callback\)/,
    'getAuthorization 必须接收 (options, callback)，返回 Promise 会被 SDK 忽略');
  assert.match(body, /callback\(\{[\s\S]*?TmpSecretId/,
    '凭证必须通过 callback 交还 SDK，而不是 return');
  assert.match(body, /\.catch\(function \(err\) \{\s*callback\(err\);\s*\}\)/,
    '鉴权失败必须 callback(err)，否则请求挂死且永远触发不了中转降级');
});

/* ==========================================================================
 * ④ 瞬时故障重试：中转链路是十几次 4MB POST 的串行长链路，
 *    实测出现过 HTTP 504（前两片正常、第三片网关超时）→ 一片失败就 abort 全部。
 *    COS 分片按 (uploadId, partNumber) 覆盖写，重传同一片是幂等的。
 * ======================================================================== */

test('分片对瞬时 5xx 自动重试：同一片幂等重传，整体不失败', async () => {
  let partCalls = 0;
  responder = (body) => {
    if (body.action === 'vaultInit') return { ok: true, key: body.key, uploadId: 'UP-R' };
    if (body.action === 'vaultPart') {
      partCalls += 1;
      if (partCalls === 2) return { ok: false, error: 'gateway timeout', status: 504 }; // 第 2 片首次请求 504
      return { ok: true, partNumber: body.partNumber, etag: 'ETAG-' + body.partNumber };
    }
    if (body.action === 'vaultComplete') return { ok: true, key: body.key, etag: 'FINAL' };
    return { ok: true };
  };

  const res = await vault.uploadCipherViaMultipart(CIPHER, KEY);
  assert.equal(res.channel, 'proxy-multipart');
  assert.equal(res.parts, 3);

  const partRequests = requests.filter((r) => r.body.action === 'vaultPart');
  assert.equal(partRequests.length, 4, '3 片 + 1 次重传');
  assert.equal(partRequests[2].body.partNumber, 2, '重传的是 504 的那一片（partNumber 覆盖写，幂等）');
  assert.equal(partRequests[2].body.dataText, partRequests[1].body.dataText, '重传内容必须与原片逐字节一致');
});

test('确定性失败不重试：4xx 直接走 abort 清理', async () => {
  responder = (body) => {
    if (body.action === 'vaultInit') return { ok: true, key: body.key, uploadId: 'UP-B' };
    if (body.action === 'vaultPart') {
      return body.partNumber === 2
        ? { ok: false, error: 'bad request', status: 400 }
        : { ok: true, partNumber: body.partNumber, etag: 'E-' + body.partNumber };
    }
    return { ok: true };
  };

  await assert.rejects(
    vault.uploadCipherViaMultipart(CIPHER, KEY),
    /bad request/,
    '400 这类确定性失败必须原样抛出'
  );
  const partRequests = requests.filter((r) => r.body.action === 'vaultPart');
  assert.equal(partRequests.length, 2, '400 不允许重试（part1 一次 + part2 一次）');
  assert.ok(
    requests.some((r) => r.body.action === 'vaultAbort'),
    '最终失败仍必须 abort 清理残片'
  );
});
