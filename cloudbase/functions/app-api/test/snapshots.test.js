/* eslint-env node */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { buildCatalog, createSnapshotService, createSnapshotHttpService, createSnapshotTimerHandler } = require('../src/modules/snapshots/service');
const { createSnapshotRepository } = require('../src/modules/snapshots/repository');
const { registerSnapshotRoutes } = require('../src/modules/snapshots/routes');
const { createRouter } = require('../src/router');
const { ApiError } = require('../src/errors');

describe('public catalog snapshots', () => {
  it('is stable, versioned, hashed and strips restricted/private/internal fields', () => {
    const rows = [
      { id: 'private-id', slug: 'zeta', title: 'Z', summary: 'z', type: 'novel', rating: 'restricted', publishedAt: '2030-01-02T00:00:00.000Z', assets: [] },
      { id: 'internal-a', slug: 'beta', title: 'B', summary: 'b', type: 'comic', rating: 'general', publishedAt: '2030-01-02T00:00:00.000Z', chapters: [{ id: 'secret-2', title: '二', position: 2 }, { id: 'secret-1', title: '一', position: 1 }], assets: [{ kind: 'page', objectKey: 'media/works/beta/c2p1.webp', storageZone: 'public', accessLevel: 'public', pageNo: 1, chapterPosition: 2 }, { kind: 'page', objectKey: 'media/works/beta/c1p2.webp', storageZone: 'public', accessLevel: 'public', pageNo: 2, chapterPosition: 1 }, { kind: 'page', objectKey: 'private/key', storageZone: 'private', accessLevel: 'public', pageNo: 1, chapterPosition: 1 }] },
      { id: 'internal-b', slug: 'alpha', title: 'A', summary: 'a', type: 'novel', rating: 'mature', publishedAt: '2030-01-01T00:00:00.000Z', assets: [{ kind: 'body', objectKey: 'media/works/alpha/body.txt', storageZone: 'public', accessLevel: 'public', pageNo: null }] },
    ];
    const first = buildCatalog(rows, 7, '2030-01-03T00:00:00.000Z');
    const second = buildCatalog([...rows].reverse(), 7, '2030-01-03T00:00:00.000Z');
    expect(first).toEqual(second);
    expect(first.document).toEqual({ schemaVersion: 1, version: 7, generatedAt: '2030-01-03T00:00:00.000Z', works: [
      { slug: 'alpha', type: 'novel', title: 'A', summary: 'a', rating: 'mature', publishedAt: '2030-01-01T00:00:00.000Z', chapters: [], assets: [{ kind: 'body', path: 'media/works/alpha/body.txt' }] },
      { slug: 'beta', type: 'comic', title: 'B', summary: 'b', rating: 'general', publishedAt: '2030-01-02T00:00:00.000Z', chapters: [{ title: '一', position: 1 }, { title: '二', position: 2 }], assets: [{ kind: 'page', path: 'media/works/beta/c1p2.webp', pageNo: 2, chapterPosition: 1 }, { kind: 'page', path: 'media/works/beta/c2p1.webp', pageNo: 1, chapterPosition: 2 }] },
    ] });
    expect(first.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toMatch(/private-id|internal-a|private\/key|secret-1|secret-2/);
  });

  it('writes one immutable version then advances the PostgreSQL current pointer', async () => {
    const events = [];
    const repository = {
      beginSnapshot: vi.fn().mockResolvedValue({ jobId: 'job-1', version: 8, leaseToken: 'lease-1', generatedAt: '2030-01-03T00:00:00.000Z' }),
      listPublicCatalog: vi.fn().mockResolvedValue([]),
      prepareSnapshot: vi.fn(async () => events.push('prepare')),
      completeSnapshot: vi.fn(async () => events.push('complete')),
      failSnapshot: vi.fn(),
    };
    const objectStore = { putImmutable: vi.fn(async (key, bytes) => { events.push(key, bytes); return { bytes, checksum: (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'), existed: false }; }) };
    const service = createSnapshotService({ repository, objectStore, now: () => new Date('2030-01-03T00:00:00.000Z'), nonce: () => 'nonce' });
    const result = await service.rebuildCatalog({ actorId: 'admin', actorRole: 'admin', requestId: 'req' });
    expect(events.filter((item) => typeof item === 'string')).toEqual(['snapshots/public/catalog.v8.json', 'prepare', 'complete']);
    const uploaded = events.find(Buffer.isBuffer);
    expect((await import('node:crypto')).createHash('sha256').update(uploaded).digest('hex')).toBe(result.checksum);
    expect(repository.prepareSnapshot).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1', leaseToken: 'lease-1', version: 8, objectKey: 'snapshots/public/catalog.v8.json', checksum: result.checksum }));
    expect(repository.completeSnapshot).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1', leaseToken: 'lease-1', actorId: 'admin' }));
    expect(repository.completeSnapshot).toHaveBeenCalledTimes(1);
  });

  it('keeps the database pointer unchanged and marks failure when immutable creation fails', async () => {
    const repository = { beginSnapshot: vi.fn().mockResolvedValue({ jobId: 'job-2', version: 9, leaseToken: 'lease-2' }), listPublicCatalog: vi.fn().mockResolvedValue([]), prepareSnapshot: vi.fn(), completeSnapshot: vi.fn(), failSnapshot: vi.fn() };
    const objectStore = { putImmutable: vi.fn().mockRejectedValueOnce(new Error('COS unavailable')) };
    const service = createSnapshotService({ repository, objectStore, nonce: () => 'nonce' });
    await expect(service.rebuildCatalog({ actorId: 'admin', actorRole: 'admin', requestId: 'req' })).rejects.toThrow('COS unavailable');
    expect(objectStore.putImmutable).toHaveBeenCalledTimes(1);
    expect(repository.completeSnapshot).not.toHaveBeenCalled();
    expect(repository.failSnapshot).toHaveBeenCalledWith('job-2', 'lease-2', 'SNAPSHOT_DELIVERY_FAILED');
  });

  it('does not complete the database pointer when prepare fails', async () => {
    const events = [];
    const repository = {
      beginSnapshot: vi.fn().mockResolvedValue({ jobId: 'job-3', version: 10, leaseToken: 'lease-3' }), listPublicCatalog: vi.fn().mockResolvedValue([]),
      prepareSnapshot: vi.fn(async () => { events.push('prepare'); throw new Error('prepare failed'); }), completeSnapshot: vi.fn(async () => events.push('complete')),
      failSnapshot: vi.fn(async () => events.push('failed')),
    };
    const objectStore = { putImmutable: vi.fn(async (key, bytes) => { events.push(key); return { bytes, checksum: 'a'.repeat(64) }; }) };
    const service = createSnapshotService({ repository, objectStore, nonce: () => 'nonce' });
    await expect(service.rebuildCatalog({ actorId: 'admin', actorRole: 'admin', requestId: 'req' })).rejects.toThrow('prepare failed');
    expect(events).toEqual(['snapshots/public/catalog.v10.json', 'prepare', 'failed']);
  });

  it('resumes a prepared immutable version without rebuilding bytes', async () => {
    const repository = {
      beginSnapshot: vi.fn().mockResolvedValue({ jobId: 'job-old', version: 4, state: 'prepared', leaseToken: 'lease-old', objectKey: 'snapshots/public/catalog.v4.json', checksum: 'b'.repeat(64) }),
      listPublicCatalog: vi.fn(), prepareSnapshot: vi.fn(), authorizeManifest: vi.fn(), completeSnapshot: vi.fn(), failSnapshot: vi.fn(),
    };
    const objectStore = { putImmutable: vi.fn() };
    const service = createSnapshotService({ repository, objectStore });
    await expect(service.rebuildCatalog({ actorId: 'admin', actorRole: 'admin', requestId: 'req' })).resolves.toEqual({ version: 4, checksum: 'b'.repeat(64), objectKey: 'snapshots/public/catalog.v4.json' });
    expect(repository.listPublicCatalog).not.toHaveBeenCalled();
    expect(objectStore.putImmutable).not.toHaveBeenCalled();
    expect(repository.completeSnapshot).toHaveBeenCalled();
  });

  it('lets PostgreSQL reject an older prepared job without any mutable COS pointer', async () => {
    const repository = { beginSnapshot: vi.fn().mockResolvedValue({ jobId: 'job-v1', version: 1, state: 'prepared', leaseToken: 'lease-v1', objectKey: 'snapshots/public/catalog.v1.json', checksum: 'a'.repeat(64) }), completeSnapshot: vi.fn().mockRejectedValue(new ApiError(409, 'SNAPSHOT_CONFLICT', 'newer current')), failSnapshot: vi.fn() };
    const objectStore = { putImmutable: vi.fn() };
    const service = createSnapshotService({ repository, objectStore });
    await expect(service.rebuildCatalog({ actorId: 'admin', actorRole: 'admin', requestId: 'req' })).rejects.toMatchObject({ errorCode: 'SNAPSHOT_CONFLICT' });
    expect(objectStore.putImmutable).not.toHaveBeenCalled();
  });

  it('reuses persisted build timestamp and existing immutable bytes after prepare failure', async () => {
    const existing = Buffer.from('{"generatedAt":"2030-01-01T00:00:00.000Z","schemaVersion":1,"version":12,"works":[]}');
    const checksum = (await import('node:crypto')).createHash('sha256').update(existing).digest('hex');
    const repository = { beginSnapshot: vi.fn().mockResolvedValue({ jobId: 'job-v12', version: 12, leaseToken: 'lease-new', generatedAt: '2030-01-01T00:00:00.000Z' }), listPublicCatalog: vi.fn().mockResolvedValue([{ slug: 'later', rating: 'general', chapters: [], assets: [] }]), prepareSnapshot: vi.fn(), completeSnapshot: vi.fn(), failSnapshot: vi.fn() };
    const objectStore = { putImmutable: vi.fn().mockResolvedValue({ bytes: existing, checksum, existed: true }) };
    const service = createSnapshotService({ repository, objectStore, now: () => new Date('2040-01-01') });
    await expect(service.rebuildCatalog({ actorId: 'admin', actorRole: 'admin', requestId: 'req' })).resolves.toMatchObject({ version: 12, checksum });
    expect(repository.prepareSnapshot).toHaveBeenCalledWith(expect.objectContaining({ checksum }));
  });
});

describe('snapshot repository transaction boundary', () => {
  it('allocates, prepares and finalizes versions through controlled routines', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ job_id: 'job-1', version: 10, lease_token: '550e8400-e29b-41d4-a716-446655440010', lease_epoch: 1, generated_at: '2030-01-01T00:00:00Z', source_revision: 7 }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const repository = createSnapshotRepository({ rdb: { rpc, from: vi.fn() } });
    const claimed = await repository.beginSnapshot({ snapshotType: 'catalog', actorId: 'admin', requestId: 'req' });
    expect(claimed).toMatchObject({ jobId: 'job-1', version: 10, leaseToken: '550e8400-e29b-41d4-a716-446655440010', leaseEpoch: 1 });
    await repository.prepareSnapshot({ jobId: 'job-1', leaseToken: claimed.leaseToken, snapshotType: 'catalog', version: 10, objectKey: 'snapshots/public/catalog.v10.json', checksum: 'a'.repeat(64) });
    await repository.completeSnapshot({ jobId: 'job-1', leaseToken: claimed.leaseToken, actorId: 'admin', requestId: 'req' });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['begin_snapshot_build', 'prepare_snapshot_version', 'complete_snapshot_build']);
  });

  it('checks the fail RPC result instead of accepting a false transition', async () => {
    const repository = createSnapshotRepository({ rdb: { rpc: vi.fn().mockResolvedValue({ data: false, error: null }) } });
    await expect(repository.failSnapshot('job-1', 'lease', 'failed')).rejects.toMatchObject({ errorCode: 'DEPENDENCY_UNAVAILABLE' });
  });

  it.each([['snapshot_busy', 'SNAPSHOT_BUSY'], ['snapshot_conflict', 'SNAPSHOT_CONFLICT']])('maps %s to a safe 409', async (message, errorCode) => {
    const repository = createSnapshotRepository({ rdb: { rpc: vi.fn().mockResolvedValue({ data: null, error: { message } }) } });
    await expect(repository.beginSnapshot({ snapshotType: 'catalog', actorId: 'admin', requestId: 'r' })).rejects.toMatchObject({ status: 409, errorCode });
  });
});

describe('snapshot timer event contract', () => {
  it('invokes the same claim/process core without HTTP cookies or CSRF', async () => {
    const rebuildCatalog = vi.fn().mockResolvedValue({ version: 3 });
    const handler = createSnapshotTimerHandler({ service: { rebuildCatalog }, actorId: '550e8400-e29b-41d4-a716-446655440001' });
    await expect(handler({ type: 'timer', task: 'catalog-snapshot', scheduledAt: '2030-01-01T00:00:00.000Z' })).resolves.toEqual({ version: 3 });
    expect(rebuildCatalog).toHaveBeenCalledWith(expect.objectContaining({ actorRole: 'admin', requestId: 'timer:2030-01-01T00:00:00.000Z', idempotencyKey: 'timer:2030-01-01T00:00:00.000Z' }));
  });
});

it('uses persistent typed idempotency for manual snapshot triggers', () => {
  const router = createRouter(); registerSnapshotRoutes(router, { rebuild: vi.fn() });
  expect(router.resolve('POST', '/admin/snapshots/rebuild').metadata.idempotency).toMatchObject({ mode: 'required', responsePolicy: expect.any(Object) });
});

it('exposes a public short-cache pointer with only immutable snapshot coordinates', async () => {
  const http = createSnapshotHttpService({ getCurrentCatalog: vi.fn().mockResolvedValue({ version: 3, objectKey: 'snapshots/public/catalog.v3.json', checksum: 'a'.repeat(64), updatedAt: '2030-01-01T00:00:00.000Z' }) });
  const router = createRouter(); registerSnapshotRoutes(router, http);
  const route = router.resolve('GET', '/snapshots/catalog/current');
  expect(route.metadata).toMatchObject({ sessionRequired: false, cacheControl: 'public,max-age=60,must-revalidate' });
  await expect(route.handler({})).resolves.toEqual({ statusCode: 200, headers: { 'cache-control': 'public,max-age=60,must-revalidate' }, body: { version: 3, objectKey: 'snapshots/public/catalog.v3.json', checksum: 'a'.repeat(64), updatedAt: '2030-01-01T00:00:00.000Z' } });
});
