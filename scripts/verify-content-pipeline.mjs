import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripSqlComments } from './verify-backend-schema.mjs';

const root = resolve(import.meta.dirname, '..');
const ROUTINES = [
  ['create_work_draft', 'text,text,text,text,text,text,uuid,text,text'],
  ['update_work_draft', 'uuid,bigint,jsonb,jsonb,uuid,text,text'],
  ['transition_work_state', 'uuid,bigint,text,text,text,uuid,text,text'],
  ['create_work_upload', 'uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,integer,text,timestamptz,text,text'],
  ['get_work_upload_for_completion', 'uuid,uuid'],
  ['complete_work_upload', 'uuid,uuid,uuid,uuid,uuid,text,text,text,bigint,text,text,text,text,integer,text,text'],
  ['begin_snapshot_build', 'text,uuid,text,text'], ['list_public_catalog', ''],
  ['prepare_snapshot_version', 'uuid,text,bigint,text,text'], ['complete_snapshot_build', 'uuid,uuid,text'],
  ['fail_snapshot_build', 'uuid,text'], ['get_admin_work', 'uuid'], ['get_public_work', 'text'],
  ['list_admin_works', 'integer,text,text'],
];

const compact = (value) => value.replace(/\s+/g, '');
const has = (sql, expression) => expression.test(sql);
const add = (failures, condition, message) => { if (!condition) failures.push(message); };

function routineDefinition(sql, name) {
  return sql.match(new RegExp(`CREATE\\s+FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] || '';
}

export function validateContentPipeline({ migration, rollback, access, accessRollback = '' }) {
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
  add(failures, has(sql, /snapshot_jobs_one_active_type[\s\S]*?status\s+IN\s*\(\s*'running'\s*,\s*'prepared'\s*\)/i), 'snapshot type needs one active job');

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
  const snapshotBegin = routineDefinition(sql, 'begin_snapshot_build');
  const snapshotPrepare = routineDefinition(sql, 'prepare_snapshot_version');
  add(failures, /actor\.role\s*<>\s*'admin'/i.test(createWork) && /actor\.role\s*<>\s*'admin'/i.test(transition) && /actor\.role\s*<>\s*'admin'/i.test(uploadComplete), 'admin authorization must be enforced in database routines');
  add(failures, /work\.version\s*<>\s*p_expected_version/i.test(updateWork) && /work\.version\s*<>\s*p_expected_version/i.test(transition), 'work optimistic locking is required');
  add(failures, /INSERT\s+INTO\s+public\.audit_logs/i.test(createWork) && /INSERT\s+INTO\s+public\.audit_logs/i.test(updateWork) && /INSERT\s+INTO\s+public\.audit_logs/i.test(transition), 'every admin work mutation must be audited');
  add(failures, /INSERT\s+INTO\s+public\.work_versions/i.test(transition) && /INSERT\s+INTO\s+public\.snapshot_jobs/i.test(transition), 'publishing must retain a version and queue a snapshot atomically');
  add(failures, /asset\.status\s*<>\s*'verified'/i.test(transition) && /assets_incomplete/i.test(transition), 'publishing must reject incomplete assets');
  add(failures, /session\.owner_id\s*<>\s*p_actor_id/i.test(uploadComplete), 'upload completion must validate ownership');
  add(failures, /session\.purpose\s*<>\s*'work_asset'/i.test(uploadComplete), 'upload completion must validate purpose');
  add(failures, /session\.expires_at\s*<=\s*clock_timestamp\(\)/i.test(uploadComplete), 'upload completion must validate expiry');
  add(failures, /file\.expected_size\s*<>\s*p_actual_size/i.test(uploadComplete) && /file\.expected_checksum\s*<>\s*p_checksum/i.test(uploadComplete), 'upload completion must validate metadata');
  add(failures, /p_object_key\s*<>\s*'staging\/admin\/'\s*\|\|\s*p_upload_id/i.test(uploadCreate), 'server staging prefix must be enforced');
  add(failures, /pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*'snapshot:'\s*\|\|\s*p_snapshot_type\s*\)\s*\)/i.test(snapshotBegin), 'snapshot versions must be serialized');
  add(failures, /lease_expires_at\s*>\s*clock_timestamp\(\)/i.test(snapshotBegin) && /delivery_version/i.test(snapshotBegin), 'snapshot jobs must use renewable delivery leases');
  add(failures, /INSERT\s+INTO\s+public\.snapshot_versions/i.test(snapshotPrepare), 'snapshot versions must be retained before pointer switch');
  add(failures, /UPDATE\s+public\.snapshot_jobs\s+SET\s+status\s*=\s*'prepared'/i.test(snapshotPrepare), 'snapshot build must persist a prepared state before switching current');
  add(failures, /job\.status\s*<>\s*'prepared'/i.test(routineDefinition(sql, 'complete_snapshot_build')), 'snapshot completion must require a prepared immutable version');
  add(failures, /work\.rating\s*<>\s*'restricted'/i.test(routineDefinition(sql, 'list_public_catalog')), 'restricted works must be excluded from public snapshots');
  add(failures, /asset\.access_level\s*=\s*'public'/i.test(routineDefinition(sql, 'list_public_catalog')), 'private assets must be excluded from public snapshots');
  add(failures, /asset\.storage_zone\s*=\s*'public'/i.test(routineDefinition(sql, 'list_public_catalog')) && /asset\.storage_zone\s*=\s*'public'/i.test(routineDefinition(sql, 'get_public_work')), 'public reads must enforce the public storage zone');
  add(failures, /'chapterPosition'\s*,\s*chapter\.position/i.test(routineDefinition(sql, 'list_public_catalog')), 'public snapshots must use chapter positions instead of internal IDs');

  add(failures, /DROP\s+TRIGGER\s+IF\s+EXISTS\s+work_chapters_set_updated_at/i.test(down), 'rollback must drop trigger first');
  for (const [name, signature] of [...ROUTINES].reverse()) add(failures, compact(down).toLowerCase().includes(compact(`DROP FUNCTION IF EXISTS public.${name}(${signature});`).toLowerCase()), `rollback must drop ${name}`);
  add(failures, /DROP\s+TABLE\s+IF\s+EXISTS\s+public\.work_chapters/i.test(down), 'rollback must drop work_chapters');
  add(failures, /DROP\s+COLUMN\s+IF\s+EXISTS\s+delivery_version/i.test(down) && /DROP\s+COLUMN\s+IF\s+EXISTS\s+idempotency_key/i.test(down), 'rollback must remove snapshot and idempotency additions');
  add(failures, /REVOKE\s+INSERT\s*,\s*UPDATE\s*,\s*DELETE\s+ON\s+TABLE\s+public\.works/i.test(grants), 'direct content writes must be revoked');
  add(failures, !/GRANT\s+ALL/i.test(grants), 'runtime grants must not use ALL');
  add(failures, /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.work_chapters/i.test(grants), 'chapter runtime select grant is required');
  add(failures, /CREATE\s+POLICY\s+content_pipeline_runtime_select[\s\S]*?FOR\s+SELECT/i.test(grants) && !/FOR\s+ALL/i.test(grants), 'chapter RLS must mirror the read-only grant');
  add(failures, /DROP\s+POLICY\s+IF\s+EXISTS\s+content_pipeline_runtime_select\s+ON\s+public\.work_chapters/i.test(grantRollback), 'runtime rollback must remove its chapter policy');
  add(failures, /REVOKE\s+SELECT\s+ON\s+TABLE\s+public\.work_chapters\s+FROM/i.test(grantRollback), 'runtime rollback must remove its chapter grant');
  add(failures, /REVOKE\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?public\.create_work_draft/i.test(grantRollback), 'runtime rollback must remove content routine execution');
  add(failures, /GRANT\s+INSERT\s+ON\s+TABLE\s+public\.works[\s\S]*?public\.audit_logs\s+TO\s+:"backend_role"/i.test(grantRollback), 'runtime rollback must restore base INSERT grants');
  add(failures, /GRANT\s+UPDATE\s+ON\s+TABLE\s+public\.works[\s\S]*?public\.snapshot_jobs\s+TO\s+:"backend_role"/i.test(grantRollback), 'runtime rollback must restore base UPDATE grants');
  return failures;
}

export function verifyContentPipelineFromFiles() {
  return validateContentPipeline({
    migration: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline.sql'), 'utf8'),
    rollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline_rollback.sql'), 'utf8'),
    access: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline_runtime_access.sql'), 'utf8'),
    accessRollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_content_pipeline_runtime_access_rollback.sql'), 'utf8'),
  });
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  const failures = verifyContentPipelineFromFiles();
  if (failures.length) { console.error(`content pipeline verification failed:\n- ${failures.join('\n- ')}`); process.exitCode = 1; }
  else console.log('content pipeline static verification passed');
}
