const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

// 被加载的这几个云函数会读 CUSTOM_LOGIN_CREDENTIALS / CLOUDBASE_APIKEY，缺了就直接返回 503。
// 而在 vercel-version/ 下裸跑 `npm run test` 时，cloudbase/.env 并不会自动进环境，
// 于是会得到 2 条与代码无关的假失败（曾误判成回归）。这里兜一道：
// 文件在就读，不在就静默跳过（CI 里自行注入环境变量即可）。
try {
  require('dotenv').config({ path: path.join(projectRoot, 'cloudbase', '.env'), quiet: true });
} catch { /* dotenv 缺失时不影响其余测试 */ }

function loadFunction(relativePath, app) {
  const filename = path.join(projectRoot, relativePath);
  delete require.cache[require.resolve(filename)];
  const originalLoad = Module._load;
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === '@cloudbase/node-sdk') {
      return { SYMBOL_CURRENT_ENV: 'test', init: () => app };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(filename).main;
  } finally {
    Module._load = originalLoad;
  }
}

function httpEvent(body, origin = 'https://levihan.asia') {
  return { httpMethod: 'POST', headers: { origin }, body: JSON.stringify(body) };
}

function bodyOf(response) {
  return JSON.parse(response.body);
}

function passwordHash(password, salt = '0123456789abcdef0123456789abcdef') {
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

test('registration validates nickname and password before touching CloudBase', { concurrency: false }, async () => {
  const main = loadFunction('cloudbase/functions/registerWithPassword/index.js', {
    rdb() { throw new Error('database should not be called'); },
  });
  const response = await main(httpEvent({ nickname: 'x', password: 'short' }));
  assert.equal(response.statusCode, 400);
  assert.equal(bodyOf(response).message, '昵称需要 2–20 个字');
});

test('registration stores a scrypt hash and returns a custom ticket', { concurrency: false }, async () => {
  let inserted;
  const db = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        limit: async () => ({ data: [] }),
        insert: async (row) => { inserted = row; return { data: [row] }; },
      };
    },
  };
  const main = loadFunction('cloudbase/functions/registerWithPassword/index.js', {
    rdb: () => db,
    auth: () => ({ createTicket: (uid) => `ticket:${uid}` }),
  });
  const response = await main(httpEvent({ nickname: '韩吉', password: 'secret8' }));
  const result = bodyOf(response);
  assert.equal(response.statusCode, 200);
  assert.equal(result.ok, true);
  assert.match(result.ticket, /^ticket:lh_[a-f0-9]{20}$/);
  assert.equal(inserted.nickname, '韩吉');
  assert.notEqual(inserted.password_hash, 'secret8');
  assert.match(inserted.password_hash, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
});

test('login accepts the matching password and rejects a wrong password uniformly', { concurrency: false }, async () => {
  const credential = {
    uid: 'lh_test', nickname: 'Levi', role: 'user', password_hash: passwordHash('correct-horse'),
  };
  const app = {
    rdb: () => ({
      from: () => ({
        select() { return this; },
        eq() { return this; },
        limit: async () => ({ data: [credential] }),
      }),
    }),
    auth: () => ({ createTicket: () => 'login-ticket' }),
  };
  const main = loadFunction('cloudbase/functions/loginWithPassword/index.js', app);

  const accepted = await main(httpEvent({ nickname: 'LEVI', password: 'correct-horse' }));
  assert.equal(accepted.statusCode, 200);
  assert.equal(bodyOf(accepted).ticket, 'login-ticket');

  const rejected = await main(httpEvent({ nickname: 'Levi', password: 'wrong-password' }));
  assert.equal(rejected.statusCode, 401);
  assert.equal(bodyOf(rejected).message, '昵称或密码不正确');
});

test('untrusted origins are not reflected in CORS headers', { concurrency: false }, async () => {
  const main = loadFunction('cloudbase/functions/loginWithPassword/index.js', {});
  const response = await main(httpEvent({ nickname: 'x', password: 'x' }, 'https://attacker.example'));
  assert.equal(response.headers['Access-Control-Allow-Origin'], 'https://levihan.asia');
});
