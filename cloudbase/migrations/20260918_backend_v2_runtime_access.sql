-- Run with: psql -v ON_ERROR_STOP=1 -v backend_role=your_backend_role -f ...
-- backend_role is an identifier, not a browser credential.  This script is
-- idempotent for the v2 policies it owns and changes no legacy-table grants.
\if :{?backend_role}
\else
\echo 'backend_role is required; pass -v backend_role=your_backend_role'
\quit 3
\endif

BEGIN;

GRANT USAGE ON SCHEMA public TO :"backend_role";
-- UUID keys use pgcrypto, so this migration introduces no sequences to grant.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_users, public.user_sessions,
  public.question_bank, public.registration_challenges, public.registration_attempts,
  public.registration_tickets, public.recovery_codes, public.age_consents, public.works,
  public.work_assets, public.tags, public.work_tags, public.work_versions, public.work_likes,
  public.favorites, public.comments, public.reading_progress, public.reports,
  public.upload_sessions, public.upload_files, public.submissions, public.submission_assets,
  public.snapshot_jobs, public.snapshot_versions, public.moderation_actions, public.audit_logs,
  public.site_settings, public.blocked_subjects, public.rate_limit_buckets TO :"backend_role";
GRANT EXECUTE ON FUNCTION public.answer_registration_challenge(uuid, boolean, integer, integer, text, timestamptz),
  public.consume_registration_ticket(text, text, text, text, timestamptz, text),
  public.rotate_user_session(text, text, timestamptz, text),
  public.consume_recovery_code(text, text, text, timestamptz, text),
  public.set_work_like(uuid, uuid, boolean), public.set_favorite(uuid, uuid, boolean),
  public.sync_reading_progress(uuid, uuid, bigint, numeric, bigint, timestamptz) TO :"backend_role";

DROP POLICY IF EXISTS backend_v2_runtime_all ON public.app_users;
CREATE POLICY backend_v2_runtime_all ON public.app_users FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.user_sessions;
CREATE POLICY backend_v2_runtime_all ON public.user_sessions FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.question_bank;
CREATE POLICY backend_v2_runtime_all ON public.question_bank FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.registration_challenges;
CREATE POLICY backend_v2_runtime_all ON public.registration_challenges FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.registration_attempts;
CREATE POLICY backend_v2_runtime_all ON public.registration_attempts FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.registration_tickets;
CREATE POLICY backend_v2_runtime_all ON public.registration_tickets FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.recovery_codes;
CREATE POLICY backend_v2_runtime_all ON public.recovery_codes FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.age_consents;
CREATE POLICY backend_v2_runtime_all ON public.age_consents FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.works;
CREATE POLICY backend_v2_runtime_all ON public.works FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.work_assets;
CREATE POLICY backend_v2_runtime_all ON public.work_assets FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.tags;
CREATE POLICY backend_v2_runtime_all ON public.tags FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.work_tags;
CREATE POLICY backend_v2_runtime_all ON public.work_tags FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.work_versions;
CREATE POLICY backend_v2_runtime_all ON public.work_versions FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.work_likes;
CREATE POLICY backend_v2_runtime_all ON public.work_likes FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.favorites;
CREATE POLICY backend_v2_runtime_all ON public.favorites FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.comments;
CREATE POLICY backend_v2_runtime_all ON public.comments FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.reading_progress;
CREATE POLICY backend_v2_runtime_all ON public.reading_progress FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.reports;
CREATE POLICY backend_v2_runtime_all ON public.reports FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.upload_sessions;
CREATE POLICY backend_v2_runtime_all ON public.upload_sessions FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.upload_files;
CREATE POLICY backend_v2_runtime_all ON public.upload_files FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.submissions;
CREATE POLICY backend_v2_runtime_all ON public.submissions FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.submission_assets;
CREATE POLICY backend_v2_runtime_all ON public.submission_assets FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.snapshot_jobs;
CREATE POLICY backend_v2_runtime_all ON public.snapshot_jobs FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.snapshot_versions;
CREATE POLICY backend_v2_runtime_all ON public.snapshot_versions FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.moderation_actions;
CREATE POLICY backend_v2_runtime_all ON public.moderation_actions FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.audit_logs;
CREATE POLICY backend_v2_runtime_all ON public.audit_logs FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.site_settings;
CREATE POLICY backend_v2_runtime_all ON public.site_settings FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.blocked_subjects;
CREATE POLICY backend_v2_runtime_all ON public.blocked_subjects FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_v2_runtime_all ON public.rate_limit_buckets;
CREATE POLICY backend_v2_runtime_all ON public.rate_limit_buckets FOR ALL TO :"backend_role" USING (true) WITH CHECK (true);

COMMIT;
