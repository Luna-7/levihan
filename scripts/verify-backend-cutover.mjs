import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const signature = 'public.consume_legacy_migration_credential(text,text,text,text,text,timestamptz,text)';
const beginSignature = 'public.begin_legacy_migration_claim(text,text,text)';
const prepareSignature = 'public.prepare_legacy_migration_credential(text,text,text)';
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (sql, pattern) => pattern.test(sql.replace(/--[^\n]*/g, ''));

export function validateBackendCutover({ migration, rollback, runtime, runtimeRollback, migrationAccess, migrationAccessRollback, adapter = '', runbook = '', vercel = '', proxy = '', cloudbaserc = '', deployScript = '', cosVerifier = '', authUi = '', rootRouter = '', configSource = '' }) {
  const failures = [];
  const add = (condition, message) => { if (!condition) failures.push(message); };
  add(/^BEGIN;/m.test(migration) && /COMMIT;/m.test(migration), 'cutover migration must be transactional');
  for (const table of ['legacy_identity_mappings','legacy_migration_credentials','backend_v2_migration_runs','backend_v2_migration_lock','backend_v2_migration_context','legacy_entity_mappings','migration_public_asset_deletions','legacy_forum_entries','legacy_game_entries']) {
    add(has(migration, new RegExp(`CREATE TABLE public\\.${table}\\b`, 'i')), `missing ${table}`);
    add(has(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i')), `missing ${table} RLS`);
  }
  add(has(migration, /SECURITY DEFINER SET search_path = pg_catalog, public/i), 'credential RPC must fix search_path');
  add(has(migration, /WHERE token_hash=p_credential_hash FOR UPDATE;/i), 'credential claim must be row locked');
  add(has(migration, /claim_expiry timestamptz := clock_timestamp\(\)\+interval '10 minutes'/i), 'claim session must be short lived');
  add(has(migration, /WHERE claim_session_hash=p_claim_session_hash FOR UPDATE;/i), 'credential installation must bind the claim session');
  add(has(migration, /prepared_recovery_hash<>p_recovery_code_hash/i) && has(migration, /prepare_nonce_hash<>p_prepare_nonce_hash/i) && has(migration, /prepare_expires_at<=clock_timestamp\(\)/i), 'credential installation requires a saved short-lived preparation');
  add((migration.match(/credential\.status <> 'pending'/gi) || []).length >= 2, 'claim and installation must both enforce single use');
  add((migration.match(/credential\.expires_at <= clock_timestamp\(\)/gi) || []).length >= 2, 'claim and installation must both enforce credential expiry');
  add(has(migration, /expires_at > issued_at AND expires_at <= issued_at \+ interval '14 days'/i), 'migration credentials need a database lifetime ceiling');
  add(has(migration, /delivery_ciphertext text NOT NULL/i), 'credential delivery must be transactionally persisted as ciphertext');
  add(has(migration, /source_digest text NOT NULL/i) && has(migration, /plan_digest text NOT NULL/i), 'migration runs must bind source and plan digests');
  add(has(migration, /CREATE FUNCTION public\.apply_backend_v2_migration_batch/i) && has(migration, /WHERE id=p_run_id FOR UPDATE/i), 'migration batch RPC must transact against a locked digest-bound run');
  add(has(migration, /validate_migrated_work_publication\(v_work_id,item->>'assetSetHash'/i) && has(migration, /coalesce\(c\.position::text,''\)/i) && has(migration, /GROUP BY a\.chapter_id HAVING min\(a\.page_no\)<>1/i), 'migration publication must bind the chapter-aware asset set and full page invariants');
  add(has(migration, /CREATE FUNCTION public\.collect_backend_v2_check/i) && has(migration, /publicRestrictedObjects/i), 'checker RPC must query reconciliation invariants');
  add(has(migration, /CREATE FUNCTION public\.claim_public_asset_deletion\(p_holder_id uuid/i) && has(migration, /fencing_token=public\.migration_public_asset_deletions\.fencing_token\+1/i) && has(migration, /CREATE FUNCTION public\.finalize_public_asset_deletion\(p_holder_id uuid/i) && (migration.match(/holder_id=p_holder_id AND lease_expires_at>clock_timestamp\(\)/g) || []).length >= 2, 'destructive cutover needs renewable durable fencing');
  add(has(migration, /CREATE FUNCTION public\.assert_backend_v2_migration_context/i) && has(migration, /session_user::text<>context\.allowed_role::text/i) && has(migration, /caller\.rolsuper OR caller\.rolbypassrls OR caller\.rolcreaterole OR caller\.rolcreatedb OR caller\.rolinherit/i) && has(migration, /pg_catalog\.pg_auth_members/i) && has(migration, /FROM pg_catalog\.pg_class object/i) && has(migration, /has_table_privilege\(session_user,format\('%I\.%I',namespace\.nspname,object\.relname\),'INSERT,UPDATE,DELETE,TRUNCATE'\)/i) && has(migration, /FROM pg_catalog\.pg_proc routine/i), 'migration RPC identity must reject inherited, high privilege, ownership, and direct DML on every public object');
  add(has(migration, /app_user\.credential_state <> 'migration_required'/i), 'only migrated accounts may claim');
  add(has(migration, /VALUES\(app_user\.id,p_session_token_hash,p_session_expires_at,NULL,p_ip_hash\)/i), 'new session must require recovery confirmation');
  add(has(migration, new RegExp(`REVOKE EXECUTE ON FUNCTION ${escaped(beginSignature)} FROM PUBLIC`, 'i')) && migration.includes(prepareSignature) && migration.includes(signature), 'credential RPCs must be revoked from PUBLIC');
  add(has(runtime, new RegExp(`GRANT EXECUTE ON FUNCTION ${escaped(beginSignature)} TO`, 'i')) && runtime.includes(prepareSignature) && runtime.includes(signature), 'runtime must receive exact credential RPCs');
  add(!/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]{0,120}legacy_migration_credentials/i.test(runtime), 'runtime must not receive credential table DML');
  add(has(runtimeRollback, new RegExp(`REVOKE EXECUTE ON FUNCTION ${escaped(beginSignature)} FROM`, 'i')) && runtimeRollback.includes(prepareSignature) && runtimeRollback.includes(signature), 'runtime rollback must revoke exact RPCs');
  add(has(rollback, /EXISTS\(SELECT 1 FROM public\.legacy_identity_mappings\)/i) && has(rollback, /EXISTS\(SELECT 1 FROM public\.legacy_migration_credentials\)/i), 'rollback must fence migrated identities and claims');
  add(has(rollback, /EXISTS\(SELECT 1 FROM public\.migration_public_asset_deletions\)/i) && has(rollback, /EXISTS\(SELECT 1 FROM public\.legacy_entity_mappings\)/i), 'rollback must fence migrated entities and cutover records');
  add(has(migrationAccess, /REVOKE ALL ON TABLE[\s\S]*FROM :"migration_role"/i), 'migration role must not receive direct table DML');
  add(has(migrationAccess, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA public/i) && has(migrationAccess, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public/i) && migrationAccess.includes('public.work_chapters') && migrationAccess.includes('public.snapshot_current'), 'migration role must revoke all inherited table, sequence, and function privileges');
  for (const fn of ['assert_backend_v2_migration_context','claim_backend_v2_migration_lock','begin_backend_v2_migration_run','apply_backend_v2_migration_batch','collect_backend_v2_check','collect_backend_v2_snapshot_manifest','export_backend_v2_credential_envelopes','claim_public_asset_deletion','finalize_public_asset_deletion']) {
    add(migrationAccess.includes(fn) && migrationAccessRollback.includes(fn), `migration role grant/rollback missing ${fn}`);
  }
  add(has(rollback, new RegExp(`DROP FUNCTION IF EXISTS ${escaped(beginSignature)}`, 'i')) && rollback.includes(prepareSignature) && rollback.includes(signature), 'rollback must drop exact credential RPCs');
  add(adapter.includes("'CLOUDBASE_APIKEY'") && adapter.includes("'MIGRATION_EXPECTED_DB_ROLE'") && adapter.includes("'DATABASE_SCHEMA'") && adapter.includes("'assert_backend_v2_migration_context'"), 'adapter must bind explicit identity, schema, role, and database context');
  add(adapter.includes("p_holder_id: holderId") && adapter.includes("Cutover lock lease lost"), 'adapter must renew and bind the destructive cutover lease');
  add(proxy.includes('CLOUDBASE_API_BASE_URL') && proxy.includes("url.protocol !== 'https:'") && proxy.includes("!== '/api/v1'") && proxy.includes("'idempotency-key'") && proxy.includes('x-lv-proxy-signature') && proxy.includes('API_PROXY_HMAC_SECRET'), 'Vercel API proxy must pin an HTTPS gateway and preserve signed request identity');
  add(vercel.includes('api/v1/[...path].ts'), 'Vercel must deploy the same-origin API proxy');
  add(cloudbaserc.includes('{{env.CLOUDBASE_ENV_ID}}') && !cloudbaserc.includes('levihan-tudou-'), 'CloudBase deployment must not hardcode an environment id');
  add(deployScript.includes('CLOUDBASE_PROD_ENV_ID') && deployScript.includes("['fn', 'deploy'") && deployScript.includes("['fn', 'detail'") && deployScript.includes("resolve(import.meta.dirname, '..', 'cloudbase')"), 'CloudBase deployment must use trusted env mapping and official CLI from cloudbase cwd');
  add(cosVerifier.includes('publicBucketPublicGrant') && cosVerifier.includes("['GET','POST','PUT']") && cosVerifier.includes("x-cos-meta-sha256") && cosVerifier.includes('public bucket policy is not least privilege'), 'COS read-back must validate both buckets, public policy, and real browser upload CORS');
  add(adapter.includes('does not cover every canonical object'), 'restricted COS prefixes must cover every canonical source key');
  add(rootRouter.includes("#/migrate-account") && authUi.includes('LegacyMigrationPage') && authUi.includes('prepareNonce'), 'legacy migration must have a reachable three-stage frontend');
  add(!/environment === 'production' && !sessionCookieDomain/.test(configSource) && configSource.includes('proxyHmacSecret'), 'production must support host-only cookies and signed proxy identity');
  for (const evidence of ['deploy:cloudbase-v2','generate:r18-cutover-manifest','verify:cos-backend-v2','migration_access_rollback.sql','MIGRATION_EXPECTED_DB_ROLE','CLOUDBASE_API_BASE_URL','openssl genpkey']) add(runbook.includes(evidence), `runbook missing ${evidence}`);
  return failures;
}

function main() {
  const root = resolve(import.meta.dirname, '..', 'cloudbase', 'migrations');
  const input = {
    migration: readFileSync(resolve(root, '20260918_backend_v2_cutover.sql'), 'utf8'),
    rollback: readFileSync(resolve(root, '20260918_backend_v2_cutover_rollback.sql'), 'utf8'),
    runtime: readFileSync(resolve(root, '20260918_backend_v2_cutover_runtime_access.sql'), 'utf8'),
    runtimeRollback: readFileSync(resolve(root, '20260918_backend_v2_cutover_runtime_access_rollback.sql'), 'utf8'),
    migrationAccess: readFileSync(resolve(root, '20260918_backend_v2_cutover_migration_access.sql'), 'utf8'),
    migrationAccessRollback: readFileSync(resolve(root, '20260918_backend_v2_cutover_migration_access_rollback.sql'), 'utf8'),
    adapter: readFileSync(resolve(root, '..', '..', 'scripts', 'adapters', 'backend-v2-cloudbase.mjs'), 'utf8'),
    runbook: readFileSync(resolve(root, '..', '..', 'docs', 'operations', 'backend-v2-runbook.md'), 'utf8'),
    vercel: readFileSync(resolve(root, '..', '..', 'vercel.json'), 'utf8'),
    proxy: readFileSync(resolve(root, '..', '..', 'api', 'v1', '[...path].ts'), 'utf8'),
    cloudbaserc: readFileSync(resolve(root, '..', 'cloudbaserc.json'), 'utf8'),
    deployScript: readFileSync(resolve(root, '..', '..', 'scripts', 'deploy-cloudbase-v2.mjs'), 'utf8'),
    cosVerifier: readFileSync(resolve(root, '..', '..', 'scripts', 'verify-cos-backend-v2.mjs'), 'utf8'),
    authUi: readFileSync(resolve(root, '..', '..', 'src', 'features', 'auth', 'LegacyMigrationPage.tsx'), 'utf8'),
    rootRouter: readFileSync(resolve(root, '..', '..', 'src', 'RootRouter.tsx'), 'utf8'),
    configSource: readFileSync(resolve(root, '..', 'functions', 'app-api', 'src', 'config.js'), 'utf8'),
  };
  const failures = validateBackendCutover(input);
  if (failures.length) { process.stderr.write(`backend cutover verification failed:\n${failures.map((value) => `- ${value}`).join('\n')}\n`); process.exitCode = 1; }
  else process.stdout.write('backend cutover static verification passed\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
