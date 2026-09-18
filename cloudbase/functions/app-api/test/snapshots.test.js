/* eslint-env node */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { buildCatalog, createSnapshotService } = require('../src/modules/snapshots/service');
const { createSnapshotRepository } = require('../src/modules/snapshots/repository');

describe('public catalog snapshots', () => {
  it('is stable, versioned, hashed and strips restricted/private/internal fields', () => {
    const rows = [
      { id: 'private-id', slug: 'zeta', title: 'Z', summary: 'z', type: 'novel', rating: 'restricted', publishedAt: '2030-01-02T00:00:00.000Z', assets: [] },
      { id: 'internal-a', slug: 'beta', title: 'B', summary: 'b', type: 'comic', rating: 'general', publishedAt: '2030-01-02T00:00:00.000Z', chapters: [{ id: 'secret-2', title: '二', position: 2 }, { id: 'secret-1', title: '一', position: 1 }], assets: [{ kind: 'page', objectKey: 'public/beta/2.webp', accessLevel: 'public', pageNo: 2, chapterPosition: 1 }, { kind: 'page', objectKey: 'private/key', accessLevel: 'private', pageNo: 1, chapterPosition: 1 }] },
      { id: 'internal-b', slug: 'alpha', title: 'A', summary: 'a', type: 'novel', rating: 'mature', publishedAt: '2030-01-01T00:00:00.000Z', assets: [{ kind: 'body', objectKey: 'public/alpha/body.txt', accessLevel: 'public', pageNo: null }] },
    ];
    const first = buildCatalog(rows, 7, '2030-01-03T00:00:00.000Z');
    const second = buildCatalog([...rows].reverse(), 7, '2030-01-03T00:00:00.000Z');
    expect(first).toEqual(second);
    expect(first.document).toEqual({ schemaVersion: 1, version: 7, generatedAt: '2030-01-03T00:00:00.000Z', works: [
      { slug: 'alpha', type: 'novel', title: 'A', summary: 'a', rating: 'mature', publishedAt: '2030-01-01T00:00:00.000Z', chapters: [], assets: [{ kind: 'body', path: 'public/alpha/body.txt' }] },
      { slug: 'beta', type: 'comic', title: 'B', summary: 'b', rating: 'general', publishedAt: '2030-01-02T00:00:00.000Z', chapters: [{ title: '一', position: 1 }, { title: '二', position: 2 }], assets: [{ kind: 'page', path: 'public/beta/2.webp', pageNo: 2, chapterPosition: 1 }] },
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
    const objectStore = { putJson: vi.fn(async (key) => events.push(key)), delete: vi.fn() };
    const service = createSnapshotService({ repository, objectStore, now: () => new Date('2030-01-03T00:00:00.000Z'), nonce: () => 'nonce' });
    const result = await service.rebuildCatalog({ actorId: 'admin', actorRole: 'admin', requestId: 'req' });
    expect(events).toEqual([
      'snapshots/public/.tmp/catalog.v8.nonce.json',
      'snapshots/public/catalog.v8.json',
      'prepare', 'complete', 'snapshots/public/manifest.json',
    ]);
    expect(repository.prepareSnapshot).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1', version: 8, objectKey: 'snapshots/public/catalog.v8.json', checksum: result.checksum }));
    expect(repository.completeSnapshot).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1', actorId: 'admin' }));
    expect(objectStore.putJson.mock.calls[2][1]).toEqual({ schemaVersion: 1, catalog: { version: 8, objectKey: 'snapshots/public/catalog.v8.json', checksum: result.checksum } });
  });

  it('keeps the old manifest current and marks failure when version generation fails', async () => {
    const repository = { beginSnapshot: vi.fn().mockResolvedValue({ jobId: 'job-2', version: 9 }), listPublicCatalog: vi.fn().mockResolvedValue([]), prepareSnapshot: vi.fn(), completeSnapshot: vi.fn(), failSnapshot: vi.fn() };
    const objectStore = { putJson: vi.fn().mockRejectedValueOnce(new Error('COS unavailable')), delete: vi.fn() };
    const service = createSnapshotService({ repository, objectStore, nonce: () => 'nonce' });
    await expect(service.rebuildCatalog({ actorId: 'admin', actorRole: 'admin', requestId: 'req' })).rejects.toThrow('COS unavailable');
    expect(objectStore.putJson).toHaveBeenCalledTimes(1);
    expect(repository.completeSnapshot).not.toHaveBeenCalled();
    expect(repository.failSnapshot).toHaveBeenCalledWith('job-2', 'COS unavailable');
  });

  it('has no fallible operation after the atomic current-manifest PUT', async () => {
    const events = [];
    const repository = {
      beginSnapshot: vi.fn().mockResolvedValue({ jobId: 'job-3', version: 10 }), listPublicCatalog: vi.fn().mockResolvedValue([]),
      prepareSnapshot: vi.fn(async () => events.push('prepare')), completeSnapshot: vi.fn(async () => events.push('complete')),
      failSnapshot: vi.fn(async () => events.push('failed')),
    };
    const objectStore = { putJson: vi.fn(async (key) => { events.push(key); if (key.endsWith('manifest.json')) throw new Error('manifest failed'); }), delete: vi.fn() };
    const service = createSnapshotService({ repository, objectStore, nonce: () => 'nonce' });
    await expect(service.rebuildCatalog({ actorId: 'admin', actorRole: 'admin', requestId: 'req' })).rejects.toThrow('manifest failed');
    expect(events).toEqual(['snapshots/public/.tmp/catalog.v10.nonce.json', 'snapshots/public/catalog.v10.json', 'prepare', 'complete', 'snapshots/public/manifest.json', 'failed']);
  });
});

describe('snapshot repository transaction boundary', () => {
  it('allocates, prepares and finalizes versions through controlled routines', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ job_id: 'job-1', version: 10 }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const repository = createSnapshotRepository({ rdb: { rpc, from: vi.fn() } });
    expect(await repository.beginSnapshot({ snapshotType: 'catalog', actorId: 'admin', requestId: 'req' })).toEqual({ jobId: 'job-1', version: 10 });
    await repository.prepareSnapshot({ jobId: 'job-1', snapshotType: 'catalog', version: 10, objectKey: 'snapshots/public/catalog.v10.json', checksum: 'a'.repeat(64) });
    await repository.completeSnapshot({ jobId: 'job-1', actorId: 'admin', requestId: 'req' });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['begin_snapshot_build', 'prepare_snapshot_version', 'complete_snapshot_build']);
  });
});
