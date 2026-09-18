import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripSqlComments } from './verify-backend-schema.mjs';

const root = resolve(import.meta.dirname, '..');
const ROUTINES = [
  ['create_work_draft', 'text,text,text,text,text,text,uuid,text,text'],
  ['update_work_draft', 'uuid,bigint,jsonb,jsonb,uuid,text,text'],
  ['transition_work_state', 'uuid,bigint,text,text,text,uuid,text,text'],
  ['create_work_upload', 'uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,integer,text,timestamptz,text,text,text'],
  ['get_work_upload_for_completion', 'uuid,uuid'],
  ['begin_work_upload_promotion', 'uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,text'],
  ['complete_work_upload', 'uuid,uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,text,integer,text,text'],
  ['begin_snapshot_build', 'text,uuid,text,text'], ['list_public_catalog', ''],
  ['prepare_snapshot_version', 'uuid,uuid,text,bigint,text,text'], ['complete_snapshot_build', 'uuid,uuid,uuid,text'],
  ['fail_snapshot_build', 'uuid,uuid,text'], ['get_current_snapshot', 'text'], ['claim_stale_upload_promotions', 'uuid,integer'], ['finalize_upload_promotion_cleanup', 'uuid,uuid,uuid'], ['get_admin_work', 'uuid'], ['get_public_work', 'text'],
  ['list_admin_works', 'integer,text,text'],
];

const compact = (value) => value.replace(/\s+/g, '');
const has = (sql, expression) => expression.test(sql);
const add = (failures, condition, message) => { if (!condition) failures.push(message); };

function routineDefinition(sql, name) {
  return sql.match(new RegExp(`CREATE\\s+FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] || '';
}

export function validateContentPipeline({ migration, rollback, access, accessRollback = '', cosSource = '', cloudbaseConfig = '' }) {
  const failures = [];
  const sql = stripSqlComments(migration);
  const down = stripSqlComments(rollback);
  const grants = stripSqlComments(access);
  const grantRollback = stripSqlComments(accessRollback);
  add(failures, /^BEGIN;/i.test(sql.trim()) && /COMMIT;\s*$/i.test(sql.trim()), 'migration transaction is required');
  add(failures, /^BEGIN;/i.test(down.trim()) && /COMMIT;\s*$/i.test(down.trim()), 'rollback transaction is required');
  add(failures, has(sql, /CREATE\s+TABLE\s+public\.work_chapters/i), 'work_chapters is required');
  add(failures, has(sql, /UNIQUE\s*\(\s*work_id\s*,\s*position\s*\)\s+DEFERRABLE/i), 'chapter order must be uniquely and transactionally reorderable');
  add(failures, has(sql, /version\s+bigint\s+NOT\s+NULL[\s\S]*?CHECK\s*\(\s*version\s*>\s*0\s*\)/i), 'chapter version is required');
  add(failures, has(sql, /ALTER\s+TABLE\s+public\.work_chapters\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i), 'chapter RLS is required');
  add(failures, has(sql, /CREATE\s+INDEX\s+work_chapters_work_status_idx/i), 'chapter list index is required');
  add(failures, has(sql, /ADD\s+COLUMN\s+chapter_id\s+uuid\s+REFERENCES\s+public\.work_chapters/i), 'assets must support chapters');
  add(failures, has(sql, /expected_checksum\s+text/i) && has(sql, /upload_files_expected_checksum_format/i), 'upload checksum declaration is required');
  add(failures, has(sql, /ADD\s+COLUMN\s+storage_zone\s+text/i) && has(sql, /work_assets_zone_key/i), 'physical storage zone binding is required');
  add(failures, has(sql, /work_assets_root_cover_key/i) && has(sql, /work_assets_chapter_body_key/i) && has(sql, /work_assets_chapter_page_key/i), 'nullable asset slots need targeted unique indexes');
  add(failures, (sql.match(/CREATE\s+UNIQUE\s+INDEX\s+work_assets_(?:root|chapter)_[\s\S]*?;/gi) || []).every((definition) => /status\s*<>\s*'deleted'/i.test(definition)), 'deleted assets must not reserve unique content slots');
  add(failures, has(sql, /snapshot_jobs_one_active_type[\s\S]*?status\s+IN\s*\(\s*'running'\s*,\s*'prepared'\s*\)/i), 'snapshot type needs one active job');
  add(failures, /CREATE\s+TABLE\s+public\.snapshot_current/i.test(sql), 'PostgreSQL current snapshot pointer is required');

  for (const [name, signature] of ROUTINES) {
    const definition = routineDefinition(sql, name);
    add(failures, Boolean(definition), `missing routine ${name}`);
    add(failures, /SECURITY\s+DEFINER/i.test(definition) && /SET\s+search_path\s*=\s*pg_catalog\s*,\s*public/i.test(definition), `${name} must be a pinned definer routine`);
    add(failures, compact(sql).toLowerCase().includes(compact(`REVOKE EXECUTE ON FUNCTION public.${name}(${signature}) FROM PUBLIC;`).toLowerCase()), `${name} PUBLIC execute must be revoked`);
    add(failures, compact(grants).toLowerCase().includes(compact(`public.${name}(${signature})`).toLowerCase()), `${name} runtime grant is missing`);
  }

  const createWork = routineDefinition(sql, 'create_work_draft');
  const updateWork = routineDefinition(sql, 'update_work_draft');
  const transition = routineDefinition(sql, 'transition_work_state');
  const uploadCreate = routineDefinition(sql, 'create_work_upload');
  const uploadComplete = routineDefinition(sql, 'complete_work_upload');
  const uploadPromote = routineDefinition(sql, 'begin_work_upload_promotion');
  const snapshotBegin = routineDefinition(sql, 'begin_snapshot_build');
  const snapshotPrepare = routineDefinition(sql, 'prepare_snapshot_version');
  add(failures, /actor\.role\s*<>\s*'admin'/i.test(createWork) && /actor\.role\s*<>\s*'admin'/i.test(transition) && /actor\.role\s*<>\s*'admin'/i.test(uploadComplete), 'admin authorization must be enforced in database routines');
  add(failures, /work\.version\s*<>\s*p_expected_version/i.test(updateWork) && /work\.version\s*<>\s*p_expected_version/i.test(transition), 'work optimistic locking is required');
  add(failures, /INSERT\s+INTO\s+public\.audit_logs/i.test(createWork) && /INSERT\s+INTO\s+public\.audit_logs/i.test(updateWork) && /INSERT\s+INTO\s+public\.audit_logs/i.test(transition), 'every admin work mutation must be audited');
  add(failures, /INSERT\s+INTO\s+public\.work_versions/i.test(transition) && /INSERT\s+INTO\s+public\.snapshot_jobs/i.test(transition), 'publishing must retain a version and queue a snapshot atomically');
  add(failures, /status\s+IN\s*\(\s*'verified'\s*,\s*'active'\s*\)/i.test(transition) && /assets_incomplete/i.test(transition) && !/asset\.status\s*<>\s*'verified'/i.test(transition), 'publishing must consider only participating verified/active assets');
  add(failures, /session\.owner_id\s*<>\s*p_actor_id/i.test(uploadComplete), 'upload completion must validate ownership');
  add(failures, /session\.purpose\s*<>\s*'work_asset'/i.test(uploadComplete), 'upload completion must validate purpose');
  add(failures, /session\.expires_at\s*<=\s*clock_timestamp\(\)/i.test(uploadPromote), 'upload promotion must validate expiry');
  add(failures, /file\.expected_size\s*<>\s*p_actual_size/i.test(uploadComplete) && /file\.expected_checksum\s*<>\s*p_checksum/i.test(uploadComplete), 'upload completion must validate metadata');
  add(failures, /status\s*=\s*'promoting'/i.test(uploadPromote) && /promotion_token\s*=\s*p_promotion_token/i.test(uploadPromote) && /upload_files_promotion_cleanup_idx/i.test(sql), 'upload copy must have a durable fenced promotion record');
  add(failures, /prior_session\.request_hash\s*<>\s*p_request_hash/i.test(uploadCreate) && /ON\s+CONFLICT\s*\(\s*owner_id\s*,\s*purpose\s*,\s*idempotency_key\s*\)/i.test(uploadCreate), 'upload domain idempotency must atomically acquire and compare request hashes');
  add(failures, /prior_file\.status\s*=\s*'promoting'[\s\S]*?'promoting'::text/i.test(uploadCreate), 'promoting upload replay must return processing identity without a staging ticket');
  add(failures, /work\.rating\s*=\s*'restricted'[\s\S]*?asset_policy_invalid/i.test(transition), 'restricted publication must enforce private original assets');
  add(failures, /COALESCE\(p_changes->>'rating',\s*work\.rating\)\s*=\s*'restricted'/i.test(updateWork) && /restricted_storage_invalid/i.test(updateWork), 'rating changes must reject existing public originals and pending uploads');
  add(failures, /FROM\s+public\.works\s+WHERE\s+id\s*=\s*file\.work_id\s+FOR\s+UPDATE/i.test(uploadPromote) && /FROM\s+public\.works\s+WHERE\s+id\s*=\s*p_work_id[\s\S]*?FOR\s+UPDATE/i.test(uploadComplete), 'promotion and finalize must serialize on the work row');
  add(failures, /jsonb_build_object\(\s*'id'\s*,\s*work\.id\s*,\s*'status'\s*,\s*work\.status/i.test(updateWork) && /summary->>'status'/i.test(updateWork), 'work replay must use the original audited response projection');
  add(failures, /p_object_key\s*<>\s*'staging\/admin\/'\s*\|\|\s*p_upload_id/i.test(uploadCreate), 'server staging prefix must be enforced');
  add(failures, /pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*'snapshot:'\s*\|\|\s*p_snapshot_type\s*\)\s*\)/i.test(snapshotBegin), 'snapshot versions must be serialized');
  add(failures, /lease_expires_at\s*>\s*clock_timestamp\(\)/i.test(snapshotBegin) && /delivery_version/i.test(snapshotBegin), 'snapshot jobs must use renewable delivery leases');
  add(failures, /lease_token\s*=\s*gen_random_uuid\(\)/i.test(snapshotBegin) && /lease_epoch\s*=\s*lease_epoch\s*\+\s*1/i.test(snapshotBegin), 'snapshot claims must rotate a fencing token and epoch');
  add(failures, /job\.lease_token\s*<>\s*p_lease_token/i.test(snapshotPrepare)
    && /job\.lease_token\s*<>\s*p_lease_token/i.test(routineDefinition(sql, 'complete_snapshot_build'))
    && /lease_token\s*=\s*p_lease_token/i.test(routineDefinition(sql, 'fail_snapshot_build')), 'all snapshot writes must enforce the fencing token');
  add(failures, /INSERT\s+INTO\s+public\.snapshot_versions/i.test(snapshotPrepare), 'snapshot versions must be retained before pointer switch');
  add(failures, /UPDATE\s+public\.snapshot_jobs\s+SET\s+status\s*=\s*'prepared'/i.test(snapshotPrepare), 'snapshot build must persist a prepared state before switching current');
  add(failures, /job\.status\s*<>\s*'prepared'/i.test(routineDefinition(sql, 'complete_snapshot_build')), 'snapshot completion must require a prepared immutable version');
  add(failures, /INSERT\s+INTO\s+public\.snapshot_current/i.test(routineDefinition(sql, 'complete_snapshot_build')) && /snapshot_current\.version\s*<=\s*EXCLUDED\.version/i.test(routineDefinition(sql, 'complete_snapshot_build')), 'snapshot completion must atomically advance a monotonic PostgreSQL pointer');
  add(failures, /build_generated_at\s*=\s*COALESCE\(build_generated_at/i.test(snapshotBegin) && /source_revision\s+bigint/i.test(snapshotBegin), 'snapshot retries must retain build time and source revision');
  add(failures, /status='cleanup_pending'/i.test(routineDefinition(sql,'claim_stale_upload_promotions')) && /cleanup_token=p_cleanup_token/i.test(routineDefinition(sql,'finalize_upload_promotion_cleanup')), 'promotion cleanup must be claimed and token fenced');
  add(failures, /rollback_requires_content_export/i.test(down) && down.indexOf('rollback_requires_content_export') < down.indexOf('DROP FUNCTION'), 'rollback compatibility preflight must run before destructive changes');
  add(failures, /work\.rating\s*<>\s*'restricted'/i.test(routineDefinition(sql, 'list_public_catalog')), 'restricted works must be excluded from public snapshots');
  add(failures, /asset\.access_level\s*=\s*'public'/i.test(routineDefinition(sql, 'list_public_catalog')), 'private assets must be excluded from public snapshots');
  add(failures, /asset\.storage_zone\s*=\s*'public'/i.test(routineDefinition(sql, 'list_public_catalog')) && /asset\.storage_zone\s*=\s*'public'/i.test(routineDefinition(sql, 'get_public_work')), 'public reads must enforce the public storage zone');
  add(failures, /'chapterPosition'\s*,\s*chapter\.position/i.test(routineDefinition(sql, 'list_public_catalog')), 'public snapshots must use chapter positions instead of internal IDs');

  add(failures, /DROP\s+TRIGGER\s+IF\s+EXISTS\s+work_chapters_set_updated_at/i.test(down), 'rollback must drop trigger first');
  for (const [name, signature] of [...ROUTINES].reverse()) add(failures, compact(down).toLowerCase().includes(compact(`DROP FUNCTION IF EXISTS public.${name}(${signature});`).toLowerCase()), `rollback must drop ${name}`);
  add(failures, /DROP\s+TABLE\s+IF\s+EXISTS\s+public\.work_chapters/i.test(down), 'rollback must drop work_chapters');
  add(failures, /DROP\s+COLUMN\s+IF\s+EXISTS\s+delivery_version/i.test(down) && /DROP\s+COLUMN\s+IF\s+EXISTS\s+idempotency_key/i.test(down), 'rollback must remove snapshot and idempotency additions');
  add(failures, /DROP\s+COLUMN\s+IF\s+EXISTS\s+lease_token/i.test(down) && /DROP\s+COLUMN\s+IF\s+EXISTS\s+promotion_token/i.test(down) && /DROP\s+COLUMN\s+IF\s+EXISTS\s+request_hash/i.test(down), 'rollback must remove fencing and domain acquire fields');
  add(failures, /REVOKE\s+INSERT\s*,\s*UPDATE\s*,\s*DELETE\s+ON\s+TABLE\s+public\.works/i.test(grants), 'direct content writes must be revoked');
  add(failures, !/GRANT\s+ALL/i.test(grants), 'runtime grants must not use ALL');
  add(failures, /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.work_chapters/i.test(grants), 'chapter runtime select grant is required');
  add(failures, /CREATE\s+POLICY\s+content_pipeline_runtime_select[\s\S]*?FOR\s+SELECT/i.test(grants) && !/FOR\s+ALL/i.test(grants), 'chapter RLS must mirror the read-only grant');
  add(failures, /DROP\s+POLICY\s+IF\s+EXISTS\s+content_pipeline_runtime_select\s+ON\s+public\.work_chapters/i.test(grantRollback), 'runtime rollback must remove its chapter policy');
  add(failures, /REVOKE\s+SELECT\s+ON\s+TABLE\s+public\.work_chapters\s+FROM/i.test(grantRollback), 'runtime rollback must remove its chapter grant');
  add(failures, /REVOKE\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?public\.create_work_draft/i.test(grantRollback), 'runtime rollback must remove content routine execution');
  add(failures, /GRANT\s+INSERT\s+ON\s+TABLE\s+public\.works[\s\S]*?public\.audit_logs\s+TO\s+:"backend_role"/i.test(grantRollback) && !/GRANT\s+INSERT[\s\S]*?snapshot_current/i.test(grantRollback), 'runtime rollback must restore only base INSERT grants');
  add(failures, /GRANT\s+UPDATE\s+ON\s+TABLE\s+public\.works[\s\S]*?public\.snapshot_jobs\s+TO\s+:"backend_role"/i.test(grantRollback), 'runtime rollback must restore base UPDATE grants');
  if (cosSource) {
    add(failures, /x-cos-forbid-overwrite'\s*:\s*'true'/i.test(cosSource), 'immutable snapshots need COS forbid-overwrite');
    add(failures, /getBucketVersioning/i.test(cosSource) && /Status[\s\S]*enabled/i.test(cosSource), 'immutable snapshot publication must reject bucket versioning');
    add(failures, /FileAlreadyExists/i.test(cosSource) && /JSON\.parse\(actual\.toString/i.test(cosSource), 'immutable conflicts must read and validate existing bytes');
    add(failures, !/putManifest|getManifest|IfMatch|IfNoneMatch/i.test(cosSource), 'mutable COS manifests and unsupported conditional headers must be absent');
  }
  if (cloudbaseConfig) {
    add(failures, /"name"\s*:\s*"snapshot-worker"[\s\S]*?"type"\s*:\s*"Event"[\s\S]*?"dir"\s*:\s*"app-api"[\s\S]*?"triggers"[\s\S]*?0 \*\/5 \* \* \* \* \*/i.test(cloudbaseConfig), 'snapshot worker needs a five-minute private Event trigger');
  }
  return failures;
}

export function verifyContentPipelineFromFiles() {
  return validateContentPipeline({
    migration: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline.sql'), 'utf8'),
    rollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline_rollback.sql'), 'utf8'),
    access: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline_runtime_access.sql'), 'utf8'),
    accessRollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline_runtime_access_rollback.sql'), 'utf8'),
    cosSource: readFileSync(resolve(root, 'cloudbase/functions/app-api/src/infrastructure/cos.js'), 'utf8'),
    cloudbaseConfig: readFileSync(resolve(root, 'cloudbase/cloudbaserc.json'), 'utf8'),
  });
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  const failures = verifyContentPipelineFromFiles();
  if (failures.length) { console.error(`content pipeline verification failed:\n- ${failures.join('\n- ')}`); process.exitCode = 1; }
  else console.log('content pipeline static verification passed');
}
