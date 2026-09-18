import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripSqlComments } from './verify-backend-schema.mjs';

const root = resolve(import.meta.dirname, '..');
const exposed = [
  ['set_work_reaction_v2', 'uuid,uuid,text,text,boolean'],
  ['list_work_comments_v2', 'uuid,uuid,text,integer,timestamptz,uuid'],
  ['create_work_comment_v2', 'uuid,uuid,text,text,uuid,text,text'],
  ['delete_work_comment_v2', 'uuid,uuid,uuid,text'],
  ['moderate_work_comment_v2', 'uuid,uuid,uuid,text,text,text'],
  ['get_reading_progress_v2', 'uuid,uuid,text'],
  ['sync_reading_progress_v2', 'uuid,uuid,text,jsonb,numeric,integer,bigint,bigint,uuid'],
  ['create_interaction_report_v2', 'uuid,uuid,text,uuid,text,text,text'],
  ['moderate_interaction_report_v2', 'uuid,uuid,uuid,text,text,text'],
];
const internal = ['interaction_assert_actor', 'interaction_assert_admin', 'interaction_assert_work', 'interaction_assert_report_target'];
const compact = (value) => value.replace(/\s+/g, '').toLowerCase();
const add = (failures, condition, message) => { if (!condition) failures.push(message); };
const routine = (sql, name) => sql.match(new RegExp(`CREATE(?:\\s+OR\\s+REPLACE)?\\s+FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] || '';

export function validateInteractions({ migration, rollback, access, accessRollback, routes, runtime, archive, restrictedPage }) {
  const failures = [];
  const sql = stripSqlComments(migration); const down = stripSqlComments(rollback); const grants = stripSqlComments(access);
  add(failures, /^BEGIN;/i.test(sql.trim()) && /COMMIT;\s*$/i.test(sql.trim()), 'migration transaction required');
  add(failures, /^BEGIN;/i.test(down.trim()) && /COMMIT;\s*$/i.test(down.trim()), 'rollback transaction required');
  add(failures, /interaction_install_state[\s\S]*?ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql) && /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.interaction_install_state/i.test(sql), 'install state RLS and public revoke required');
  add(failures, /CREATE\s+TABLE\s+public\.comment_idempotency/i.test(sql) && /PRIMARY\s+KEY\s*\(user_id,idempotency_key\)/i.test(sql) && /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql), 'durable comment idempotency table with RLS required');
  for (const name of internal) add(failures, /SECURITY\s+DEFINER/i.test(routine(sql, name)) && /SET\s+search_path\s*=\s*pg_catalog\s*,\s*public/i.test(routine(sql, name)), `${name} must pin definer search_path`);
  for (const [name, signature] of exposed) {
    const definition = routine(sql, name);
    add(failures, /SECURITY\s+DEFINER/i.test(definition) && /SET\s+search_path\s*=\s*pg_catalog\s*,\s*public/i.test(definition), `${name} must pin definer search_path`);
    add(failures, compact(sql).includes(compact(`REVOKE EXECUTE ON FUNCTION public.${name}(${signature}) FROM PUBLIC;`)), `${name} public execute revoke missing`);
    add(failures, compact(grants).includes(compact(`public.${name}(${signature})`)), `${name} runtime grant missing`);
    add(failures, compact(down).includes(compact(`DROP FUNCTION IF EXISTS public.${name}(${signature});`)), `${name} rollback drop missing`);
  }
  const actor = routine(sql, 'interaction_assert_actor'); const work = routine(sql, 'interaction_assert_work'); const reaction = routine(sql, 'set_work_reaction_v2'); const list = routine(sql, 'list_work_comments_v2'); const create = routine(sql, 'create_work_comment_v2'); const del = routine(sql, 'delete_work_comment_v2'); const progress = routine(sql, 'sync_reading_progress_v2'); const reportTarget = routine(sql, 'interaction_assert_report_target'); const report = routine(sql, 'create_interaction_report_v2'); const moderate = routine(sql, 'moderate_interaction_report_v2');
  add(failures, /session\.revoked_at\s+IS\s+NOT\s+NULL/i.test(actor) && /session\.expires_at\s*<=\s*clock_timestamp/i.test(actor) && /recovery_confirmed_at\s+IS\s+NULL/i.test(actor), 'active recovery-confirmed session required');
  add(failures, /public\.authorize_work_access\(p_user_id,p_session_id,work\.id\)/i.test(work) && /content_access_authorizations/i.test(work) && /decision\.allowed\s+IS\s+DISTINCT\s+FROM\s+true/i.test(work), 'interaction policy must reuse canonical content authorization');
  add(failures, /IF\s+p_work_ref\s+~\*\s+'\^\[0-9a-f\]\{8\}-/i.test(work) && /WHERE\s+id=p_work_ref::uuid/i.test(work) && /WHERE\s+slug=p_work_ref/i.test(work) && !/id::text=p_work_ref\s+OR\s+slug=p_work_ref/i.test(work), 'work references must disambiguate ids from slugs');
  add(failures, (reaction.match(/ON\s+CONFLICT\s*\(user_id\s*,\s*work_id\)\s+DO\s+NOTHING/gi) || []).length === 2 && /pg_advisory_xact_lock\(hashtextextended\(work\.id::text\|\|':'\|\|p_reaction_type,20260918\)\)/i.test(reaction) && /count\(\*\)/i.test(reaction) && !/toggle/i.test(reaction), 'idempotent serialized set reactions and derived counts required');
  add(failures, /comment\.status\s*=\s*'published'/i.test(list) && /visible\.status\s*=\s*'published'/i.test(list), 'only published comments may be listed or counted');
  add(failures, /regexp_replace\(btrim\(p_body\),'\[\[:space:\]\]\+',' ','g'\)/i.test(create) && /length\(normalized\)\s+NOT\s+BETWEEN\s+1\s+AND\s+500/i.test(create), 'comment normalization and length validation required');
  add(failures, /recent_count/i.test(create) && /next_status\s*:=\s*'pending'/i.test(create) && /riskTerms/i.test(create), 'server-side comment risk moderation required');
  add(failures, /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text,20260918\)\)/i.test(create), 'comment risk decision must serialize by user');
  add(failures, /comment_idempotency/i.test(create) && /p_idempotency_key/i.test(create) && /digest\(work\.id::text\|\|chr\(31\)\|\|normalized/i.test(create) && /replay\.payload_hash<>request_hash/i.test(create) && /RETURN\s+QUERY\s+SELECT\s+replay\.comment_id,replay\.result_status,replay\.result_created_at/i.test(create), 'comments require payload-bound transactional idempotency replay');
  add(failures, /SET\s+status='deleted'\s*,\s*deleted_at=clock_timestamp\(\)/i.test(del) && !/DELETE\s+FROM\s+public\.comments/i.test(del), 'comments require soft deletion');
  add(failures, /ADD\s+COLUMN\s+position_data\s+jsonb/i.test(sql) && /ADD\s+COLUMN\s+client_mutation_id\s+uuid/i.test(sql) && /interaction_valid_position\(p_position\)/i.test(progress), 'typed progress position and stable mutation required');
  add(failures, /work\.type='comic'\s+AND\s+progress\.position>100000/i.test(sql) && /work\.type='novel'\s+AND\s+progress\.position>10000000/i.test(sql) && /UPDATE\s+public\.reading_progress[\s\S]*?jsonb_build_object\('kind','comic','page',GREATEST\(1,progress\.position\)\)[\s\S]*?jsonb_build_object\('kind','novel','chapter',1,'offset',progress\.position\)/i.test(sql), 'legacy progress must preflight bounds, bind type and preserve scalar position');
  add(failures, /client_version=GREATEST\(progress\.client_version,1\)/i.test(sql), 'legacy zero client versions must be upgraded for the typed API');
  add(failures, sql.indexOf('UPDATE public.interaction_install_state SET installed_at=clock_timestamp()') > sql.indexOf('UPDATE public.reading_progress progress SET'), 'rollback fence must be recorded after trigger-driven backfill');
  add(failures, /work\.type='comic'\s+AND\s+p_position->>'kind'<>'comic'/i.test(progress) && /work\.type='novel'\s+AND\s+p_position->>'kind'<>'novel'/i.test(progress), 'progress position must match work type');
  add(failures, /p_logic_version\s*>\s*current_progress\.logic_version/i.test(progress) && /p_client_version\s*>\s*current_progress\.client_version/i.test(progress) && /p_base_server_version=current_progress\.server_version/i.test(progress) && /clock_timestamp\(\)/i.test(progress), 'progress CAS ordering and server time required');
  add(failures, /pg_advisory_xact_lock\(hashtextextended\(work\.id::text\|\|':'\|\|p_user_id::text,20260918\)\)/i.test(progress) && progress.indexOf('pg_advisory_xact_lock') < progress.indexOf('SELECT * INTO current_progress'), 'first progress writes must be serialized before lookup');
  add(failures, /WHERE\s+status\s+IN\s*\('pending','reviewing'\)/i.test(sql) && /reports_active_target_uidx/i.test(sql), 'active report deduplication required');
  add(failures, /reports_reason_v2_check[\s\S]*?CHECK\s*\(reason\s+IN[\s\S]*?NOT\s+VALID/i.test(sql), 'report reason constraint must not reject historical free text');
  add(failures, /VALUES\('lh-001','comic','春'[\s\S]*?'restricted','draft','未知',NULL/i.test(sql) && /seeded_work_id/i.test(sql), 'legacy archive work must be bridged but remain unpublished until private assets are imported');
  add(failures, /slug='lh-001'\s+FOR\s+NO\s+KEY\s+UPDATE/i.test(sql) && /legacy\.type<>'comic'[\s\S]*?legacy\.rating<>'restricted'[\s\S]*?legacy\.status<>'draft'[\s\S]*?legacy\.published_at\s+IS\s+NOT\s+NULL/i.test(sql), 'legacy work conflicts require a locked strict preflight');
  add(failures, /asset\.work_id=legacy\.id\s+AND\s+\(asset\.status='active'\s+OR\s+asset\.storage_zone<>'private'\s+OR\s+asset\.access_level<>'private'\s+OR\s+NOT\s+starts_with\(asset\.object_key,'protected\/works\//i.test(sql), 'legacy work assets require a locked private unpublished preflight');
  add(failures, /interaction_uuid_shaped_slug/i.test(sql) && /works_slug_not_uuid/i.test(sql), 'UUID-shaped slugs require preflight and a database constraint');
  add(failures, Boolean(reportTarget) && /comment\.status='published'/i.test(reportTarget) && /interaction_assert_work/i.test(reportTarget), 'report target visibility policy required');
  add(failures, /p_reason\s+NOT\s+IN\s*\('illegal','copyright','harassment','spam','other'\)/i.test(report), 'report reason whitelist required');
  add(failures, /admin\.role\s*<>\s*'admin'/i.test(routine(sql, 'interaction_assert_admin')) && /INSERT\s+INTO\s+public\.moderation_actions/i.test(moderate) && /INSERT\s+INTO\s+public\.audit_logs/i.test(moderate) && /'comment\.moderate'/i.test(routine(sql, 'moderate_work_comment_v2')), 'database admin check and moderation audit required');
  add(failures, /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.work_likes\s*,\s*public\.favorites\s*,\s*public\.comments\s*,\s*public\.comment_idempotency\s*,\s*public\.reading_progress\s*,\s*public\.reports/i.test(grants), 'runtime direct interaction DML revoke required');
  add(failures, !/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]*?ON\s+TABLE\s+public\.(?:work_likes|favorites|comments|comment_idempotency|reading_progress|reports)/i.test(grants), 'runtime direct interaction grants forbidden');
  add(failures, /DROP\s+COLUMN\s+IF\s+EXISTS\s+position_data/i.test(down) && /reports_reporter_id_target_type_target_id_key/i.test(down), 'rollback must restore prior progress and report schema');
  add(failures, /progress\.updated_at>=state\.installed_at/i.test(down) && /migrated_progress_count/i.test(down), 'rollback must refuse lossy v2 progress removal');
  add(failures, /public\.reports\s+WHERE\s+note<>''/i.test(down), 'rollback must refuse lossy report note removal');
  add(failures, /EXISTS\s*\(SELECT\s+1\s+FROM\s+public\.comment_idempotency\)/i.test(down), 'rollback must refuse to discard durable comment replay records');
  add(failures, /DROP\s+TABLE\s+IF\s+EXISTS\s+public\.comment_idempotency/i.test(down) && /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+works_slug_not_uuid/i.test(down), 'rollback must remove interaction idempotency and slug constraint');
  add(failures, /\(comment\.created_at,comment\.id\)<\(p_before_at,p_before_id\)/i.test(list), 'comments require a compound stable cursor');
  add(failures, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)/i.test(accessRollback), 'runtime rollback must restore prior grants');
  add(failures, /registerInteractionRoutes\(api\.router/i.test(runtime), 'interaction routes must be registered');
  add(failures, /await\s+getMe\(\)/i.test(archive) && !/cloudbase\.auth\(\)\.getCurrentUser/i.test(archive), 'archive gate must use the unified v2 session');
  add(failures, /book\.tags\.includes\('含R18'\)[\s\S]*?window\.location\.hash\s*=\s*`#\/restricted\//i.test(archive), 'restricted legacy entries must use the AgeGate and signed reader route');
  add(failures, /if\s*\(!result\.accepted\)[\s\S]*?其他设备已有更新进度/i.test(archive), 'progress conflicts must not be reported as successful syncs');
  add(failures, /useReadingProgress\(access\s*\?\s*slug\s*:\s*null\)/i.test(restrictedPage) && /<MangaCommentSection\s+bookId=\{slug\}/i.test(restrictedPage) && /result\.accepted/i.test(restrictedPage), 'restricted reader must load progress after grant and expose comments using the canonical slug');
  add(failures, /idempotency:\s*\{\s*mode:\s*'domain'/i.test(routes) && /rateLimit:/i.test(routes) && /\/admin\/reports\/\{id\}/i.test(routes), 'route policies for progress, rate limiting and moderation required');
  return failures;
}

export function verifyInteractionsFromFiles() {
  return validateInteractions({
    migration: readFileSync(resolve(root, 'cloudbase/migrations/20260918_interactions.sql'), 'utf8'), rollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_interactions_rollback.sql'), 'utf8'), access: readFileSync(resolve(root, 'cloudbase/migrations/20260918_interactions_runtime_access.sql'), 'utf8'), accessRollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_interactions_runtime_access_rollback.sql'), 'utf8'), routes: readFileSync(resolve(root, 'cloudbase/functions/app-api/src/modules/interactions/routes.js'), 'utf8'), runtime: readFileSync(resolve(root, 'cloudbase/functions/app-api/index.js'), 'utf8'), archive: readFileSync(resolve(root, 'src/components/DoujinshiArchive.tsx'), 'utf8'), restrictedPage: readFileSync(resolve(root, 'src/features/access/RestrictedWorkPage.tsx'), 'utf8'),
  });
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  const failures = verifyInteractionsFromFiles();
  if (failures.length) { console.error(`interaction verification failed:\n- ${failures.join('\n- ')}`); process.exitCode = 1; }
  else console.log('interaction static verification passed');
}
