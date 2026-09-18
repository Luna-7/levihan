import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateBackendCutover } from './verify-backend-cutover.mjs';

const root = resolve(import.meta.dirname, '..');
const files = () => ({
  migration: readFileSync(resolve(root, 'cloudbase/migrations/20260918_backend_v2_cutover.sql'), 'utf8'),
  rollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_backend_v2_cutover_rollback.sql'), 'utf8'),
  runtime: readFileSync(resolve(root, 'cloudbase/migrations/20260918_backend_v2_cutover_runtime_access.sql'), 'utf8'),
  runtimeRollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_backend_v2_cutover_runtime_access_rollback.sql'), 'utf8'),
  migrationAccess: readFileSync(resolve(root, 'cloudbase/migrations/20260918_backend_v2_cutover_migration_access.sql'), 'utf8'),
  migrationAccessRollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_backend_v2_cutover_migration_access_rollback.sql'), 'utf8'),
  adapter: readFileSync(resolve(root, 'scripts/adapters/backend-v2-cloudbase.mjs'), 'utf8'),
  runbook: readFileSync(resolve(root, 'docs/operations/backend-v2-runbook.md'), 'utf8'),
  vercel: readFileSync(resolve(root, 'vercel.json'), 'utf8'),
  proxy: readFileSync(resolve(root, 'api/v1/[...path].ts'), 'utf8'),
  cloudbaserc: readFileSync(resolve(root, 'cloudbase/cloudbaserc.json'), 'utf8'),
  deployScript: readFileSync(resolve(root, 'scripts/deploy-cloudbase-v2.mjs'), 'utf8'),
  cosVerifier: readFileSync(resolve(root, 'scripts/verify-cos-backend-v2.mjs'), 'utf8'),
  authUi: readFileSync(resolve(root, 'src/features/auth/LegacyMigrationPage.tsx'), 'utf8'),
  rootRouter: readFileSync(resolve(root, 'src/RootRouter.tsx'), 'utf8'),
  configSource: readFileSync(resolve(root, 'cloudbase/functions/app-api/src/config.js'), 'utf8'),
});

describe('backend v2 cutover schema', () => {
  it('validates migration credentials, least privilege, and rollback fences', () => {
    expect(validateBackendCutover(files())).toEqual([]);
  });

  it.each([
    ['single use', 'migration', (sql: string) => sql.replace("credential.status <> 'pending'", 'false')],
    ['expiry', 'migration', (sql: string) => sql.replace('credential.expires_at <= clock_timestamp()', 'false')],
    ['row lock', 'migration', (sql: string) => sql.replace('FOR UPDATE;\n  IF NOT FOUND OR credential.status', ';\n  IF NOT FOUND OR credential.status')],
    ['recovery unconfirmed', 'migration', (sql: string) => sql.replace(',NULL,p_ip_hash)', ',clock_timestamp(),p_ip_hash)')],
    ['public revoke', 'migration', (sql: string) => sql.replace('public.consume_legacy_migration_credential(text,text,text,text,text,timestamptz,text)', 'public.removed_consume(text)')],
    ['runtime function grant', 'runtime', (sql: string) => sql.replace('consume_legacy_migration_credential', 'missing_consume_legacy_migration_credential')],
    ['direct DML bypass', 'runtime', (sql: string) => sql.replace('COMMIT;', 'GRANT INSERT ON public.legacy_migration_credentials TO :"backend_role";\nCOMMIT;')],
    ['rollback data fence', 'rollback', (sql: string) => sql.replace('legacy_migration_credentials', 'missing_legacy_migration_credentials')],
    ['runtime rollback signature', 'runtimeRollback', (sql: string) => sql.replace('(text,text,text,text,text,timestamptz,text)', '(text,text,text,text,text,text,text)')],
    ['credential lifetime ceiling', 'migration', (sql: string) => sql.replace("expires_at <= issued_at + interval '14 days'", 'true')],
    ['run plan digest', 'migration', (sql: string) => sql.replace('plan_digest text NOT NULL', 'plan_digest text')],
    ['cutover fencing', 'migration', (sql: string) => sql.replace('fencing_token=public.migration_public_asset_deletions.fencing_token+1', 'fencing_token=1')],
    ['migration role batch grant', 'migrationAccess', (sql: string) => sql.replace('apply_backend_v2_migration_batch', 'removed_batch_rpc')],
    ['migration role rollback', 'migrationAccessRollback', (sql: string) => sql.replace('finalize_public_asset_deletion', 'removed_finalize_rpc')],
    ['asset-set publication fence', 'migration', (sql: string) => sql.replace("validate_migrated_work_publication(v_work_id,item->>'assetSetHash'", "validate_migrated_work_publication(v_work_id,'0'")],
    ['chapter-aware asset set', 'migration', (sql: string) => sql.replace("coalesce(c.position::text,'')", "''")],
    ['migration role sequence revoke', 'migrationAccess', (sql: string) => sql.replace('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public', 'SELECT 1')],
    ['credential envelope export rollback', 'migrationAccessRollback', (sql: string) => sql.replace('export_backend_v2_credential_envelopes', 'removed_export_rpc')],
    ['migration caller identity', 'migration', (sql: string) => sql.replace('session_user::text<>context.allowed_role::text', 'false')],
    ['overprivileged migration caller', 'migration', (sql: string) => sql.replace('caller.rolsuper OR caller.rolbypassrls OR caller.rolcreaterole OR caller.rolcreatedb OR caller.rolinherit', 'false')],
    ['migration ownership and all-table DML', 'migration', (sql: string) => sql.replace('FROM pg_catalog.pg_class object', 'FROM pg_catalog.pg_class removed_object')],
    ['cutover lock ownership', 'migration', (sql: string) => sql.replaceAll('holder_id=p_holder_id AND lease_expires_at>clock_timestamp()', 'true')],
    ['adapter database identity', 'adapter', (value: string) => value.replace("'MIGRATION_EXPECTED_DB_ROLE'", "'REMOVED_ROLE'")],
    ['same-origin API proxy', 'proxy', (value: string) => value.replace("url.protocol !== 'https:'", 'false')],
    ['CloudBase explicit environment', 'cloudbaserc', (value: string) => value.replace('{{env.CLOUDBASE_ENV_ID}}', 'levihan-tudou-hardcoded')],
    ['proxy idempotency forwarding', 'proxy', (value: string) => value.replace("'idempotency-key',", '')],
    ['trusted deploy environment mapping', 'deployScript', (value: string) => value.replace('CLOUDBASE_PROD_ENV_ID', 'REMOVED_PROD_ENV_ID')],
    ['public bucket CORS readback', 'cosVerifier', (value: string) => value.replace('publicBucketPublicGrant', 'removedPublicGrant')],
    ['public bucket policy readback', 'cosVerifier', (value: string) => value.replace('public bucket policy is not least privilege', 'removed policy check')],
    ['legacy migration frontend', 'rootRouter', (value: string) => value.replace('#/migrate-account', '#/removed')],
  ])('rejects %s mutation', (_name, artifact, mutate) => {
    const input = files();
    input[artifact as keyof typeof input] = mutate(input[artifact as keyof typeof input]);
    expect(validateBackendCutover(input).length).toBeGreaterThan(0);
  });
});
