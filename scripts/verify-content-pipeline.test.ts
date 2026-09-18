import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateContentPipeline } from './verify-content-pipeline.mjs';

const root = resolve(import.meta.dirname, '..');
const migration = readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline.sql'), 'utf8');
const rollback = readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline_rollback.sql'), 'utf8');
const access = readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline_runtime_access.sql'), 'utf8');
const accessRollback = readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline_runtime_access_rollback.sql'), 'utf8');
const cosSource = readFileSync(resolve(root, 'cloudbase/functions/app-api/src/infrastructure/cos.js'), 'utf8');
const cloudbaseConfig = readFileSync(resolve(root, 'cloudbase/cloudbaserc.json'), 'utf8');
const snapshotWorkerSource = readFileSync(resolve(root, 'cloudbase/functions/app-api/snapshot-worker.js'), 'utf8');
const cleanupWorkerSource = readFileSync(resolve(root, 'cloudbase/functions/app-api/upload-cleanup-worker.js'), 'utf8');
const uploadsRepositorySource = readFileSync(resolve(root, 'cloudbase/functions/app-api/src/modules/uploads/repository.js'), 'utf8');
const validate = (overrides: Record<string, string> = {}) => validateContentPipeline({ migration, rollback, access, accessRollback, cosSource, cloudbaseConfig, snapshotWorkerSource, cleanupWorkerSource, uploadsRepositorySource, ...overrides });

describe('content pipeline migration verifier', () => {
  it('accepts the reviewed additive migration set', () => {
    expect(validate()).toEqual([]);
  });

  it.each([
    ['admin authorization', (sql: string) => sql.replace("actor.role <> 'admin'", "actor.role <> 'member'")],
    ['optimistic lock', (sql: string) => sql.replace('work.version <> p_expected_version', 'work.version = p_expected_version')],
    ['upload ownership', (sql: string) => sql.replaceAll('session.owner_id <> p_actor_id', 'session.owner_id = p_actor_id')],
    ['upload expiry', (sql: string) => sql.replace('session.expires_at <= clock_timestamp()', 'session.expires_at > clock_timestamp()')],
    ['asset verification', (sql: string) => sql.replaceAll("status IN ('verified','active')", "status IN ('deleted','orphaned')")],
    ['snapshot serialization', (sql: string) => sql.replace("pg_advisory_xact_lock(hashtext('snapshot:' || p_snapshot_type))", 'TRUE')],
    ['snapshot lease', (sql: string) => sql.replaceAll('job.lease_expires_at > clock_timestamp()', 'job.lease_expires_at IS NULL')],
    ['snapshot fencing', (sql: string) => sql.replaceAll('job.lease_token <> p_lease_token', 'false')],
    ['public storage zone', (sql: string) => sql.replaceAll("AND asset.storage_zone = 'public'", '')],
    ['restricted asset policy', (sql: string) => sql.replaceAll("work.rating = 'restricted'", 'false')],
    ['restricted rating transition guard', (sql: string) => sql.replace("COALESCE(p_changes->>'rating', work.rating) = 'restricted'", 'false')],
    ['work-row promotion lock', (sql: string) => sql.replace('WHERE id = file.work_id FOR UPDATE', 'WHERE id = file.work_id FOR KEY SHARE')],
    ['original mutation replay', (sql: string) => sql.replaceAll("summary->>'status'", "'draft'")],
    ['deleted asset slot release', (sql: string) => sql.replaceAll("AND status <> 'deleted'", '')],
  ])('rejects mutation removing %s', (_name, mutate) => {
    expect(validate({ migration: mutate(migration) })).not.toEqual([]);
  });

  it('requires rollback and least-privilege runtime grants', () => {
    expect(validate({ rollback: rollback.replace('DROP TABLE IF EXISTS public.work_chapters;', '') })).not.toEqual([]);
    expect(validate({ access: access.replace('GRANT SELECT ON TABLE public.work_chapters', 'GRANT ALL ON TABLE public.work_chapters') })).not.toEqual([]);
    expect(validate({ accessRollback: accessRollback.replace('REVOKE SELECT ON TABLE public.work_chapters', 'GRANT SELECT ON TABLE public.work_chapters') })).not.toEqual([]);
    expect(validate({ accessRollback: accessRollback.replace('REVOKE EXECUTE ON FUNCTION', 'GRANT EXECUTE ON FUNCTION') })).not.toEqual([]);
    expect(validate({ rollback: rollback.replace('rollback_requires_content_export', 'unsafe_rollback') })).not.toEqual([]);
  });

  it('rejects mutations removing domain hashes, immutable COS protection, or the deployed timer', () => {
    expect(validate({ migration: migration.replace('prior_session.request_hash <> p_request_hash', 'false') })).not.toEqual([]);
    expect(validate({ migration: migration.replaceAll('job.lease_token <> p_lease_token', 'false') })).not.toEqual([]);
    expect(validate({ cosSource: cosSource.replace("'x-cos-forbid-overwrite': 'true'", "'x-cos-forbid-overwrite': 'false'") })).not.toEqual([]);
    expect(validate({ cosSource: cosSource.replace("call(cos, 'getBucketVersioning'", "call(cos, 'headBucket'") })).not.toEqual([]);
    expect(validate({ cosSource: cosSource.replace('versioning && versioning.VersioningConfiguration', 'versioning') })).not.toEqual([]);
    expect(validate({ cosSource: cosSource.replace('MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024', 'MAX_SNAPSHOT_BYTES = Infinity') })).not.toEqual([]);
    expect(validate({ migration: migration.replace('public.snapshot_current.version <= EXCLUDED.version', 'true') })).not.toEqual([]);
    expect(validate({ cloudbaseConfig: cloudbaseConfig.replace('0 */5 * * * * *', '0 0 0 1 1 * *') })).not.toEqual([]);
    expect(validate({ cloudbaseConfig: cloudbaseConfig.replace('0 */10 * * * * *', '0 0 0 1 1 * *') })).not.toEqual([]);
    expect(validate({ migration: migration.replace('cleanup_attempts=cleanup_attempts+1', 'cleanup_attempts=cleanup_attempts') })).not.toEqual([]);
    expect(validate({ cleanupWorkerSource: cleanupWorkerSource.replace('cleanupStalePromotions', 'noopCleanup') })).not.toEqual([]);
    expect(validate({ uploadsRepositorySource: uploadsRepositorySource.replace("unwrapRows(await rdb.rpc('claim_stale_upload_promotions'", "unwrap(await rdb.rpc('claim_stale_upload_promotions'") })).not.toEqual([]);
  });
});
