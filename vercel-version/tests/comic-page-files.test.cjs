const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const COS_SOURCE = fs.readFileSync(path.join(ROOT, 'src/services/cosClient.ts'), 'utf8');
const ADMIN_SOURCE = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
const LAZY_PAGE_SOURCE = fs.readFileSync(path.join(ROOT, 'src/components/LazyComicPage.tsx'), 'utf8');

function loadCosMethod(name) {
  const signature = `public ${name}(`;
  const start = COS_SOURCE.indexOf(signature);
  const end = COS_SOURCE.indexOf('\n  /**', start);
  assert.ok(start >= 0 && end > start, `COSService 缺少 ${name}()`);
  const method = COS_SOURCE.slice(start, end)
    .replace(`public ${name}`, name)
    .replace(/\(book: DoujinBookItem, pageIndex: number\): string(?:\[\])? \{/, '(book, pageIndex) {');
  return vm.runInNewContext(`({${method}}).${name}`, {
    COMIC_PAGE_EXTENSIONS: ['webp', 'jpg', 'jpeg', 'png', 'gif', 'avif'],
  });
}

function loadAdminFunction(name, nextMarker) {
  const start = ADMIN_SOURCE.indexOf(`function ${name}(`);
  const end = ADMIN_SOURCE.indexOf(nextMarker, start);
  assert.ok(start >= 0 && end > start, `管理台缺少 ${name}()`);
  return vm.runInNewContext(`(${ADMIN_SOURCE.slice(start, end).trim()})`);
}

const getPageUrl = loadCosMethod('getPageUrl');
const getPageUrlCandidates = loadCosMethod('getPageUrlCandidates');
const cosStub = {
  getObjectUrl: (key) => key,
  getPageUrlCandidates(book, pageIndex) {
    return getPageUrlCandidates.call(this, book, pageIndex);
  },
};
const objectUrl = (book, pageIndex) => getPageUrl.call(cosStub, book, pageIndex);

test('更换独立封面不会改写旧本的第一页路径', () => {
  const book = {
    id: 'lh-180',
    pages: 3,
    pagePrefix: 'image',
    pagePadDigits: 2,
    coverFile: 'new-cover.png',
  };

  assert.equal(objectUrl(book, 1), 'lh-180/image01.webp');
});

test('沿用页面文件作为封面时保留原有扩展名优先级', () => {
  const candidates = Array.from(getPageUrlCandidates.call(cosStub, {
    id: 'lh-180',
    pagePrefix: 'image',
    pagePadDigits: 2,
    coverFile: 'image01.jpg',
  }, 1));

  assert.equal(candidates[0], 'lh-180/image01.jpg');
  assert.equal(candidates.length, 6);
});

test('旧本可按页尝试已支持的图片扩展名', () => {
  const candidates = Array.from(getPageUrlCandidates.call(cosStub, {
    id: 'lh-180',
    pagePrefix: 'image',
    pagePadDigits: 2,
    coverFile: 'new-cover.png',
  }, 2));

  assert.deepEqual(candidates, [
    'lh-180/image02.webp',
    'lh-180/image02.jpg',
    'lh-180/image02.jpeg',
    'lh-180/image02.png',
    'lh-180/image02.gif',
    'lh-180/image02.avif',
  ]);
});

test('逐页文件清单继续使用每页自己的扩展名', () => {
  const book = {
    id: 'lh-180',
    coverFile: 'new-cover.png',
    pageFiles: ['page01.jpg', 'page02.png', 'page03.webp'],
  };
  const getCandidatesForBook = (page) => Array.from(getPageUrlCandidates.call(cosStub, book, page));

  assert.deepEqual(getCandidatesForBook(1), ['lh-180/page01.jpg']);
  assert.deepEqual(getCandidatesForBook(2), ['lh-180/page02.png']);
  assert.deepEqual(getCandidatesForBook(3), ['lh-180/page03.webp']);
});

test('管理台编辑旧本时不把自定义封面当作第一页', () => {
  const bookPageCandidates = loadAdminFunction('bookPageCandidates', '\nfunction bookImageUrl');
  const pages = bookPageCandidates({
    pages: 2,
    pagePrefix: 'image',
    pagePadDigits: 2,
    coverFile: 'new-cover.png',
  });

  assert.equal(pages[0][0], 'image01.webp');
  assert.ok(!pages[0].includes('new-cover.png'));
  assert.ok(pages[1].includes('image02.jpg'));
});

test('阅读器在当前格式加载失败后会继续尝试其他格式', () => {
  assert.match(LAZY_PAGE_SOURCE, /srcCandidates\?: string\[\]/);
  assert.match(LAZY_PAGE_SOURCE, /candidateIndex \+ 1 < candidateUrls\.length/);
  assert.match(LAZY_PAGE_SOURCE, /src=\{activeSrc\}/);
});

test('窄屏漫画页不被固定最小高度撑出页间空白', () => {
  assert.doesNotMatch(LAZY_PAGE_SOURCE, /<div className="relative w-full min-h-\[240px\]/);
});
