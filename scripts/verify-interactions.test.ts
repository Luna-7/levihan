import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateInteractions } from './verify-interactions.mjs';

const root = resolve(import.meta.dirname, '..');
const files = () => ({
  migration: readFileSync(resolve(root, 'cloudbase/migrations/20260918_interactions.sql'), 'utf8'),
  rollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_interactions_rollback.sql'), 'utf8'),
  access: readFileSync(resolve(root, 'cloudbase/migrations/20260918_interactions_runtime_access.sql'), 'utf8'),
  accessRollback: readFileSync(resolve(root, 'cloudbase/migrations/20260918_interactions_runtime_access_rollback.sql'), 'utf8'),
  routes: readFileSync(resolve(root, 'cloudbase/functions/app-api/src/modules/interactions/routes.js'), 'utf8'),
  runtime: readFileSync(resolve(root, 'cloudbase/functions/app-api/index.js'), 'utf8'),
  archive: readFileSync(resolve(root, 'src/components/DoujinshiArchive.tsx'), 'utf8'),
  restrictedPage: readFileSync(resolve(root, 'src/features/access/RestrictedWorkPage.tsx'), 'utf8'),
});

describe('interaction migration verifier', () => {
  it('accepts the controlled interaction schema and runtime boundary', () => expect(validateInteractions(files())).toEqual([]));
  it.each([
    ['reaction unique set', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('ON CONFLICT (user_id,work_id) DO NOTHING', ''); }],
    ['reaction count serialization', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("hashtextextended(work.id::text||':'||p_reaction_type,20260918)", "hashtextextended(p_user_id::text,20260918)"); }],
    ['work policy', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('public.authorize_work_access', 'public.removed_authorize_work_access'); }],
    ['comment normalization', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("regexp_replace(btrim(p_body),'[[:space:]]+',' ','g')", 'p_body'); }],
    ['comment risk pending', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("next_status := 'pending'", "next_status := 'published'"); }],
    ['comment concurrency lock', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('pg_advisory_xact_lock', 'removed_advisory_lock'); }],
    ['comment durable idempotency', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('comment_idempotency', 'removed_comment_idempotency'); }],
    ['comment payload binding', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('digest(work.id::text||chr(31)||normalized', 'digest(normalized'); }],
    ['published count', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("comment.status='published'", 'true'); }],
    ['soft delete', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("SET status='deleted',deleted_at=clock_timestamp()", 'DELETE'); }],
    ['progress logic fence', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('p_logic_version > current_progress.logic_version', 'true'); }],
    ['progress base CAS', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('p_base_server_version=current_progress.server_version', 'true'); }],
    ['progress first-write serialization', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("work.id::text||':'||p_user_id::text", 'p_user_id::text'); }],
    ['progress mutation id', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('client_mutation_id', 'removed_mutation_id'); }],
    ['progress position schema', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('interaction_valid_position(p_position)', 'true'); }],
    ['progress type binding', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("work.type='comic' AND p_position->>'kind'<>'comic'", 'false'); }],
    ['progress legacy backfill', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("jsonb_build_object('kind','comic','page',GREATEST(1,progress.position))", "'{\"kind\":\"comic\",\"page\":1}'::jsonb"); }],
    ['progress legacy range preflight', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("work.type='comic' AND progress.position>100000", 'false'); }],
    ['progress legacy client version', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('client_version=GREATEST(progress.client_version,1)', 'client_version=progress.client_version'); }],
    ['rollback fence after backfill', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('UPDATE public.interaction_install_state SET installed_at=clock_timestamp()', 'SELECT clock_timestamp()'); }],
    ['report active dedupe', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("WHERE status IN ('pending','reviewing')", ''); }],
    ['historical report compatibility', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('reports_reason_v2_check\n  CHECK', 'reports_reason_v2_check\n  CHECK').replace(') NOT VALID;', ');'); }],
    ['legacy archive work bridge', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("VALUES('lh-001','comic','春'", "VALUES('removed','comic','春'"); }],
    ['legacy archive preflight', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("legacy.status<>'draft'", 'false'); }],
    ['legacy archive asset safety', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("asset.status='active' OR asset.storage_zone<>'private'", "asset.storage_zone<>'private'"); }],
    ['legacy deleted public asset safety', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("asset.work_id=legacy.id AND (asset.status='active'", "asset.work_id=legacy.id AND asset.status<>'deleted' AND (asset.status='active'"); }],
    ['report target visibility', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('interaction_assert_report_target', 'removed_assert_report_target'); }],
    ['admin database role check', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("admin.role<>'admin'", 'false'); }],
    ['moderation audit', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("'comment.moderate'", "'comment.read'"); }],
    ['runtime direct DML revoke', (v: ReturnType<typeof files>) => { v.access = v.access.replace('REVOKE ALL ON TABLE public.work_likes,public.favorites,public.comments,public.comment_idempotency,public.reading_progress,public.reports', ''); }],
    ['runtime controlled execute', (v: ReturnType<typeof files>) => { v.access = v.access.replace('public.set_work_reaction_v2(uuid,uuid,text,text,boolean)', ''); }],
    ['rollback progress columns', (v: ReturnType<typeof files>) => { v.rollback = v.rollback.replace('DROP COLUMN IF EXISTS position_data', ''); }],
    ['rollback progress safety', (v: ReturnType<typeof files>) => { v.rollback = v.rollback.replace('progress.updated_at>=state.installed_at', 'false'); }],
    ['rollback report notes', (v: ReturnType<typeof files>) => { v.rollback = v.rollback.replace("note<>''", 'false'); }],
    ['rollback comment replays', (v: ReturnType<typeof files>) => { v.rollback = v.rollback.replace('EXISTS(SELECT 1 FROM public.comment_idempotency)', 'false'); }],
    ['uuid-shaped slug preflight', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('interaction_uuid_shaped_slug', 'removed_uuid_slug'); }],
    ['id slug disambiguation', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace("IF p_work_ref ~* '^[0-9a-f]{8}-", "IF false AND p_work_ref ~* '^[0-9a-f]{8}-"); }],
    ['compound comment cursor', (v: ReturnType<typeof files>) => { v.migration = v.migration.replace('(comment.created_at,comment.id)<(p_before_at,p_before_id)', 'comment.created_at<p_before_at'); }],
    ['unified frontend session', (v: ReturnType<typeof files>) => { v.archive = v.archive.replace('await getMe()', 'await cloudbase.auth().getCurrentUser()'); }],
    ['restricted archive routing', (v: ReturnType<typeof files>) => { v.archive = v.archive.replace("book.tags.includes('含R18')", 'false'); }],
    ['progress conflict UX', (v: ReturnType<typeof files>) => { v.archive = v.archive.replace('if (!result.accepted)', 'if (false)'); }],
    ['restricted interactions', (v: ReturnType<typeof files>) => { v.restrictedPage = v.restrictedPage.replace('<MangaCommentSection', '<RemovedCommentSection'); }],
    ['restricted progress after grant', (v: ReturnType<typeof files>) => { v.restrictedPage = v.restrictedPage.replace('useReadingProgress(access ? slug : null)', 'useReadingProgress(slug)'); }],
    ['module registration', (v: ReturnType<typeof files>) => { v.runtime = v.runtime.replace('registerInteractionRoutes(api.router', 'removed(api.router'); }],
  ])('rejects mutation: %s', (_name, mutate) => { const value = files(); mutate(value); expect(validateInteractions(value).length).toBeGreaterThan(0); });
});
