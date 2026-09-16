// 未来接入管理员后台时，只需将这里替换为活动 API 返回的数据。
const activities = [
  { day: '21', month: 'SEP', title: '兵团秋日补给站', detail: '一起领取秋日限定补给与纪念徽章', tag: '报名中' },
  { day: '28', month: 'SEP', title: '利韩同人放映夜', detail: '晚八点驻地集合，共享本月精选作品', tag: '新活动' },
  { day: '05', month: 'OCT', title: '第 104 期主题创作', detail: '本期关键词：归途、旧信与午后森林', tag: '征集中' }
];

const notices = [
  { title: '欢迎回到利韩兵团驻地', body: '活动、创作与心声都可以在这里找到归处。' },
  { title: '树洞投递规则更新', body: '请友善表达，不公开个人隐私；心声会被认真收好。' },
  { title: '塔塔开训练场开放', body: '先从下方进入游戏选择，再开启 30 秒沉浸训练。' }
];

const activityList = document.querySelector('#activity-list');
activityList.innerHTML = activities.map(item => `
  <article class="activity-card">
    <div class="activity-date"><strong>${item.day}</strong><span>${item.month}</span></div>
    <div><h3>${item.title}</h3><p>${item.detail}</p></div>
    <span class="activity-tag">${item.tag}</span>
  </article>`).join('');

const tickerTrack = document.querySelector('#ticker-track');
tickerTrack.innerHTML = notices.map(item => `<article class="notice-item"><strong>${item.title}</strong><p>${item.body}</p></article>`).join('');
let noticeIndex = 0;
function showNotice(index) {
  noticeIndex = (index + notices.length) % notices.length;
  tickerTrack.style.transform = `translateX(-${noticeIndex * 100}%)`;
  document.querySelector('#notice-index').textContent = `${String(noticeIndex + 1).padStart(2, '0')} / ${String(notices.length).padStart(2, '0')}`;
}
document.querySelector('.ticker-button.prev').addEventListener('click', () => showNotice(noticeIndex - 1));
document.querySelector('.ticker-button.next').addEventListener('click', () => showNotice(noticeIndex + 1));
let tickerTimer = setInterval(() => showNotice(noticeIndex + 1), 5200);
document.querySelector('.ticker').addEventListener('mouseenter', () => clearInterval(tickerTimer));
document.querySelector('.ticker').addEventListener('mouseleave', () => {
  clearInterval(tickerTimer);
  tickerTimer = setInterval(() => showNotice(noticeIndex + 1), 5200);
});

const panels = { games: document.querySelector('#games-panel'), treehole: document.querySelector('#treehole-panel') };
function togglePanel(name, forceOpen = false) {
  const panel = panels[name];
  const shouldOpen = forceOpen || panel.hidden;
  Object.entries(panels).forEach(([key, item]) => {
    item.hidden = key !== name || !shouldOpen;
    document.querySelectorAll(`[data-panel="${key}"]`).forEach(button => button.setAttribute('aria-expanded', String(key === name && shouldOpen)));
  });
  if (shouldOpen) requestAnimationFrame(() => panel.scrollIntoView({ behavior: 'smooth', block: 'center' }));
}
document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => togglePanel(button.dataset.panel)));
document.querySelectorAll('[data-dock-panel]').forEach(button => button.addEventListener('click', () => togglePanel(button.dataset.dockPanel, true)));
document.querySelectorAll('.panel-close').forEach(button => button.addEventListener('click', () => {
  const panel = button.closest('.drop-panel'); panel.hidden = true;
  document.querySelectorAll('[data-panel]').forEach(item => item.setAttribute('aria-expanded', 'false'));
}));

const moodInput = document.querySelector('#mood');
document.querySelectorAll('.mood-options button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.mood-options button').forEach(item => item.classList.remove('selected'));
  button.classList.add('selected'); moodInput.value = button.dataset.mood;
}));
const messageInput = document.querySelector('#message');
messageInput.addEventListener('input', () => document.querySelector('#char-count').textContent = `${messageInput.value.length} / 500`);
document.querySelector('#treehole-form').addEventListener('submit', event => {
  event.preventDefault();
  event.currentTarget.hidden = true;
  document.querySelector('#letter-success').hidden = false;
  showToast('心声已留在树洞里');
});

let soundOn = true;
document.querySelector('.sound-toggle').addEventListener('click', event => {
  soundOn = !soundOn;
  event.currentTarget.setAttribute('aria-pressed', String(soundOn));
  event.currentTarget.setAttribute('aria-label', soundOn ? '关闭背景环境音' : '开启背景环境音');
  document.querySelector('.sound-state').textContent = soundOn ? '♪' : '×';
  showToast(soundOn ? '环境音已开启' : '环境音已关闭');
});

const game = document.querySelector('#immersive-game');
const target = document.querySelector('#game-target');
let score = 0, remaining = 30, gameInterval;
function moveTarget() {
  const pad = Math.max(80, Math.min(innerWidth, innerHeight) * .12);
  const size = target.getBoundingClientRect().width || 96;
  target.style.left = `${pad + Math.random() * Math.max(20, innerWidth - pad * 2 - size)}px`;
  target.style.top = `${pad + Math.random() * Math.max(20, innerHeight - pad * 2 - size)}px`;
}
function startGame() {
  clearInterval(gameInterval); score = 0; remaining = 30;
  document.querySelector('#score').textContent = score;
  document.querySelector('#timer').textContent = remaining;
  document.querySelector('#game-finish').hidden = true; target.hidden = false; game.hidden = false;
  moveTarget(); document.body.style.overflow = 'hidden';
  gameInterval = setInterval(() => {
    remaining -= 1; document.querySelector('#timer').textContent = remaining;
    if (remaining <= 0) finishGame();
  }, 1000);
}
function finishGame() {
  clearInterval(gameInterval); target.hidden = true;
  document.querySelector('#final-score').textContent = score;
  document.querySelector('#game-finish').hidden = false;
}
function exitGame() { clearInterval(gameInterval); game.hidden = true; document.body.style.overflow = ''; }
document.querySelector('#start-tatakae').addEventListener('click', startGame);
document.querySelector('#replay-game').addEventListener('click', startGame);
document.querySelector('#exit-game').addEventListener('click', exitGame);
target.addEventListener('click', () => { score += 10; document.querySelector('#score').textContent = score; moveTarget(); });
window.addEventListener('resize', () => { if (!game.hidden && !target.hidden) moveTarget(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !game.hidden) exitGame(); });

let toastTimer;
function showToast(message) {
  const toast = document.querySelector('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}
