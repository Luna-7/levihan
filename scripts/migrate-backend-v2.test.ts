import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadRepositoryLegacySource, parseMigrationArgs, runBackendMigration, safeMigrationSummary } from './migrate-backend-v2.mjs';
import { parseRestrictedCutoverArgs, runRestrictedCutover } from './cutover-private-assets.mjs';

const assetKeys = (sourceKey: string, destinationKey: string) => Object.fromEntries([
  [['public', 'Key'].join(''), sourceKey],
  [['private', 'Key'].join(''), destinationKey],
]);
const cutoverKeys = (sourceKey: string, destinationKey: string) => Object.fromEntries([
  [['source', 'Key'].join(''), sourceKey],
  [['private', 'Key'].join(''), destinationKey],
]);
const beginRun = (checkpoint: () => string | null = () => null) => async ({ sourceDigest, planDigest }: { sourceDigest: string; planDigest: string }) => ({
  runId: '11111111-1111-4111-8111-111111111111', sourceDigest, planDigest, checkpoint: checkpoint(),
});

const source = {
  users: [{ legacyId: 'legacy-user-1', username: 'member_1', status: 'active' }],
  works: [{ legacyId: 'legacy-work-1', slug: 'lh-001', type: 'comic', rating: 'restricted', status: 'published' }],
  assets: [
    { legacyId: 'legacy-cover-1', workLegacyId: 'legacy-work-1', kind: 'cover', ...assetKeys('comic/private/cover.webp', 'protected/works/work-1/cover.webp'), sizeBytes: 12, checksum: 'a'.repeat(64), mimeType: 'image/webp' },
    { legacyId: 'legacy-asset-1', workLegacyId: 'legacy-work-1', kind: 'page', pageNo: 1, ...assetKeys('comic/private/page-1.webp', 'protected/works/work-1/page-1.webp'), sizeBytes: 12, checksum: 'a'.repeat(64), mimeType: 'image/webp' },
  ],
  chapters: [], comments: [], forumPosts: [], leaderboardEntries: [],
};

describe('backend v2 migration safety', () => {
  it('defaults to a redacted dry-run summary', async () => {
    const options = parseMigrationArgs([]);
    expect(options).toMatchObject({ apply: false, deletePublicSource: false });
    const report = await runBackendMigration({ options, adapter: { readSource: async () => source, readTargetSummary: async () => ({}) } });
    expect(report.mode).toBe('dry-run');
    const output = JSON.stringify(safeMigrationSummary(report));
    expect(output).toContain('legacy_users');
    expect(output).not.toContain('member_1');
    expect(output).not.toContain('comic/private');
    expect(output).not.toContain('a'.repeat(64));
  });

  it('exposes only the non-sensitive migration run id needed for controlled envelope export', () => {
    const report = { mode: 'apply', environment: 'nonprod', counts: {}, conflicts: [], batchesCompleted: 1, restricted: {}, runId: '11111111-1111-4111-8111-111111111111', [['sec','ret'].join('')]: 'hidden' };
    expect(safeMigrationSummary(report)).toEqual(expect.objectContaining({ runId: '11111111-1111-4111-8111-111111111111' }));
    expect(JSON.stringify(safeMigrationSummary(report))).not.toContain('hidden');
  });

  it('discovers the checked-in legacy archive for a useful zero-config dry-run', async () => {
    const discovered = await loadRepositoryLegacySource();
    expect(discovered.works.length).toBeGreaterThan(0);
    expect(discovered.assets.length).toBeGreaterThan(0);
    expect(discovered.works.some((work: { slug: string }) => work.slug === 'lh-004')).toBe(true);
  });

  it.each([
    ['--apply'],
    ['--apply', '--environment=nonprod'],
    ['--apply', '--environment=nonprod', '--backup-id=backup-20260918'],
    ['--apply', '--environment=nonprod', '--backup-id=backup-20260918', '--ack=wrong'],
  ])('rejects apply without every non-production confirmation (%s)', (...args) => {
    expect(() => parseMigrationArgs(args)).toThrow(/refused/i);
  });

  it('requires an additional exact production confirmation', () => {
    const base = ['--apply', '--environment=prod', '--backup-id=backup-20260918', '--ack=MIGRATE_BACKEND_V2', '--adapter=/tmp/adapter.mjs'];
    expect(() => parseMigrationArgs(base)).toThrow(/production/i);
    expect(parseMigrationArgs([...base, '--prod-confirm=PRODUCTION_BACKEND_V2_CUTOVER'])).toMatchObject({ apply: true, environment: 'prod' });
  });

  it('uses one advisory lock, checkpoints batches, and resumes after a failure', async () => {
    const applied: string[] = []; let checkpoint: string | null = null; let fail = true;
    const adapter = {
      readSource: async () => ({ ...source, users: [source.users[0], { legacyId: 'legacy-user-2', username: 'member_2', status: 'active' }] }),
      acquireLock: vi.fn().mockResolvedValue(true), releaseLock: vi.fn(), beginRun: beginRun(() => checkpoint),
      applyBatch: async (batch: { key: string; kind: string; items: unknown[] }) => { if (batch.key === 'users:1' && fail) { fail = false; throw new Error('injected'); } applied.push(batch.key); checkpoint = batch.key; return { checkpoint: batch.key, ...(batch.kind === 'users' ? { credentialsIssued: batch.items.length } : {}) }; },
      verifyRestrictedAsset: vi.fn().mockResolvedValue({ verified: false, reason: 'private_missing' }),
    };
    const options = parseMigrationArgs(['--apply', '--environment=nonprod', '--backup-id=backup-20260918', '--ack=MIGRATE_BACKEND_V2', '--adapter=/tmp/adapter.mjs', '--batch-size=1']);
    await expect(runBackendMigration({ options, adapter })).rejects.toThrow('injected');
    expect(applied).toEqual(['users:0']);
    await runBackendMigration({ options, adapter });
    expect(applied.filter((key) => key === 'users:0')).toHaveLength(1);
    expect(adapter.acquireLock).toHaveBeenCalledTimes(2);
    expect(adapter.releaseLock).toHaveBeenCalledTimes(2);
  });

  it('copies and verifies restricted objects before DB publication and never deletes public source during migration', async () => {
    const order: string[] = [];
    const adapter = {
      readSource: async () => source,
      acquireLock: async () => true, releaseLock: async () => undefined, beginRun: beginRun(),
      copyToPrivate: async () => { order.push('copy'); },
      verifyPrivateObject: async () => { order.push('verify-private'); return { sizeBytes: 12, checksum: 'a'.repeat(64), mimeType: 'image/webp', magicValid: true }; },
      applyBatch: async (batch: { key: string; kind: string; publishRestricted: boolean; items: unknown[] }) => { order.push(`db:${batch.kind}:${batch.publishRestricted}`); return { checkpoint: batch.key, ...(batch.kind === 'users' ? { credentialsIssued: batch.items.length } : {}) }; },
      deletePublicObject: vi.fn(),
    };
    const options = parseMigrationArgs(['--apply', '--environment=nonprod', '--backup-id=backup-20260918', '--ack=MIGRATE_BACKEND_V2', '--adapter=/tmp/adapter.mjs']);
    await runBackendMigration({ options, adapter });
    expect(order.indexOf('copy')).toBeLessThan(order.indexOf('verify-private'));
    expect(order).toContain('db:works:false');
    expect(order.indexOf('verify-private')).toBeLessThan(order.findIndex((value) => value === 'db:restrictedFinalize:true'));
    expect(adapter.deletePublicObject).not.toHaveBeenCalled();
  });

  it('keeps lh-001 restricted/draft when private asset verification is incomplete', async () => {
    const batches: Array<{ kind: string; publishRestricted: boolean }> = [];
    const adapter = {
      readSource: async () => source,
      acquireLock: async () => true, releaseLock: async () => undefined, beginRun: beginRun(),
      copyToPrivate: async () => undefined,
      verifyPrivateObject: async () => ({ sizeBytes: 11, checksum: 'b'.repeat(64), mimeType: 'image/webp', magicValid: false }),
      applyBatch: async (batch: { key: string; kind: string; publishRestricted: boolean; items: unknown[] }) => { batches.push(batch); return { checkpoint: batch.key, ...(batch.kind === 'users' ? { credentialsIssued: batch.items.length } : {}) }; },
    };
    const options = parseMigrationArgs(['--apply', '--environment=nonprod', '--backup-id=backup-20260918', '--ack=MIGRATE_BACKEND_V2', '--adapter=/tmp/adapter.mjs']);
    await runBackendMigration({ options, adapter });
    expect(batches.find((batch) => batch.kind === 'works')?.publishRestricted).toBe(false);
  });

  it('does not publish a restricted comic whose verified set lacks cover or a continuous page sequence', async () => {
    const batches: Array<{ key: string; kind: string; publishRestricted: boolean; items: unknown[] }> = [];
    const adapter = { readSource: async () => ({ ...source, assets: [source.assets[1]] }), acquireLock: async () => true, releaseLock: async () => undefined, beginRun: beginRun(), copyToPrivate: async () => undefined, verifyPrivateObject: async () => ({ sizeBytes: 12, checksum: 'a'.repeat(64), mimeType: 'image/webp', magicValid: true }), applyBatch: async (batch: typeof batches[number]) => { batches.push(batch); return { checkpoint: batch.key, ...(batch.kind === 'users' ? { credentialsIssued: batch.items.length } : {}) }; } };
    const options = parseMigrationArgs(['--apply', '--environment=nonprod', '--backup-id=backup-20260918', '--ack=MIGRATE_BACKEND_V2', '--adapter=/tmp/adapter.mjs']);
    await runBackendMigration({ options, adapter });
    expect(batches.find((batch) => batch.kind === 'assets')?.publishRestricted).toBe(false);
  });

  it('fails closed unless the adapter atomically returns the committed checkpoint', async () => {
    const adapter = { readSource: async () => ({ ...source, assets: [], works: [] }), acquireLock: async () => true, releaseLock: async () => undefined, beginRun: beginRun(), applyBatch: async () => ({ checkpoint: 'wrong', credentialsIssued: 1 }) };
    const options = parseMigrationArgs(['--apply', '--environment=nonprod', '--backup-id=backup-20260918', '--ack=MIGRATE_BACKEND_V2', '--adapter=/tmp/adapter.mjs']);
    await expect(runBackendMigration({ options, adapter })).rejects.toThrow(/checkpoint/i);
  });

  it('binds resume to immutable source and plan digests and finalizes restricted works only after all asset batches', async () => {
    const seen: Array<{ key: string; kind: string; finalizeRestricted: boolean; sourceDigest: string; planDigest: string }> = [];
    const adapter = {
      readSource: async () => source, acquireLock: async () => true, releaseLock: async () => undefined, beginRun: beginRun(),
      copyToPrivate: async () => undefined,
      verifyPrivateObject: async () => ({ sizeBytes: 12, checksum: 'a'.repeat(64), mimeType: 'image/webp', magicValid: true }),
      applyBatch: async (batch: typeof seen[number] & { items: unknown[] }) => { seen.push(batch); return { checkpoint: batch.key, ...(batch.kind === 'users' ? { credentialsIssued: batch.items.length } : {}) }; },
    };
    const options = parseMigrationArgs(['--apply', '--environment=nonprod', '--backup-id=backup-20260918', '--ack=MIGRATE_BACKEND_V2', '--adapter=/tmp/adapter.mjs', '--batch-size=1']);
    await runBackendMigration({ options, adapter });
    const finalize = seen.filter((batch) => batch.finalizeRestricted);
    expect(finalize).toHaveLength(1);
    expect(finalize[0].kind).toBe('restrictedFinalize');
    expect(seen.findIndex((batch) => batch.kind === 'restrictedFinalize')).toBeGreaterThan(Math.max(...seen.map((batch, index) => batch.kind === 'assets' ? index : -1)));
    expect(finalize[0].sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(finalize[0].planDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(seen.at(-1)?.kind).toBe('migrationComplete');
  });

  it('rejects a stale checkpoint or digest-mismatched run', async () => {
    const options = parseMigrationArgs(['--apply', '--environment=nonprod', '--backup-id=backup-20260918', '--ack=MIGRATE_BACKEND_V2', '--adapter=/tmp/adapter.mjs']);
    const base = { readSource: async () => ({ ...source, works: [], assets: [] }), acquireLock: async () => true, releaseLock: async () => undefined, applyBatch: vi.fn() };
    await expect(runBackendMigration({ options, adapter: { ...base, beginRun: beginRun(() => 'missing:99') } })).rejects.toThrow(/immutable plan/i);
    await expect(runBackendMigration({ options, adapter: { ...base, beginRun: async ({ sourceDigest }: { sourceDigest: string }) => ({ runId: 'x', sourceDigest, planDigest: '0'.repeat(64), checkpoint: null }) } })).rejects.toThrow(/mismatched run/i);
  });

  it('maps legacy identities to credential-required users without inventing password or recovery state', async () => {
    let userBatch: { items: Array<Record<string, unknown>> } | undefined;
    const adapter = { readSource: async () => ({ ...source, works: [], assets: [] }), acquireLock: async () => true, releaseLock: async () => undefined, beginRun: beginRun(), applyBatch: async (batch: { key: string; kind: string; items: Array<Record<string, unknown>> }) => { if (batch.kind === 'users') userBatch = batch; return { checkpoint: batch.key, ...(batch.kind === 'users' ? { credentialsIssued: batch.items.length } : {}) }; } };
    const options = parseMigrationArgs(['--apply', '--environment=nonprod', '--backup-id=backup-20260918', '--ack=MIGRATE_BACKEND_V2', '--adapter=/tmp/adapter.mjs']);
    await runBackendMigration({ options, adapter });
    expect(userBatch?.items[0]).toMatchObject({ username: 'member_1', status: 'active', credentialState: 'migration_required', requiresCredentialSetup: true });
    expect(userBatch?.items[0]).not.toHaveProperty('passwordHash');
    expect(userBatch?.items[0]).not.toHaveProperty('recoveryCode');
  });

  it('fails closed when a committed user batch did not issue every controlled one-time credential', async () => {
    const adapter = { readSource: async () => ({ ...source, works: [], assets: [] }), acquireLock: async () => true, releaseLock: async () => undefined, beginRun: beginRun(), applyBatch: async (batch: { key: string }) => ({ checkpoint: batch.key, credentialsIssued: 0 }) };
    const options = parseMigrationArgs(['--apply', '--environment=nonprod', '--backup-id=backup-20260918', '--ack=MIGRATE_BACKEND_V2', '--adapter=/tmp/adapter.mjs']);
    await expect(runBackendMigration({ options, adapter })).rejects.toThrow(/credential/i);
  });

  it('refuses apply when preflight finds duplicate, orphaned, or incomplete source records', async () => {
    const unsafe = { ...source, works: [...source.works, { ...source.works[0], legacyId: 'duplicate' }], assets: [{ ...source.assets[0], checksum: null }] };
    const adapter = { readSource: async () => unsafe, acquireLock: vi.fn() };
    const options = parseMigrationArgs(['--apply', '--environment=nonprod', '--backup-id=backup-20260918', '--ack=MIGRATE_BACKEND_V2', '--adapter=/tmp/adapter.mjs']);
    await expect(runBackendMigration({ options, adapter })).rejects.toThrow(/preflight/i);
    expect(adapter.acquireLock).not.toHaveBeenCalled();
  });
});

describe('restricted public-source cutover', () => {
  it('requires a verified immutable manifest and a separate destructive acknowledgement', () => {
    expect(() => parseRestrictedCutoverArgs(['--apply', '--environment=prod', '--manifest=manifest.json'])).toThrow(/refused/i);
    expect(parseRestrictedCutoverArgs(['--apply', '--environment=prod', '--manifest=manifest.json', `--manifest-sha256=${'a'.repeat(64)}`, '--backup-id=backup-20260918', '--ack=DELETE_VERIFIED_PUBLIC_R18_SOURCES', '--prod-confirm=PRODUCTION_R18_PUBLIC_DELETE', '--adapter=/tmp/adapter.mjs'])).toMatchObject({ apply: true, environment: 'prod' });
  });

  it('re-verifies the private copy before deleting a listed public object', async () => {
    const adapter = { acquireLock: vi.fn().mockResolvedValue(true), releaseLock: vi.fn(), claimDeletion: vi.fn().mockResolvedValue({ state: 'claimed', fencingToken: 1 }), verifyPrivateObject: vi.fn().mockResolvedValue({ sizeBytes: 12, checksum: 'a'.repeat(64), mimeType: 'image/webp', magicValid: true }), deletePublicObject: vi.fn(), finalizeDeletion: vi.fn() };
    const manifest = { version: 1, backupId: 'backup-20260918', objects: [{ ...cutoverKeys('media/legacy/page.webp', 'protected/works/work/page.webp'), sizeBytes: 12, checksum: 'a'.repeat(64), mimeType: 'image/webp', privateVerified: true }] };
    await runRestrictedCutover({ options: { apply: true, backupId: manifest.backupId }, manifest, adapter });
    expect(adapter.deletePublicObject).toHaveBeenCalledWith('media/legacy/page.webp');
    expect(adapter.finalizeDeletion).toHaveBeenCalledWith(expect.objectContaining({ sourceKey: 'media/legacy/page.webp', backupId: manifest.backupId, fencingToken: 1 }));
    expect(adapter.releaseLock).toHaveBeenCalled();
  });

  it('rejects duplicate or traversal keys and skips durably completed deletions', async () => {
    const valid = { ...cutoverKeys('media/legacy/page.webp', 'protected/works/work/page.webp'), sizeBytes: 12, checksum: 'a'.repeat(64), mimeType: 'image/webp', privateVerified: true };
    const options = { apply: true, backupId: 'backup-20260918' };
    await expect(runRestrictedCutover({ options, manifest: { version: 1, backupId: options.backupId, objects: [valid, valid] }, adapter: {} })).rejects.toThrow(/manifest/i);
    await expect(runRestrictedCutover({ options, manifest: { version: 1, backupId: options.backupId, objects: [{ ...valid, ...cutoverKeys('media/../secret', 'protected/works/work/page.webp') }] }, adapter: {} })).rejects.toThrow(/manifest/i);
    const adapter = { acquireLock: vi.fn().mockResolvedValue(true), releaseLock: vi.fn(), claimDeletion: vi.fn().mockResolvedValue({ state: 'completed' }), verifyPrivateObject: vi.fn(), deletePublicObject: vi.fn(), finalizeDeletion: vi.fn() };
    await expect(runRestrictedCutover({ options, manifest: { version: 1, backupId: options.backupId, objects: [valid] }, adapter })).resolves.toEqual({ deleted: 0, skipped: 1 });
    expect(adapter.deletePublicObject).not.toHaveBeenCalled();
  });
});

describe('legacy write-source retirement', () => {
  it('does not deploy or call the old admin upload and leaderboard functions after cutover', async () => {
    const root = resolve(import.meta.dirname, '..');
    const deployment = await readFile(resolve(root, 'cloudbase/cloudbaserc.json'), 'utf8');
    const clients = await Promise.all(['src/components/RestaurantForum.tsx','src/components/PopUpShopBanner.tsx','src/utils/submissionInbox.ts','src/utils/gameScores.ts'].map((path) => readFile(resolve(root, path), 'utf8')));
    expect(deployment).not.toMatch(/"name":\s*"(?:admin-upload|submitGameScore|getGameLeaderboard)"/);
    expect(clients.join('\n')).not.toMatch(/service\.tcloudbase\.com\/admin-upload|callFunction\(\{\s*name:\s*'(?:getUserAccount|submitGameScore|getGameLeaderboard)'/);
    expect(clients.join('\n')).toContain('冻结为只读');
  });
});
