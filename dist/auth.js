(() => {
  const config = window.LEVIHAN_CLOUDBASE || {};
  const configured = Boolean(config.env && window.cloudbase);
  const app = configured ? window.cloudbase.init({ env: config.env, region: config.region || 'ap-shanghai', ...(config.accessKey ? { accessKey: config.accessKey } : {}) }) : null;
  const auth = app?.auth();
  let currentUser = null;
  let profile = null;
  let validatedInvite = '';
  const $ = selector => document.querySelector(selector);
  const ui = () => window.LeviHanUI;

  async function call(name, data = {}) {
    if (!app) throw new Error('CloudBase 尚未连接');
    const response = await app.callFunction({ name, data });
    const result = response?.result || response;
    if (result?.ok === false) throw new Error(result.message || '操作失败');
    return result;
  }
  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value.$date || value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-CN');
  }
  function renderInvites(invites = []) {
    const list = $('#invite-list');
    if (!invites.length) { list.innerHTML = '<p>尚未生成邀请码</p>'; return; }
    list.innerHTML = invites.map(item => `<article><div><code>${item.code}</code><span class="invite-status ${item.status}">${({unused:'未使用',used:'已使用',expired:'已过期',revoked:'已撤销'})[item.status] || item.status}</span></div>${item.status === 'unused' ? `<button type="button" data-copy-code="${item.code}">复制</button>` : ''}<small>${item.usedByNickname ? `由 ${item.usedByNickname} 使用` : formatDate(item.createdAt)}</small></article>`).join('');
  }
  function setSession(user, data) {
    currentUser = user || null; profile = data || null;
    const loggedIn = Boolean(currentUser && profile);
    $('#guest-account-view').hidden = loggedIn;
    $('#member-account-view').hidden = !loggedIn;
    const maintenanceSeal = $('#maintenance-seal');
    if (maintenanceSeal) maintenanceSeal.hidden = loggedIn;
    $('#comment-guest-prompt').hidden = loggedIn;
    $('#comment-form').hidden = !loggedIn;
    $('#user-entry-name').textContent = loggedIn ? profile.nickname : '加入 / 登录';
    $('#user-title').textContent = loggedIn ? profile.nickname : '加入 LeviHan';
    if (loggedIn) {
      $('#member-nickname').textContent = profile.nickname;
      $('#member-created-at').textContent = formatDate(profile.createdAt);
      $('#member-inviter').textContent = profile.inviterNickname || '兵团管理员';
      $('#member-quota').textContent = profile.inviteQuota ?? 0;
      renderInvites(profile.invites || []);
    }
  }
  async function refreshSession() {
    if (!configured) { $('#cloudbase-notice').hidden = false; setSession(null, null); return; }
    try {
      const user = await auth.getCurrentUser();
      if (!user) return setSession(null, null);
      const account = await call('getUserAccount');
      setSession(user, account.profile);
    } catch (error) { setSession(null, null); ui()?.showToast(error.message); }
  }
  function showAccountTab(name) {
    document.querySelectorAll('[data-account-tab]').forEach(button => button.classList.toggle('active', button.dataset.accountTab === name));
    $('#login-panel').hidden = name !== 'login'; $('#register-panel').hidden = name !== 'register'; $('#apply-panel').hidden = name !== 'apply';
  }
  document.querySelectorAll('[data-account-tab]').forEach(button => button.addEventListener('click', () => showAccountTab(button.dataset.accountTab)));
  $('#login-panel').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      if (!auth) throw new Error('请先配置 CloudBase 环境');
      await auth.signInWithEmailAndPassword($('#login-email').value.trim(), $('#login-password').value);
      const pending = localStorage.getItem('levihan_pending_invite');
      if (pending) { await call('createUserProfile', JSON.parse(pending)); localStorage.removeItem('levihan_pending_invite'); }
      await refreshSession(); ui()?.showToast('欢迎回到利韩兵团');
    } catch (error) { ui()?.showToast(error.message); }
  });
  $('#invite-check-form').addEventListener('submit', async event => {
    event.preventDefault();
    try { const result = await call('validateRegistrationInvite', { code: $('#register-invite').value.trim().toUpperCase() }); validatedInvite = result.code; $('#invite-check-form').hidden = true; $('#register-form').hidden = false; }
    catch (error) { ui()?.showToast(error.message); }
  });
  $('#register-form').addEventListener('submit', async event => {
    event.preventDefault();
    const password = $('#register-password').value;
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return ui()?.showToast('密码必须同时包含字母和数字');
    try {
      if (!auth) throw new Error('请先配置 CloudBase 环境');
      const payload = { code: validatedInvite, nickname: $('#register-nickname').value.trim() };
      await call('validateRegistrationInvite', payload);
      localStorage.setItem('levihan_pending_invite', JSON.stringify(payload));
      await auth.signUpWithEmailAndPassword($('#register-email').value.trim(), password);
      ui()?.showToast('验证邮件已发送，激活后即可登录'); showAccountTab('login');
    } catch (error) { ui()?.showToast(error.message); }
  });
  $('#logout-button').addEventListener('click', async () => { try { await auth?.signOut(); setSession(null, null); ui()?.showToast('已退出登录'); } catch (error) { ui()?.showToast(error.message); } });
  $('#generate-invite').addEventListener('click', async () => { try { await call('generateInviteCode'); const account = await call('getUserAccount'); setSession(currentUser, account.profile); ui()?.showToast('邀请码已生成'); } catch (error) { ui()?.showToast(error.message); } });
  $('#invite-list').addEventListener('click', async event => { const button = event.target.closest('[data-copy-code]'); if (!button) return; await navigator.clipboard.writeText(button.dataset.copyCode); ui()?.showToast('邀请码已复制'); });
  $('#apply-invite-button').addEventListener('click', () => ui()?.showToast('申请通道即将开放'));
  $('#comment-guest-prompt').addEventListener('click', () => { ui()?.openPanel('user'); showAccountTab('login'); });
  document.querySelectorAll('[data-library]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-library]').forEach(item => item.classList.toggle('active', item === button)); $('#book-type').textContent = ({comic:'漫画本',novel:'小说本',illustration:'插画集'})[button.dataset.library]; }));
  $('#comment-form').addEventListener('submit', async event => { event.preventDefault(); try { const result = await call('submitComment', { content: $('#comment-content').value.trim(), contentType: document.querySelector('[data-library].active')?.dataset.library || 'comic', contentId: 'homepage' }); $('#comment-list').insertAdjacentHTML('beforeend', `<article><strong>${profile.nickname}</strong><p>${result.comment.content}</p></article>`); $('#comment-content').value=''; } catch (error) { ui()?.showToast(error.message); } });
  async function submitTreehole(content) {
    try {
      const result = await call('submitTreehole', { content });
      $('#treehole-form').hidden = true; document.querySelector('.success-message').hidden = false;
      $('#treehole-result').textContent = result.status === 'approved' ? '已直接发布。' : '游客投稿已进入管理员审核。';
    } catch (error) { ui()?.showToast(error.message); }
  }
  window.LeviHanAuth = { refreshSession, submitTreehole, get user(){ return currentUser; } };
  refreshSession();
})();
