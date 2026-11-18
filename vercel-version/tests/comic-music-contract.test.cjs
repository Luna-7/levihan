const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ADMIN = read('public/admin/index.html');
const PLAYER = read('src/components/ComicMusicPlayer.tsx');
const API = read('api/admin-content.ts');
const CLOUDBASE = read('cloudbase/functions/admin-upload/index.js');

function getFunction(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `缺少 ${name} 实现`);
  return source.slice(start, end);
}

test('管理台只接收 MP3 / M4A，并限制 50 MB', () => {
  const extensionSource = getFunction(ADMIN, 'musicExtension', 'uploadBookMusic');
  const musicExtension = vm.runInNewContext(`${extensionSource}\nmusicExtension`);

  assert.equal(musicExtension({ name: 'theme.MP3' }), 'mp3');
  assert.equal(musicExtension({ name: 'theme.m4a' }), 'm4a');
  assert.equal(musicExtension({ name: 'theme.ogg' }), '');
  assert.match(ADMIN, /pendingMusicFile\.size > 50 \* 1024 \* 1024/);
});

test('上传成功后保存安全文件名和原始曲名', async () => {
  const extensionSource = getFunction(ADMIN, 'musicExtension', 'uploadBookMusic');
  const uploadSource = getFunction(ADMIN, 'uploadBookMusic', 'readForm');
  const uploads = [];
  const sandbox = {
    pendingMusicFile: { name: '夜行列车.MP3', size: 1024 },
    musicExtension: vm.runInNewContext(`${extensionSource}\nmusicExtension`),
    uploadToCos(...args) {
      uploads.push(args);
      return Promise.resolve({ ok: true });
    },
    $(id) { return { textContent: '', id, value: id === 'f-music-title' ? '夜行列车' : '' }; },
    Date: { now: () => 1234 },
    Math: { random: () => 0.5 },
  };
  const uploadBookMusic = vm.runInNewContext(`${uploadSource}\nuploadBookMusic`, sandbox);
  const form = { id: 'lh-123', bookFolder: '' };

  await uploadBookMusic(form);

  assert.equal(uploads.length, 1);
  assert.equal(uploads[0][0], 'lh-123/');
  assert.match(uploads[0][1], /^lh-123\/music-[A-Za-z0-9_-]+\.mp3$/);
  assert.equal(uploads[0][3], 'audio/mpeg');
  assert.equal(form.musicFile, uploads[0][1].slice('lh-123/'.length));
  assert.equal(form.musicTitle, '夜行列车');
});

test('Vercel 与 CloudBase 后端都只允许安全的漫画配乐文件名', () => {
  const expected = String.raw`/^music-[A-Za-z0-9_-]{1,64}\.(mp3|m4a)$/i`;
  assert.ok(API.includes(expected));
  assert.ok(CLOUDBASE.includes(expected));
  assert.match(API, /book\.category !== '漫画本'/);
  assert.match(CLOUDBASE, /book\.category !== '漫画本'/);
});

test('阅读器播放器不自动播放，只由用户点击切换播放与暂停', () => {
  const prepare = getFunction(PLAYER, 'prepareComicMusic', 'stopComicMusic');
  const toggle = getFunction(PLAYER, 'toggleComicMusic', 'formatTime');

  assert.doesNotMatch(prepare, /\.play\s*\(/);
  assert.match(toggle, /audio\.play\(\)/);
  assert.match(toggle, /audio\.pause\(\)/);
  assert.match(PLAYER, /onClick=\{toggleComicMusic\}/);
  assert.match(PLAYER, /aria-label=\{isPlaying \? '暂停配乐' : '播放配乐'\}/);
  assert.ok(fs.existsSync(path.join(ROOT, 'public/images/comic-turntable.jpg')));
});
