const test = require('node:test');
const assert = require('node:assert/strict');

test('全局认证状态在登录、改名、暂时故障、失效和退出时保持一致', async () => {
  const memory = new Map();
  const oldWindow = global.window;
  const oldFetch = global.fetch;
  global.window = {
    localStorage: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, value),
      removeItem: (key) => memory.delete(key),
    },
  };
  let nickname = '旧昵称';
  let meStatus = 200;
  global.fetch = async (_url, options) => {
    const { action, nickname: requestedName } = JSON.parse(options.body);
    if (action === 'login') return { ok: true, status: 200, json: async () => ({ ok: true, token: 'session-a', profile: { uid: 'user-a', nickname } }) };
    if (action === 'update-nickname') {
      nickname = requestedName;
      return { ok: true, status: 200, json: async () => ({ ok: true, nickname }) };
    }
    if (action === 'me') return {
      ok: meStatus === 200, status: meStatus,
      json: async () => meStatus === 200 ? { ok: true, profile: { uid: 'user-a', nickname } } : { ok: false, message: 'temporary or expired' },
    };
    if (action === 'logout') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    throw new Error(`Unexpected auth action: ${action}`);
  };

  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  try {
    const { useAuthStore } = await vite.ssrLoadModule('/src/stores/authStore.ts');
    const store = useAuthStore;
    await store.getState().login('旧昵称', 'password');
    assert.equal(store.getState().profile?.nickname, '旧昵称');
    assert.equal(store.getState().hasSession, true);
    await store.getState().updateNickname('新昵称');
    assert.equal(store.getState().profile?.nickname, '新昵称');

    meStatus = 503;
    await store.getState().refreshProfile();
    assert.equal(store.getState().profile?.nickname, '新昵称', '瞬时故障不得踢出用户');

    meStatus = 401;
    await store.getState().refreshProfile();
    assert.equal(store.getState().profile, null);
    assert.equal(store.getState().hasSession, false);
    assert.equal(store.getState().isLoading, false);

    meStatus = 200;
    await store.getState().login('旧昵称', 'password');
    await store.getState().logout();
    assert.equal(store.getState().profile, null);
    assert.equal(memory.has('levihan.sessionToken.v1'), false);
  } finally {
    await vite.close();
    global.window = oldWindow;
    global.fetch = oldFetch;
  }
});
