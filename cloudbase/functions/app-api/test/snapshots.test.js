/* eslint-env node */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { buildCatalog, createSnapshotService, createSnapshotTimerHandler } = require('../src/modules/snapshots/service');
const { createSnapshotRepository } = require('../src/modules/snapshots/repository');

describe('public catalog snapshots', () => {
  it('is stable, versioned, hashed and strips restricted/private/internal fields', () => {
    const rows = [
      { id: 'private-id', slug: 'zeta', title: 'Z', summary: 'z', type: 'novel', rating: 'restricted', publishedAt: '2030-01-02T00:00:00.000Z', assets: [] },
      { id: 'internal-a', slug: 'beta', title: 'B', summary: 'b', type: 'comic', rating: 'general', publishedAt: '2030-01-02T00:00:00.000Z', chapters: [{ id: 'secret-2', title: '二', position: 2 }, { id: 'secret-1', title: '一', position: 1 }], assets: [{ kind: 'page', objectKey: 'media/works/beta/c2p1.webp', storageZone: 'public', accessLevel: 'public', pageNo: 1, chapterPosition: 2 }, { kind: 'page', objectKey: 'media/works/beta/c1p2.webp', storageZone: 'public', accessLevel: 'public', pageNo: 2, chapterPosition: 1 }, { kind: 'page', objectKey: 'private/key', storageZone: 'private', accessLevel: 'public', pageNo: 1, chapterPosition: 1 }] },
      { id: 'internal-b', slug: 'alpha', title: 'A', summary: 'a', type: 'novel', rating: 'mature', publishedAt: '2030-01-01T00:00:00.000Z', assets: [{ kind: 'body', objectKey: 'public/alpha/body.txt', storageZone: 'public', accessLevel: 'public', pageNo: null }] },
    ];
    const first = buildCatalog(rows, 7, '2030-01-03T00:00:00.000Z');
    const second = buildCatalog([...rows].reverse(), 7, '2030-01-03T00:00:00.000Z');
    expect(first).toEqual(second);
    expect(first.document).toEqual({ schemaVersion: 1, version: 7, generatedAt: '2030-01-03T00:00:00.000Z', works: [
      { slug: 'alpha', type: 'novel', title: 'A', summary: 'a', rating: 'mature', publishedAt: '2030-01-01T00:00:00.000Z', chapters: [], assets: [{ kind: 'body', path: 'public/alpha/body.txt' }] },
      { slug: 'beta', type: 'comic', title: 'B', summary: 'b', rating: 'general', publishedAt: '2030-01-02T00:00:00.000Z', chapters: [{ title: '一', position: 1 }, { title: '二', position: 2 }], assets: [{ kind: 'page', path: 'media/works/beta/c1p2.webp', pageNo: 2, chapterPosition: 1 }, { kind: 'page', path: 'media/works/beta/c2p1.webp', pageNo: 1, chapterPosition: 2 }] },
    ] });
    expect(first.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toMatch(/private-id|internal-a|private\/key|secret-1|secret-2/);
  });

  it('writes immutable and temporary objects before switching the manifest pointer and recording success', async () => {
    const events = [];
    const repository = {
      beginSnapshot: vi.fn().mockResolvedValue({ jobId: 'job-1', version: 8 }),
      listPublicCatalog: vi.fn().mockResolvedValue([]),
      prepareSnapshot: vi.fn(async () => events.push('prepare')),
      completeSnapshot: vi.fn(async () => events.push('complete')),
      failSnapshot: vi.fn(),
    };
    const objectStore = { putBytes: vi.fn(async (key, bytes) => events.push(key, bytes)), putManifest: vi.fn(async () => events.push('manifest')), delete: vi.fn() };
    const service = createSnapshotService({ repository, objectStore, now: () => new Date('2030-01-03T00:00:00.000Z'), nonce: () => 'nonce' });
    const result = await service.rebuildCatalog({ actorId: 'admin', actorRole: 'admin', requestId: 'req' });
    expect(events.filter((item) => typeof item === 'string')).toEqual(['snapshots/public/.tmp/catalog.v8.nonce.json', 'snapshots/public/catalog.v8.json', 'prepare', 'manifest', 'complete']);
    const uploaded = events.find(Buffer.isBuffer);
    expect((await import('node:crypto')).createHash('sha256').update(uploaded).digest('hex')).toBe(result.checksum);
    expect(repository.prepareSnapshot).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1', version: 8, objectKey: 'snapshots/public/catalog.v8.json', checksum: result.checksum }));
    expect(repository.completeSnapshot).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1', actorId: 'admin' }));
    expect(objectStore.putManifest).toHaveBeenCalledWith(expect.objectContaining({ catalog: { version: 8, objectKey: 'snapshots/public/catalog.v8.json', checksum: result.checksum } }));
  });

  it('keeps the old manifest current and marks failure when version generation fails', async () => {
    const repository = { beginSnapshot: vi.fn().mockResolvedValue({ jobId: 'job-2', version: 9 }), listPublicCatalog: vi.fn().mockResolvedValue([]), prepareSnapshot: vi.fn(), completeSnapshot: vi.fn(), failSnapshot: vi.fn() };
    const objectStore = { putBytes: vi.fn().mockRejectedValueOnce(new Error('COS unavailable')), putManifest: vi.fn(), delete: vi.fn() };
    const service = createSnapshotService({ repository, objectStore, nonce: () => 'nonce' });
    await expect(service.rebuildCatalog({ actorId: 'admin', actorRole: 'admin', requestId: 'req' })).rejects.toThrow('COS unavailable');
    expect(objectStore.putBytes).toHaveBeenCalledTimes(1);
    expect(repository.completeSnapshot).not.toHaveBeenCalled();
    expect(repository.failSnapshot).toHaveBeenCalledWith('job-2', 'SNAPSHOT_DELIVERY_FAILED');
  });

  it('has no fallible operation after the atomic current-manifest PUT', async () => {
    const events = [];
    const repository = {
      beginSnapshot: vi.fn().mockResolvedValue({ jobId: 'job-3', version: 10 }), listPublicCatalog: vi.fn().mockResolvedValue([]),
      prepareSnapshot: vi.fn(async () => events.push('prepare')), completeSnapshot: vi.fn(async () => events.push('complete')),
      failSnapshot: vi.fn(async () => events.push('failed')),
    };
    const objectStore = { putBytes: vi.fn(async (key) => events.push(key)), putManifest: vi.fn(async () => { events.push('manifest'); throw new Error('manifest failed'); }), delete: vi.fn() };
    const service = createSnapshotService({ repository, objectStore, nonce: () => 'nonce' });
    await expect(service.rebuildCatalog({ actorId: 'admin', actorRole: 'admin', requestId: 'req' })).rejects.toThrow('manifest failed');
    expect(events).toEqual(['snapshots/public/.tmp/catalog.v10.nonce.json', 'snapshots/public/catalog.v10.json', 'prepare', 'manifest', 'failed']);
  });

  it('resumes a prepared immutable version without rebuilding bytes', async () => {
    const repository = {
      beginSnapshot: vi.fn().mockResolvedValue({ jobId: 'job-old', version: 4, state: 'prepared', objectKey: 'snapshots/public/catalog.v4.json', checksum: 'b'.repeat(64) }),
      listPublicCatalog: vi.fn(), prepareSnapshot: vi.fn(), completeSnapshot: vi.fn(), failSnapshot: vi.fn(),
    };
    const objectStore = { putBytes: vi.fn(), putManifest: vi.fn(), delete: vi.fn() };
    const service = createSnapshotService({ repository, objectStore });
    await expect(service.rebuildCatalog({ actorId: 'admin', actorRole: 'admin', requestId: 'req' })).resolves.toEqual({ version: 4, checksum: 'b'.repeat(64), objectKey: 'snapshots/public/catalog.v4.json' });
    expect(repository.listPublicCatalog).not.toHaveBeenCalled();
    expect(objectStore.putBytes).not.toHaveBeenCalled();
    expect(objectStore.putManifest).toHaveBeenCalledWith({ schemaVersion: 1, catalog: { version: 4, objectKey: 'snapshots/public/catalog.v4.json', checksum: 'b'.repeat(64) } });
    expect(repository.completeSnapshot).toHaveBeenCalled();
  });

  it('never lets an older prepared job move the manifest backwards', async () => {
    const repository = { beginSnapshot: vi.fn().mockResolvedValue({ jobId: 'job-v1', version: 1, state: 'prepared', objectKey: 'snapshots/public/catalog.v1.json', checksum: 'a'.repeat(64) }), completeSnapshot: vi.fn(), failSnapshot: vi.fn() };
    const objectStore = { getManifest: vi.fn().mockResolvedValue({ schemaVersion: 1, catalog: { version: 2 } }), putManifest: vi.fn() };
    const service = createSnapshotService({ repository, objectStore });
    await expect(service.rebuildCatalog({ actorId: 'admin', actorRole: 'admin', requestId: 'req' })).rejects.toMatchObject({ errorCode: 'STATE_CONFLICT' });
    expect(objectStore.putManifest).not.toHaveBeenCalled();
    expect(repository.completeSnapshot).not.toHaveBeenCalled();
  });
});

describe('snapshot repository transaction boundary', () => {
  it('allocates, prepares and finalizes versions through controlled routines', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ job_id: 'job-1', version: 10 }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const repository = createSnapshotRepository({ rdb: { rpc, from: vi.fn() } });
    expect(await repository.beginSnapshot({ snapshotType: 'catalog', actorId: 'admin', requestId: 'req' })).toEqual({ jobId: 'job-1', version: 10, state: 'running', objectKey: null, checksum: null });
    await repository.prepareSnapshot({ jobId: 'job-1', snapshotType: 'catalog', version: 10, objectKey: 'snapshots/public/catalog.v10.json', checksum: 'a'.repeat(64) });
    await repository.completeSnapshot({ jobId: 'job-1', actorId: 'admin', requestId: 'req' });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['begin_snapshot_build', 'prepare_snapshot_version', 'complete_snapshot_build']);
  });

  it('checks the fail RPC result instead of accepting a false transition', async () => {
    const repository = createSnapshotRepository({ rdb: { rpc: vi.fn().mockResolvedValue({ data: false, error: null }) } });
    await expect(repository.failSnapshot('job-1', 'failed')).rejects.toMatchObject({ errorCode: 'DEPENDENCY_UNAVAILABLE' });
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
