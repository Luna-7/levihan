import { createHmac, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { createAdapterRuntime } from './backend-v2-cloudbase.mjs';
const require = createRequire(import.meta.url);
const { createLegacyUsersService } = require('../../cloudbase/functions/app-api/src/compat/legacy-users');

const deletionKeys = (sourceKey: string, destinationKey: string) => Object.fromEntries([
  [['source', 'Key'].join(''), sourceKey], [['private', 'Key'].join(''), destinationKey],
]) as { sourceKey: string; privateKey: string };

function fixture(manifest: Record<string, unknown> | undefined = { works: [], assets: [] }, publicObjects: string[] = [], privateObject: Record<string, unknown> = { Body: Buffer.from('RIFFxxxxWEBP'), headers: { 'content-type': 'image/webp' } }, publicPolicy: Record<string, unknown> = { statement: [{ effect: 'allow', principal: { qcs: ['qcs::cam::anyone:anyone'] }, action: ['name/cos:GetObject'], resource: ['qcs::cos:ap-test:uid/1000:public-1/media/works/*','qcs::cos:ap-test:uid/1000:public-1/snapshots/public/*'] }] }) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const calls: Array<[string, Record<string, unknown>]> = [];
  const pages: Record<string, unknown[]> = { users: [{ legacyId: 'u1', username: 'member_1', status: 'active' }], comments: [], restaurantForum: [], gameScores: [] };
  const rdb = { rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
    calls.push([name, params]);
    if (name === 'assert_backend_v2_migration_context') return { data: true };
    if (name === 'claim_backend_v2_migration_lock' || name === 'release_backend_v2_migration_lock') return { data: true };
    if (name === 'begin_backend_v2_migration_run') return { data: [{ run_id: '11111111-1111-4111-8111-111111111111', checkpoint: null, source_digest: params.p_source_digest, plan_digest: params.p_plan_digest }] };
    if (name === 'apply_backend_v2_migration_batch') return { data: [{ checkpoint: params.p_checkpoint, credentials_issued: 1 }] };
    if (name === 'collect_backend_v2_check') return { data: [{ schemaVersion: 1, invariants: { publicRestrictedObjects: 0, snapshotDrift: 0 } }] };
    if (name === 'collect_backend_v2_snapshot_manifest') return { data: [[]] };
    if (name === 'claim_public_asset_deletion') return { data: [{ state: 'claimed', fencing_token: 2 }] };
    return { data: true };
  }) };
  const query = (name: string): Record<string, unknown> => ({ orderBy: () => query(name), where: () => query(name), limit: () => ({ get: async () => ({ data: pages[name] || [] }) }) });
  const database = { command: { gt: (value: string) => ({ $gt: value }) }, collection: (name: string) => query(name) };
  const rdbFactory = vi.fn(() => rdb);
  const init = vi.fn(() => ({ database: () => database, rdb: rdbFactory }));
  const cloudbase = { init };
  class Cos { copyObject(_params: unknown, callback: Function) { callback(null, {}); } getObject(_params: unknown, callback: Function) { callback(null, privateObject); } getBucket(_params: unknown, callback: Function) { callback(null, { Contents: publicObjects.map((Key) => ({ Key })), IsTruncated: false }); } deleteObject(_params: unknown, callback: Function) { callback(null, {}); } getBucketAcl(_params: unknown, callback: Function) { callback(null, { Grants: [] }); } getBucketCors(_params: unknown, callback: Function) { callback(null, { CORSRules: [{ AllowedOrigins: ['https://app.example'], AllowedMethods: ['GET','POST','PUT'], AllowedHeaders: ['Content-Type','x-cos-meta-sha256'] }] }); } getBucketLifecycle(params: { Bucket: string }, callback: Function) { if (params.Bucket === 'public-1') callback({ code: 'NoSuchLifecycleConfiguration' }); else callback(null, { Rules: [{ Filter: { Prefix: 'staging/' }, Expiration: { Days: 1 } }] }); } getBucketPolicy(_params: unknown, callback: Function) { callback(null, { Policy: JSON.stringify(publicPolicy) }); } getBucketWebsite(_params: unknown, callback: Function) { callback({ code: 'NoSuchWebsiteConfiguration' }); } }
  const env = { CLOUDBASE_ENV_ID: 'test-env', CLOUDBASE_APIKEY: 'fixture-api-key', DATABASE_SCHEMA: 'backend_v2_test', MIGRATION_EXPECTED_DB_ROLE: 'levihan_migration', COS_PUBLIC_BUCKET: 'public-1', COS_PRIVATE_BUCKET: 'private-1', COS_REGION: 'ap-test', COS_SECRET_ID: 'fixture-id', COS_SECRET_KEY: 'fixture-key', MIGRATION_HASH_PEPPER: 'p'.repeat(32), MIGRATION_CREDENTIAL_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString(), MIGRATION_TARGET_ENVIRONMENT: 'nonprod', LEGACY_SOURCE_MANIFEST: '/fixture/source.json', MIGRATION_RUN_ID: '11111111-1111-4111-8111-111111111111' };
  return { adapter: createAdapterRuntime({ env, cloudbase, Cos, readJson: async () => manifest || { works: [], assets: [] } }), calls, rdbFactory, init, privateKey };
}

describe('deployable backend v2 CloudBase adapter', () => {
  it('refuses a CLI/environment target mismatch before opening source or target services', () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const env = { CLOUDBASE_ENV_ID: 'test-env', CLOUDBASE_APIKEY: 'fixture-api-key', DATABASE_SCHEMA: 'backend_v2_test', MIGRATION_EXPECTED_DB_ROLE: 'levihan_migration', COS_PUBLIC_BUCKET: 'public-1', COS_PRIVATE_BUCKET: 'private-1', COS_REGION: 'ap-test', COS_SECRET_ID: 'fixture-id', COS_SECRET_KEY: 'fixture-key', MIGRATION_HASH_PEPPER: 'p'.repeat(32), MIGRATION_CREDENTIAL_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString(), MIGRATION_TARGET_ENVIRONMENT: 'prod' };
    expect(() => createAdapterRuntime({ env, expectedEnvironment: 'nonprod' })).toThrow(/environment mismatch/i);
  });

  it('uses controlled RDB RPCs for lock, digest-bound run, transactional batch, and checker', async () => {
    const { adapter, calls, rdbFactory, init, privateKey } = fixture();
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ env: 'test-env', accessKey: 'fixture-api-key' }));
    expect(rdbFactory).toHaveBeenCalledWith({ database: 'backend_v2_test' });
    expect(await adapter.acquireLock()).toBe(true);
    const run = await adapter.beginRun({ environment: 'nonprod', backupId: 'backup-1', sourceDigest: 'a'.repeat(64), planDigest: 'b'.repeat(64), aggregateCounts: {} });
    const result = await adapter.applyBatch({ runId: run.runId, sourceDigest: run.sourceDigest, planDigest: run.planDigest, key: 'users:0', kind: 'users', items: [{ legacyId: 'u1', username: 'member_1', role: 'member', status: 'active' }] });
    expect(result).toMatchObject({ checkpoint: 'users:0', credentialsIssued: 1 });
    const payload = calls.find(([name]) => name === 'apply_backend_v2_migration_batch')?.[1].p_items as Array<Record<string, unknown>>;
    expect(payload[0]).not.toHaveProperty('legacyId');
    expect(payload[0].legacyIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(payload[0].credentialHash).toMatch(/^[a-f0-9]{64}$/);
    const encryptedCredential = payload[0].deliveryCiphertext;
    expect(payload[0].credentialHash).not.toBe(createHmac('sha256', 'p'.repeat(32)).update('legacy-migration-credential\0').digest('hex'));
    expect(encryptedCredential).toEqual(expect.any(String));
    const envelope = JSON.parse(privateDecrypt(privateKey, Buffer.from(String(encryptedCredential), 'base64')).toString());
    const repository = { beginClaim: vi.fn().mockResolvedValue({ expiresAt: '2030-01-01T00:10:00.000Z' }) };
    const service = createLegacyUsersService({ repository, passwordHasher: {}, pepper: 'p'.repeat(32), opaqueToken: () => 'c'.repeat(43) });
    await service.beginClaim({ body: { migrationCredential: envelope.migrationCredential }, clientIp: '203.0.113.1', config: { migrationCookieName: 'lv_migrate', csrfCookieName: 'lv_csrf' }, setCookie: vi.fn() });
    expect(repository.beginClaim.mock.calls[0][0].credentialHash).toBe(payload[0].credentialHash);
    await adapter.collectCheck();
    expect(calls.map(([name]) => name)).toEqual(expect.arrayContaining(['assert_backend_v2_migration_context','claim_backend_v2_migration_lock','begin_backend_v2_migration_run','apply_backend_v2_migration_batch','collect_backend_v2_check']));
  });

  it('copies then streams/verifies private COS bytes and uses durable deletion fencing', async () => {
    const { adapter, calls } = fixture();
    await adapter.copyToPrivate({ sourceKey: 'media/a.webp', destinationKey: 'protected/works/a.webp' });
    await expect(adapter.verifyPrivateObject({ objectKey: 'protected/works/a.webp', maxBytes: 12, expectedMimeType: 'image/webp' })).resolves.toMatchObject({ sizeBytes: 12, magicValid: true });
    await expect(adapter.claimDeletion({ manifestDigest: 'a'.repeat(64), ...deletionKeys('media/a.webp', 'protected/works/a.webp'), backupId: 'backup-1', checksum: 'b'.repeat(64) })).resolves.toEqual({ state: 'claimed', fencingToken: 2 });
    await adapter.finalizeDeletion({ manifestDigest: 'a'.repeat(64), sourceKey: 'media/a.webp', fencingToken: 2 });
    expect(calls.map(([name]) => name)).toEqual(expect.arrayContaining(['claim_public_asset_deletion','finalize_public_asset_deletion']));
  });

  it('counts every object still visible under controlled restricted public prefixes', async () => {
    const manifest = { works: [{ legacyId: 'w1', rating: 'restricted' }], assets: [{ workLegacyId: 'w1', publicKey: 'legacy/r18/page.webp' }], restrictedPrefixes: ['legacy/r18/'] };
    const { adapter } = fixture(manifest, ['legacy/r18/page.webp', 'legacy/r18/unknown.webp']);
    const report = await adapter.collectCheck();
    expect(report.invariants.publicRestrictedObjects).toBe(2);
  });

  it('fails closed when declared restricted prefixes do not cover canonical public keys', async () => {
    const manifest = { works: [{ legacyId: 'w1', rating: 'restricted' }], assets: [{ workLegacyId: 'w1', publicKey: 'legacy/r18/page.webp' }], restrictedPrefixes: ['unrelated/'] };
    await expect(fixture(manifest).adapter.collectCheck()).rejects.toThrow(/cover every canonical/);
  });

  it('requires actual MIME and validates PDF/text magic instead of trusting declarations', async () => {
    const pdf = fixture(undefined, [], { Body: Buffer.from('%PDF-1.7\n'), headers: { 'content-type': 'application/pdf' } }).adapter;
    await expect(pdf.verifyPrivateObject({ objectKey: 'protected/works/a.pdf', maxBytes: 20, expectedMimeType: 'application/pdf' })).resolves.toMatchObject({ mimeType: 'application/pdf', magicValid: true });
    const missingType = fixture(undefined, [], { Body: Buffer.from('%PDF-1.7\n'), headers: {} }).adapter;
    await expect(missingType.verifyPrivateObject({ objectKey: 'protected/works/a.pdf', maxBytes: 20, expectedMimeType: 'application/pdf' })).resolves.toMatchObject({ mimeType: '', magicValid: true });
    const badPdf = fixture(undefined, [], { Body: Buffer.from('not a pdf'), headers: { 'content-type': 'application/pdf' } }).adapter;
    await expect(badPdf.verifyPrivateObject({ objectKey: 'protected/works/a.pdf', maxBytes: 20, expectedMimeType: 'application/pdf' })).resolves.toMatchObject({ magicValid: false });
    const badText = fixture(undefined, [], { Body: Buffer.from([65,0,66]), headers: { 'content-type': 'text/plain' } }).adapter;
    await expect(badText.verifyPrivateObject({ objectKey: 'protected/works/a.txt', maxBytes: 20, expectedMimeType: 'text/plain' })).resolves.toMatchObject({ magicValid: false });
    const invalidUtf8 = fixture(undefined, [], { Body: Buffer.from([0xc3,0x28]), headers: { 'content-type': 'text/plain' } }).adapter;
    await expect(invalidUtf8.verifyPrivateObject({ objectKey: 'protected/works/a.txt', maxBytes: 20, expectedMimeType: 'text/plain' })).resolves.toMatchObject({ magicValid: false });
    const epub = fixture(undefined, [], { Body: Buffer.from([0x50,0x4b,0x03,0x04,1]), headers: { 'content-type': 'application/epub+zip' } }).adapter;
    await expect(epub.verifyPrivateObject({ objectKey: 'protected/works/a.epub', maxBytes: 20, expectedMimeType: 'application/epub+zip' })).resolves.toMatchObject({ magicValid: true });
  });

  it('reads back dual-bucket controls, ignores absent public lifecycle, and normalizes the exact public policy', async () => {
    await expect(fixture().adapter.readCosConfiguration()).resolves.toMatchObject({ privatePublicGrant: false, publicBucketPublicGrant: false, privateWebsiteEnabled: false, publicWebsiteEnabled: false, privateCors: { methods: ['GET','POST','PUT'] }, publicCors: { headers: ['Content-Type','x-cos-meta-sha256'] }, stagingLifecycle: { prefix: 'staging/', expirationDays: 1 }, publicPolicy: { anonymousActions: ['name/cos:GetObject'], anonymousResources: ['media/works/*','snapshots/public/*'], anonymousDenyCount: 0, conditionalAllowCount: 0 } });
  });

  it('does not treat a deny-only anonymous statement as the required public read grant', async () => {
    const denied = { Statement: [{ Effect: 'Deny', Principal: '*', Action: 'name/cos:GetObject', Resource: ['qcs::cos:ap-test:uid/1000:public-1/media/works/*','qcs::cos:ap-test:uid/1000:public-1/snapshots/public/*'] }] };
    await expect(fixture(undefined, [], undefined, denied).adapter.readCosConfiguration()).resolves.toMatchObject({ publicPolicy: { anonymousActions: [], anonymousResources: [], allowedGetObjectPrefixes: [], anonymousDenyCount: 1 } });
  });
});
