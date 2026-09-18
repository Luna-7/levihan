import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateSubmissions } from './verify-submissions.mjs';

const root = resolve(import.meta.dirname, '..');
const files = () => ({
  migration: readFileSync(resolve(root, 'cloudbase/migrations/20260918_submissions.sql'), 'utf8'),
  rollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_submissions_rollback.sql'), 'utf8'),
  access: readFileSync(resolve(root, 'cloudbase/migrations/20260918_submissions_runtime_access.sql'), 'utf8'),
  accessRollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_submissions_runtime_access_rollback.sql'), 'utf8'),
  routes: readFileSync(resolve(root, 'cloudbase/functions/app-api/src/modules/submissions/routes.js'), 'utf8'),
  runtime: readFileSync(resolve(root, 'cloudbase/functions/app-api/index.js'), 'utf8'),
  rootRouter: readFileSync(resolve(root, 'src/RootRouter.tsx'), 'utf8'),
  form: readFileSync(resolve(root, 'src/features/submissions/SubmissionForm.tsx'), 'utf8'),
});

describe('submission workflow verifier', () => {
  it('accepts the controlled submission workflow', () => expect(validateSubmissions(files())).toEqual([]));
  it.each([
    ['session binding', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('interaction_assert_actor(p_user_id,p_session_id)', 'interaction_assert_actor(p_user_id,NULL)'); }],
    ['detail session binding', (v: ReturnType<typeof files>) => { const marker = 'CREATE FUNCTION public.get_my_submission_v2'; const at = v.migration.indexOf(marker); v.migration = v.migration.slice(0, at) + v.migration.slice(at).replace('interaction_assert_actor(p_user_id,p_session_id)', 'interaction_assert_actor(p_user_id,NULL)'); }],
    ['state machine', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("submission.status='draft' AND p_action='submit'", 'true'); }],
    ['legacy status migration order', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("ALTER TABLE public.submissions DROP CONSTRAINT submissions_status_check;\nUPDATE public.submissions SET status='under_review'", "UPDATE public.submissions SET status='under_review'\nALTER TABLE public.submissions DROP CONSTRAINT submissions_status_check;"); }],
    ['version CAS', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('submission.version<>p_expected_version', 'false'); }],
    ['daily quota lock', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("pg_advisory_xact_lock(hashtextextended('submission-quota:'||p_user_id::text,20260918))", ''); }],
    ['daily successful quota', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('submitted_at>=date_trunc', 'created_at>=date_trunc'); }],
    ['transactional idempotency', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('submission_operations', 'removed_submission_operations'); }],
    ['payload hash conflict', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('operation.request_hash<>p_hash', 'false'); }],
    ['upload owner binding', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('current_upload_session.owner_id=p_user_id', 'true'); }],
    ['asset type matrix', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('p_submission_type<>submission.type', 'false'); }],
    ['private staging prefix', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("'staging/submissions/'||p_user_id", "'staging/'||p_user_id"); }],
    ['private final prefix', (v: ReturnType<typeof files>) => { v.migration = v.migration.replaceAll("'protected/works/'||p_submission_id", "'public/works/'||p_submission_id"); }],
    ['verified asset submit', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("file.status='bound'", 'true'); }],
    ['durable cleanup', (v: ReturnType<typeof files>) => { v.migration = v.migration.replaceAll("SET status='cleanup_pending'", "SET status='deleted'"); }],
    ['all submission uploads cleaned', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('WHERE file.submission_id=p_submission_id AND file.asset_id', 'WHERE file.asset_id'); }],
    ['expired declared cleanup', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("f.status='declared'", "f.status='removed'"); }],
    ['upload transition race', (v: ReturnType<typeof files>) => { v.migration = v.migration.replaceAll("status='draft' FOR UPDATE", "status='draft'"); }],
    ['verified before submission asset trigger', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("SET status='verified',actual_size", "SET status='promoting',actual_size"); }],
    ['admin session', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('interaction_assert_admin(p_admin_id,p_admin_session_id)', 'interaction_assert_admin(p_admin_id,NULL)'); }],
    ['accepted work draft', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("'draft',creator.username,submission.user_id,p_admin_id", "'published',creator.username,submission.user_id,p_admin_id"); }],
    ['accepted assets private', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("'private','private'", "'public','public'"); }],
    ['internal note projection', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("- 'internal_note'", ''); }],
    ['internal note preservation', (v: ReturnType<typeof files>) => { v.migration = v.migration.replaceAll("COALESCE(NULLIF(btrim(p_internal_note),''),internal_note)", "NULLIF(btrim(p_internal_note),'')"); }],
    ['moderation action mapping', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("WHEN 'accept' THEN 'approve'", "WHEN 'accept' THEN 'accept'"); }],
    ['compound cursor', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('(submission.updated_at,submission.id)<(p_before_at,p_before_id)', 'submission.updated_at<p_before_at'); }],
    ['RLS', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('ALTER TABLE public.submission_operations ENABLE ROW LEVEL SECURITY', ''); }],
    ['runtime DML revoke', (v: ReturnType<typeof files>) => { v.access = v.access.replace('REVOKE ALL ON TABLE public.submissions,public.submission_assets,public.submission_operations', ''); }],
    ['rollback fence', (v: ReturnType<typeof files>) => { v.rollback = v.rollback.replace('rollback_requires_submission_export', 'removed_rollback_fence'); }],
    ['rollback writer lock', (v: ReturnType<typeof files>) => { v.rollback = v.rollback.replace('LOCK TABLE public.submission_operations,public.submissions,public.submission_assets,public.upload_sessions,public.upload_files IN SHARE MODE;', ''); }],
    ['frontend reachability', (v: ReturnType<typeof files>) => { v.rootRouter = v.rootRouter.replace("#/submissions", '#/removed'); }],
    ['signed URL memory only', (v: ReturnType<typeof files>) => { v.form += '\nlocalStorage.setItem("uploadUrl", uploadUrl);'; }],
    ['module registration', (v: ReturnType<typeof files>) => { v.runtime = v.runtime.replace('registerSubmissionRoutes(api.router', 'removed(api.router'); }],
    ['runtime rollback exact upload signature', (v: ReturnType<typeof files>) => { v.accessRollback = v.accessRollback.replace('uuid,uuid,uuid,text,uuid,uuid,text,bigint', 'uuid,uuid,uuid,uuid,uuid,text,bigint'); }],
    ['runtime rollback detail revoke', (v: ReturnType<typeof files>) => { v.accessRollback = v.accessRollback.replace('public.get_my_submission_v2(uuid,uuid,uuid),', ''); }],
  ])('rejects mutation: %s', (_name, mutate) => { const value = files(); mutate(value); expect(validateSubmissions(value).length).toBeGreaterThan(0); });
});
