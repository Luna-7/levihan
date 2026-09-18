-- Run with: psql -v ON_ERROR_STOP=1 -v backend_role=your_backend_role -f ...
-- backend_role is an identifier, not a browser credential. This file grants
-- only the API operations listed below; user-level authorization remains in
-- the trusted service/API layer.
\if :{?backend_role}
\else
\echo 'backend_role is required; pass -v backend_role=your_backend_role'
\quit 3
\endif

BEGIN;

GRANT USAGE ON SCHEMA public TO :"backend_role";

-- Every v2 object is readable by the API. Writes are intentionally split so
-- append-only/security-sensitive state is changed only by controlled routines.
GRANT SELECT ON TABLE public.app_users, public.user_sessions,
  public.question_bank, public.registration_challenges, public.registration_attempts,
  public.registration_tickets, public.recovery_codes, public.age_consents, public.works,
  public.work_assets, public.tags, public.work_tags, public.work_versions, public.work_likes,
  public.favorites, public.comments, public.reading_progress, public.reports,
  public.upload_sessions, public.upload_files, public.submissions, public.submission_assets,
  public.snapshot_jobs, public.snapshot_versions, public.moderation_actions, public.audit_logs,
  public.site_settings, public.blocked_subjects, public.rate_limit_buckets TO :"backend_role";

-- Question-bank CRUD is for the protected admin API; browser/user database
-- identities never receive this role or these grants.
GRANT INSERT ON TABLE public.question_bank TO :"backend_role";
GRANT UPDATE ON TABLE public.question_bank TO :"backend_role";
GRANT DELETE ON TABLE public.question_bank TO :"backend_role";

GRANT INSERT ON TABLE public.registration_challenges, public.age_consents, public.works,
  public.work_assets, public.tags, public.work_tags, public.work_versions, public.comments, public.reports,
  public.upload_sessions, public.upload_files, public.submissions, public.submission_assets,
  public.snapshot_jobs, public.snapshot_versions, public.moderation_actions, public.audit_logs,
  public.site_settings, public.blocked_subjects, public.rate_limit_buckets TO :"backend_role";

GRANT UPDATE ON TABLE public.age_consents, public.works, public.work_assets, public.tags,
  public.comments, public.reports, public.upload_sessions, public.upload_files,
  public.submissions, public.snapshot_jobs, public.site_settings, public.blocked_subjects,
  public.rate_limit_buckets TO :"backend_role";
GRANT UPDATE (username, status, last_login_at) ON TABLE public.app_users TO :"backend_role";

GRANT DELETE ON TABLE public.work_tags TO :"backend_role";

-- These are the only routines exposed to the runtime role. Their SECURITY
-- DEFINER bodies validate ownership/state and run with a fixed search_path.
GRANT EXECUTE ON FUNCTION public.answer_registration_challenge(uuid, boolean, integer, integer, text, timestamptz),
  public.consume_registration_ticket(text, text, text, text, timestamptz, text, text),
  public.create_login_session(uuid, text, timestamptz, text),
  public.rotate_user_session(text, text, timestamptz, text),
  public.consume_recovery_code(text, text, text, text, timestamptz, text),
  public.promote_app_user(uuid, uuid, boolean, text),
  public.set_work_like(uuid, uuid, boolean), public.set_favorite(uuid, uuid, boolean),
  public.sync_reading_progress(uuid, uuid, bigint, numeric, bigint, timestamptz),
  public.consume_rate_limit_bucket(text, text, integer, integer, timestamptz),
  public.begin_idempotent_request(text, text, text, text),
  public.complete_idempotent_request(text, text, text, text, jsonb),
  public.fail_idempotent_request(text, text, text, text) TO :"backend_role";

-- RLS policies mirror the table grants above. There is deliberately no
-- catch-all policy, and no policy for an operation that the role was not granted.
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.app_users;
CREATE POLICY backend_v2_runtime_select ON public.app_users FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.user_sessions;
CREATE POLICY backend_v2_runtime_select ON public.user_sessions FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.question_bank;
CREATE POLICY backend_v2_runtime_select ON public.question_bank FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.question_bank;
CREATE POLICY backend_v2_runtime_insert ON public.question_bank FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_update ON public.question_bank;
CREATE POLICY backend_v2_runtime_update ON public.question_bank FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_delete ON public.question_bank;
CREATE POLICY backend_v2_runtime_delete ON public.question_bank FOR DELETE TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.registration_challenges;
CREATE POLICY backend_v2_runtime_select ON public.registration_challenges FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.registration_attempts;
CREATE POLICY backend_v2_runtime_select ON public.registration_attempts FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.registration_tickets;
CREATE POLICY backend_v2_runtime_select ON public.registration_tickets FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.recovery_codes;
CREATE POLICY backend_v2_runtime_select ON public.recovery_codes FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.age_consents;
CREATE POLICY backend_v2_runtime_select ON public.age_consents FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.works;
CREATE POLICY backend_v2_runtime_select ON public.works FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.work_assets;
CREATE POLICY backend_v2_runtime_select ON public.work_assets FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.tags;
CREATE POLICY backend_v2_runtime_select ON public.tags FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.work_tags;
CREATE POLICY backend_v2_runtime_select ON public.work_tags FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.work_versions;
CREATE POLICY backend_v2_runtime_select ON public.work_versions FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.work_likes;
CREATE POLICY backend_v2_runtime_select ON public.work_likes FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.favorites;
CREATE POLICY backend_v2_runtime_select ON public.favorites FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.comments;
CREATE POLICY backend_v2_runtime_select ON public.comments FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.reading_progress;
CREATE POLICY backend_v2_runtime_select ON public.reading_progress FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.reports;
CREATE POLICY backend_v2_runtime_select ON public.reports FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.upload_sessions;
CREATE POLICY backend_v2_runtime_select ON public.upload_sessions FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.upload_files;
CREATE POLICY backend_v2_runtime_select ON public.upload_files FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.submissions;
CREATE POLICY backend_v2_runtime_select ON public.submissions FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.submission_assets;
CREATE POLICY backend_v2_runtime_select ON public.submission_assets FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.snapshot_jobs;
CREATE POLICY backend_v2_runtime_select ON public.snapshot_jobs FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.snapshot_versions;
CREATE POLICY backend_v2_runtime_select ON public.snapshot_versions FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.moderation_actions;
CREATE POLICY backend_v2_runtime_select ON public.moderation_actions FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.audit_logs;
CREATE POLICY backend_v2_runtime_select ON public.audit_logs FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.site_settings;
CREATE POLICY backend_v2_runtime_select ON public.site_settings FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.blocked_subjects;
CREATE POLICY backend_v2_runtime_select ON public.blocked_subjects FOR SELECT TO :"backend_role" USING (true);
DROP POLICY IF EXISTS backend_v2_runtime_select ON public.rate_limit_buckets;
CREATE POLICY backend_v2_runtime_select ON public.rate_limit_buckets FOR SELECT TO :"backend_role" USING (true);

DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.registration_challenges;
CREATE POLICY backend_v2_runtime_insert ON public.registration_challenges FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.age_consents;
CREATE POLICY backend_v2_runtime_insert ON public.age_consents FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.works;
CREATE POLICY backend_v2_runtime_insert ON public.works FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.work_assets;
CREATE POLICY backend_v2_runtime_insert ON public.work_assets FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.tags;
CREATE POLICY backend_v2_runtime_insert ON public.tags FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.work_tags;
CREATE POLICY backend_v2_runtime_insert ON public.work_tags FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.work_versions;
CREATE POLICY backend_v2_runtime_insert ON public.work_versions FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.comments;
CREATE POLICY backend_v2_runtime_insert ON public.comments FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.reports;
CREATE POLICY backend_v2_runtime_insert ON public.reports FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.upload_sessions;
CREATE POLICY backend_v2_runtime_insert ON public.upload_sessions FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.upload_files;
CREATE POLICY backend_v2_runtime_insert ON public.upload_files FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.submissions;
CREATE POLICY backend_v2_runtime_insert ON public.submissions FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.submission_assets;
CREATE POLICY backend_v2_runtime_insert ON public.submission_assets FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.snapshot_jobs;
CREATE POLICY backend_v2_runtime_insert ON public.snapshot_jobs FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.snapshot_versions;
CREATE POLICY backend_v2_runtime_insert ON public.snapshot_versions FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.moderation_actions;
CREATE POLICY backend_v2_runtime_insert ON public.moderation_actions FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.audit_logs;
CREATE POLICY backend_v2_runtime_insert ON public.audit_logs FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.site_settings;
CREATE POLICY backend_v2_runtime_insert ON public.site_settings FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.blocked_subjects;
CREATE POLICY backend_v2_runtime_insert ON public.blocked_subjects FOR INSERT TO :"backend_role" WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_insert ON public.rate_limit_buckets;
CREATE POLICY backend_v2_runtime_insert ON public.rate_limit_buckets FOR INSERT TO :"backend_role" WITH CHECK (true);

DROP POLICY IF EXISTS backend_v2_runtime_update ON public.app_users;
CREATE POLICY backend_v2_runtime_update ON public.app_users FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_update ON public.age_consents;
CREATE POLICY backend_v2_runtime_update ON public.age_consents FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_update ON public.works;
CREATE POLICY backend_v2_runtime_update ON public.works FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_update ON public.work_assets;
CREATE POLICY backend_v2_runtime_update ON public.work_assets FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_update ON public.tags;
CREATE POLICY backend_v2_runtime_update ON public.tags FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_update ON public.comments;
CREATE POLICY backend_v2_runtime_update ON public.comments FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_update ON public.reports;
CREATE POLICY backend_v2_runtime_update ON public.reports FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_update ON public.upload_sessions;
CREATE POLICY backend_v2_runtime_update ON public.upload_sessions FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_update ON public.upload_files;
CREATE POLICY backend_v2_runtime_update ON public.upload_files FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_update ON public.submissions;
CREATE POLICY backend_v2_runtime_update ON public.submissions FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_update ON public.snapshot_jobs;
CREATE POLICY backend_v2_runtime_update ON public.snapshot_jobs FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_update ON public.site_settings;
CREATE POLICY backend_v2_runtime_update ON public.site_settings FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_update ON public.blocked_subjects;
CREATE POLICY backend_v2_runtime_update ON public.blocked_subjects FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_update ON public.rate_limit_buckets;
CREATE POLICY backend_v2_runtime_update ON public.rate_limit_buckets FOR UPDATE TO :"backend_role" USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS backend_v2_runtime_delete ON public.work_tags;
CREATE POLICY backend_v2_runtime_delete ON public.work_tags FOR DELETE TO :"backend_role" USING (true);

COMMIT;
