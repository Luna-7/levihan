import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripSqlComments } from './verify-backend-schema.mjs';

const root = resolve(import.meta.dirname, '..');
const exposed = [
  ['create_submission_draft_v2','uuid,uuid,text,text,text,jsonb,text,text,text'],
  ['update_submission_draft_v2','uuid,uuid,uuid,bigint,text,text,jsonb,text,text,text'],
  ['transition_submission_v2','uuid,uuid,uuid,bigint,text,text,text,text'],
  ['review_submission_v2','uuid,uuid,uuid,bigint,text,text,text,text,text,text'],
  ['list_my_submissions_v2','uuid,uuid,integer,timestamptz,uuid'],
  ['get_my_submission_v2','uuid,uuid,uuid'],
  ['list_admin_submissions_v2','uuid,uuid,text,integer,timestamptz,uuid'],
  ['create_submission_upload_v2','uuid,uuid,uuid,text,uuid,uuid,text,bigint,text,text,text,integer,timestamptz,text,text,text'],
  ['get_submission_upload_v2','uuid,uuid,uuid,uuid'],
  ['begin_submission_upload_promotion_v2','uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,text,text'],
  ['complete_submission_upload_v2','uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text'],
];
const compact = (value) => value.replace(/\s+/g,'').toLowerCase();
const add = (failures, condition, message) => { if (!condition) failures.push(message); };
const routine = (sql, name) => sql.match(new RegExp(`CREATE(?:\\s+OR\\s+REPLACE)?\\s+FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`,'i'))?.[0] || '';

export function validateSubmissions({ migration,rollback,access,accessRollback,routes,runtime,rootRouter,form }) {
  const failures=[]; const sql=stripSqlComments(migration); const down=stripSqlComments(rollback); const grants=stripSqlComments(access);
  add(failures,/^BEGIN;/i.test(sql.trim())&&/COMMIT;\s*$/i.test(sql.trim()),'transactional migration required');
  add(failures,/submissions_status_check[\s\S]*?'draft'[\s\S]*?'submitted'[\s\S]*?'under_review'[\s\S]*?'accepted'[\s\S]*?'rejected'[\s\S]*?'withdrawn'/i.test(sql),'submission states required');
  add(failures,sql.indexOf('ALTER TABLE public.submissions DROP CONSTRAINT submissions_status_check') < sql.indexOf("UPDATE public.submissions SET status='under_review'"),'legacy status constraint must be removed before value migration');
  add(failures,/CREATE\s+TABLE\s+public\.submission_operations/i.test(sql)&&/PRIMARY\s+KEY\s*\(actor_id,idempotency_key\)/i.test(sql)&&/ALTER\s+TABLE\s+public\.submission_operations\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql),'transactional submission idempotency with RLS required');
  for (const [name,signature] of exposed) { const fn=routine(sql,name); add(failures,/SECURITY\s+DEFINER/i.test(fn)&&/SET\s+search_path\s*=\s*pg_catalog\s*,\s*public/i.test(fn),`${name} must pin search_path`); add(failures,compact(sql).includes(compact(`REVOKE EXECUTE ON FUNCTION public.${name}(${signature}) FROM PUBLIC;`)),`${name} PUBLIC revoke missing`); add(failures,compact(grants).includes(compact(`public.${name}(${signature})`)),`${name} runtime execute missing`); add(failures,compact(down).includes(compact(`DROP FUNCTION IF EXISTS public.${name}(${signature});`)),`${name} rollback missing`); }
  const create=routine(sql,'create_submission_draft_v2'); const update=routine(sql,'update_submission_draft_v2'); const transition=routine(sql,'transition_submission_v2'); const review=routine(sql,'review_submission_v2'); const init=routine(sql,'create_submission_upload_v2'); const getUpload=routine(sql,'get_submission_upload_v2'); const promote=routine(sql,'begin_submission_upload_promotion_v2'); const complete=routine(sql,'complete_submission_upload_v2'); const mine=routine(sql,'list_my_submissions_v2'); const detail=routine(sql,'get_my_submission_v2'); const admin=routine(sql,'list_admin_submissions_v2');
  add(failures,[create,update,transition,mine,detail,init,getUpload,promote,complete].every((fn)=>/interaction_assert_actor\(p_user_id,p_session_id\)/i.test(fn)),'all user operations must bind the concrete session');
  add(failures,/interaction_assert_admin\(p_admin_id,p_admin_session_id\)/i.test(review)&&/interaction_assert_admin\(p_admin_id,p_admin_session_id\)/i.test(admin),'admin operations must bind active admin sessions');
  add(failures,/submission\.version<>p_expected_version/i.test(update)&&/submission\.version<>p_expected_version/i.test(transition)&&/submission\.version<>p_expected_version/i.test(review),'optimistic version CAS required');
  add(failures,/submission\.status='draft'\s+AND\s+p_action='submit'/i.test(transition)&&/submission\.status\s+IN\s*\('draft','submitted'\)\s+AND\s+p_action='withdraw'/i.test(transition)&&/submission\.status='submitted'\s+AND\s+p_action='start_review'/i.test(review)&&/submission\.status='under_review'\s+AND\s+p_action='accept'/i.test(review),'explicit state machine required');
  add(failures,/pg_advisory_xact_lock\(hashtextextended\('submission-quota:'\|\|p_user_id::text,20260918\)\)/i.test(transition)&&/submitted_at>=date_trunc/i.test(transition)&&/daily_quota_exceeded/i.test(transition),'atomic successful daily quota required');
  add(failures,/submission_operation_replay/i.test(create)&&/submission_store_operation/i.test(create)&&/operation\.request_hash<>p_hash/i.test(routine(sql,'submission_operation_replay')),'payload-bound transaction idempotency required');
  add(failures,/current_upload_session\.owner_id=p_user_id/i.test(init)&&/purpose='submission_asset'/i.test(init)&&/idempotency_conflict/i.test(init),'owner-bound upload idempotency required');
  add(failures,/p_submission_type<>submission\.type/i.test(init)&&/submission\.type='comic'[\s\S]*?p_kind IN \('page','cover'\)[\s\S]*?submission\.type='novel'[\s\S]*?p_kind='body'/i.test(init),'database asset type/kind/MIME matrix required');
  add(failures,/'staging\/submissions\/'\|\|p_user_id/i.test(init)&&/p_expires_at>clock_timestamp\(\)\+interval '5 minutes 30 seconds'/i.test(init),'short private staging prefix required');
  add(failures,/'protected\/works\/'\|\|p_submission_id/i.test(promote)&&/file\.storage_zone<>'private'/i.test(complete)&&/p_object_key\s+NOT\s+LIKE\s+'protected\/works\/'/i.test(complete),'private final object binding required');
  add(failures,/file\.status='bound'/i.test(transition)&&/upload_not_verified/i.test(transition)&&/submission_assets/i.test(transition),'submit requires verified owned assets');
  add(failures,/SET\s+status='cleanup_pending'[\s\S]*?WHERE\s+file\.submission_id=p_submission_id\s+AND\s+file\.asset_id/i.test(transition)&&/SET\s+status='cleanup_pending'[\s\S]*?WHERE\s+file\.submission_id=p_submission_id\s+AND\s+file\.asset_id/i.test(review),'withdrawal and rejection require durable cleanup of every submission upload');
  add(failures,/UPDATE\s+public\.upload_sessions\s+SET\s+status='expired'[\s\S]*?purpose='submission_asset'[\s\S]*?expires_at<=clock_timestamp\(\)[\s\S]*?f\.status='declared'[\s\S]*?f\.submission_id IS NOT NULL[\s\S]*?session\.status='expired'/i.test(sql)&&/CREATE OR REPLACE FUNCTION public\.claim_stale_upload_promotions/i.test(down),'expired declared submissions must enter cleanup and rollback must restore the prior claim function');
  add(failures,/status='draft'\s+FOR\s+UPDATE/i.test(promote)&&/status='draft'\s+FOR\s+UPDATE/i.test(complete),'upload promotion and completion must serialize with submit or withdrawal');
  add(failures,/UPDATE\s+public\.upload_files\s+SET\s+status='verified',actual_size[\s\S]*?INSERT\s+INTO\s+public\.submission_assets[\s\S]*?UPDATE\s+public\.upload_files\s+SET\s+status='bound'/i.test(complete),'file must satisfy the base verified-status trigger before binding');
  add(failures,/INSERT\s+INTO\s+public\.works[\s\S]*?'draft',creator\.username,submission\.user_id,p_admin_id/i.test(review)&&/accepted_work_id=submission\.id/i.test(review),'acceptance must atomically create a work draft');
  add(failures,/INSERT\s+INTO\s+public\.work_chapters/i.test(review)&&/INSERT\s+INTO\s+public\.work_assets[\s\S]*?'private','private'/i.test(review)&&/accepted_asset_id=new_asset_id/i.test(review),'acceptance must bind draft chapters and verified private work assets');
  add(failures,/-\s*'internal_note'/i.test(mine)&&!/-\s*'payload'/i.test(mine)&&/to_jsonb\(submission\)/i.test(detail)&&/to_jsonb\(page\)/i.test(admin)&&/jsonb_build_object\('file_id'/i.test(mine+admin),'role-specific editable payload and safe asset projections required');
  add(failures,/internal_note=COALESCE\(NULLIF\(btrim\(p_internal_note\),''\),internal_note\)/i.test(review),'review notes must survive later transitions without a replacement');
  add(failures,/CASE\s+p_action\s+WHEN\s+'start_review'\s+THEN\s+'review'\s+WHEN\s+'accept'\s+THEN\s+'approve'/i.test(review),'review actions must map to moderation action constraints');
  add(failures,/\(submission\.updated_at,submission\.id\)<\(p_before_at,p_before_id\)/i.test(mine)&&/\(submission\.updated_at,submission\.id\)<\(p_before_at,p_before_id\)/i.test(admin),'compound cursors required');
  add(failures,/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.submissions\s*,\s*public\.submission_assets\s*,\s*public\.submission_operations/i.test(grants)&&!/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]*?submission_operations/i.test(grants),'least privilege runtime boundary required');
  add(failures,/LOCK\s+TABLE\s+public\.submission_operations,public\.submissions,public\.submission_assets,public\.upload_sessions,public\.upload_files\s+IN\s+SHARE\s+MODE/i.test(down)&&/rollback_requires_submission_export/i.test(down)&&/EXISTS\(SELECT 1 FROM public\.submission_operations\)/i.test(down),'rollback fence required');
  add(failures,/sessionRequired:\s*true/i.test(routes)&&/role:\s*'admin'/i.test(routes)&&/mode:\s*'domain'/i.test(routes)&&/rateLimit:/i.test(routes),'route session/admin/rate/idempotency policies required');
  add(failures,/registerSubmissionRoutes\(api\.router/i.test(runtime),'submission module must be registered');
  add(failures,/#\/submissions/i.test(rootRouter)&&/<SubmissionForm/i.test(rootRouter),'submission page must be reachable');
  add(failures,!/(?:localStorage|sessionStorage)\.setItem/i.test(form)&&/uploadSubmissionFile/i.test(form)&&/上传进度/i.test(form),'signed upload URLs must stay in component memory');
  add(failures,exposed.every(([name,signature])=>compact(accessRollback).includes(compact(`public.${name}(${signature})`)))&&/REVOKE\s+EXECUTE/i.test(accessRollback)&&/GRANT\s+SELECT,INSERT,UPDATE\s+ON\s+TABLE\s+public\.submissions/i.test(accessRollback),'runtime rollback must revoke every exact forward signature');
  return failures;
}

export function verifySubmissionsFromFiles() { return validateSubmissions({ migration:readFileSync(resolve(root,'cloudbase/migrations/20260918_submissions.sql'),'utf8'), rollback:readFileSync(resolve(root,'cloudbase/migrations/20260918_submissions_rollback.sql'),'utf8'), access:readFileSync(resolve(root,'cloudbase/migrations/20260918_submissions_runtime_access.sql'),'utf8'), accessRollback:readFileSync(resolve(root,'cloudbase/migrations/20260918_submissions_runtime_access_rollback.sql'),'utf8'), routes:readFileSync(resolve(root,'cloudbase/functions/app-api/src/modules/submissions/routes.js'),'utf8'), runtime:readFileSync(resolve(root,'cloudbase/functions/app-api/index.js'),'utf8'), rootRouter:readFileSync(resolve(root,'src/RootRouter.tsx'),'utf8'), form:readFileSync(resolve(root,'src/features/submissions/SubmissionForm.tsx'),'utf8') }); }
if (import.meta.url===pathToFileURL(resolve(process.argv[1]||'')).href) { const failures=verifySubmissionsFromFiles(); if (failures.length) { console.error(`submission verification failed:\n- ${failures.join('\n- ')}`); process.exitCode=1; } else console.log('submission static verification passed'); }
