import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';

process.env.COS_SECRET_ID = 'local-comment-test';
process.env.COS_SECRET_KEY = 'local-comment-test-secret';
const records = new Map();
const originalSend = S3Client.prototype.send;
S3Client.prototype.send = async function (command) {
  const { Key, Prefix, MaxKeys = 1000, ContinuationToken, Body } = command.input;
  switch (command.constructor.name) {
    case 'GetObjectCommand': {
      if (!records.has(Key)) throw Object.assign(new Error('not found'), { name: 'NoSuchKey' });
      const body = records.get(Key);
      return { Body: { transformToString: async () => body } };
    }
    case 'PutObjectCommand':
      records.set(Key, Buffer.from(Body).toString('utf8'));
      return {};
    case 'DeleteObjectCommand':
      records.delete(Key);
      return {};
    case 'ListObjectsV2Command': {
      const keys = [...records.keys()].filter((key) => key.startsWith(Prefix || '')).sort();
      const start = Number(ContinuationToken || 0);
      const page = keys.slice(start, start + MaxKeys);
      return { Contents: page.map((key) => ({ Key: key })), IsTruncated: start + page.length < keys.length, NextContinuationToken: String(start + page.length) };
    }
    default:
      throw new Error(`unexpected command ${command.constructor.name}`);
  }
};
const { default: handler } = await import('../api/admin-content.ts');

async function call(payload) {
  let data = '';
  const request = { method: 'POST', headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' }, body: payload };
  const response = { statusCode: 0, setHeader() {}, end(value) { data = value; } };
  await handler(request, response);
  return { status: response.statusCode, ...JSON.parse(data) };
}

const visitorId = 'preview-visitor-0123456789';
const visitorHash = createHmac('sha256', 'comic-comments-v1|local-comment-test-secret').update(`visitor:${visitorId}`).digest('hex');
const makeId = (timestamp, nonce) => `cc-${String(9_999_999_999_999 - timestamp).padStart(13, '0')}-${String(nonce).padStart(12, '0')}`;

function seedComments() {
  records.clear();
  records.set('archive.json', JSON.stringify([{ id: 'lh-001', category: '漫画本' }]));
  const base = 1_700_000_000_000;
  const ids = Array.from({ length: 105 }, (_, index) => makeId(base + index * 1000, index));
  ids.forEach((id, index) => {
    const parentId = index === 1 ? ids[0] : index === 104 ? ids[1] : undefined;
    const row = { id, bookId: 'lh-001', body: `评论 ${index}`, createdAt: new Date(base + index * 1000).toISOString(), visitorHash, ...(parentId ? { parentId } : {}) };
    records.set(`comic-comments/lh-001/${id}.json`, JSON.stringify(row));
  });
  return ids;
}

test('分页时补齐不在当前页的父评论，并能继续读取旧评论', async () => {
  const ids = seedComments();
  const first = await call({ action: 'comicCommentList', bookId: 'lh-001', visitorId });
  assert.equal(first.status, 200);
  assert.equal(first.count, 105);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);
  assert.equal(first.comments.find((item) => item.id === ids[104])?.parentId, ids[1]);
  assert.equal(first.comments.find((item) => item.id === ids[1])?.parentId, ids[0]);
  assert.ok(first.comments.some((item) => item.id === ids[0]));
  const second = await call({ action: 'comicCommentList', bookId: 'lh-001', visitorId, cursor: first.nextCursor });
  assert.equal(second.status, 200);
  assert.equal(second.hasMore, false);
  assert.ok(second.comments.some((item) => item.id === ids[0]));
});

test('允许回复已有回复，并保留被删除父评论的关联', async () => {
  const ids = seedComments();
  const posted = await call({ action: 'comicCommentSubmit', bookId: 'lh-001', body: '更深一层', parentId: ids[1], visitorId });
  assert.equal(posted.status, 200);
  assert.equal(posted.comment.parentId, ids[1]);
  const removed = await call({ action: 'comicCommentDeleteOwn', bookId: 'lh-001', commentId: ids[1], visitorId });
  assert.equal(removed.status, 200);
  const list = await call({ action: 'comicCommentList', bookId: 'lh-001', visitorId });
  const deletedParent = list.comments.find((item) => item.id === ids[1]);
  assert.equal(deletedParent?.deleted, true);
  assert.equal(deletedParent?.parentId, ids[0]);
  assert.equal(deletedParent?.body, '');
  assert.ok(list.comments.some((item) => item.id === posted.comment.id && item.parentId === ids[1]));
  assert.equal(list.count, 105);
  const counts = await call({ action: 'comicCommentCounts' });
  assert.equal(counts.counts['lh-001'], 105);
});

test('历史父评论缺失时保留回复并标记为不可用', async () => {
  const ids = seedComments();
  records.delete(`comic-comments/lh-001/${ids[1]}.json`);
  const list = await call({ action: 'comicCommentList', bookId: 'lh-001', visitorId });
  assert.equal(list.comments.find((item) => item.id === ids[1])?.unavailable, true);
  assert.ok(list.comments.some((item) => item.id === ids[104] && item.parentId === ids[1]));
});

test.after(() => { S3Client.prototype.send = originalSend; });
