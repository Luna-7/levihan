-- Roll back only objects introduced by 20260918_backend_v2.sql.
-- This intentionally does not drop pgcrypto or touch legacy public.users and
-- public.submission_inbox, which may predate this migration.
BEGIN;

DROP TRIGGER IF EXISTS app_users_set_updated_at ON public.app_users;
DROP TRIGGER IF EXISTS user_sessions_set_updated_at ON public.user_sessions;
DROP TRIGGER IF EXISTS question_bank_set_updated_at ON public.question_bank;
DROP TRIGGER IF EXISTS registration_challenges_set_updated_at ON public.registration_challenges;
DROP TRIGGER IF EXISTS age_consents_set_updated_at ON public.age_consents;
DROP TRIGGER IF EXISTS works_set_updated_at ON public.works;
DROP TRIGGER IF EXISTS work_assets_set_updated_at ON public.work_assets;
DROP TRIGGER IF EXISTS tags_set_updated_at ON public.tags;
DROP TRIGGER IF EXISTS comments_set_updated_at ON public.comments;
DROP TRIGGER IF EXISTS comments_enforce_reply_depth ON public.comments;
DROP TRIGGER IF EXISTS reading_progress_set_updated_at ON public.reading_progress;
DROP TRIGGER IF EXISTS reports_set_updated_at ON public.reports;
DROP TRIGGER IF EXISTS upload_sessions_set_updated_at ON public.upload_sessions;
DROP TRIGGER IF EXISTS upload_files_set_updated_at ON public.upload_files;
DROP TRIGGER IF EXISTS submissions_set_updated_at ON public.submissions;
DROP TRIGGER IF EXISTS submission_assets_validate ON public.submission_assets;
DROP TRIGGER IF EXISTS snapshot_jobs_set_updated_at ON public.snapshot_jobs;
DROP TRIGGER IF EXISTS site_settings_set_updated_at ON public.site_settings;
DROP TRIGGER IF EXISTS rate_limit_buckets_set_updated_at ON public.rate_limit_buckets;

DROP FUNCTION IF EXISTS public.sync_reading_progress(uuid, uuid, bigint, numeric, bigint, timestamptz);
DROP FUNCTION IF EXISTS public.consume_rate_limit_bucket(text, text, integer, integer, timestamptz);
DROP FUNCTION IF EXISTS public.resolve_user_session(text);
DROP FUNCTION IF EXISTS public.revoke_user_session(text);
DROP FUNCTION IF EXISTS public.begin_idempotent_request(text,text,text,text);
DROP FUNCTION IF EXISTS public.complete_idempotent_request(text,text,text,text,jsonb);
DROP FUNCTION IF EXISTS public.fail_idempotent_request(text,text,text,text);
DROP FUNCTION IF EXISTS public.set_favorite(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.set_work_like(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.promote_app_user(uuid, uuid, boolean, text);
DROP FUNCTION IF EXISTS public.consume_recovery_code(text, text, text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.confirm_recovery_session(text, text);
DROP FUNCTION IF EXISTS public.create_login_session(uuid, text, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.rotate_user_session(text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.consume_registration_ticket(text, text, text, text, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.validate_registration_ticket(text);
DROP FUNCTION IF EXISTS public.answer_registration_challenge(uuid, boolean, integer, integer, text, timestamptz);
DROP FUNCTION IF EXISTS public.backend_v2_validate_submission_asset();
DROP FUNCTION IF EXISTS public.backend_v2_enforce_comment_reply_depth();
DROP FUNCTION IF EXISTS public.backend_v2_set_updated_at();

DROP TABLE IF EXISTS public.rate_limit_buckets;
DROP TABLE IF EXISTS public.idempotency_records;
DROP TABLE IF EXISTS public.blocked_subjects;
DROP TABLE IF EXISTS public.site_settings;
DROP TABLE IF EXISTS public.audit_logs;
DROP TABLE IF EXISTS public.moderation_actions;
DROP TABLE IF EXISTS public.snapshot_versions;
DROP TABLE IF EXISTS public.snapshot_jobs;
DROP TABLE IF EXISTS public.submission_assets;
DROP TABLE IF EXISTS public.submissions;
DROP TABLE IF EXISTS public.upload_files;
DROP TABLE IF EXISTS public.upload_sessions;
DROP TABLE IF EXISTS public.reports;
DROP TABLE IF EXISTS public.reading_progress;
DROP TABLE IF EXISTS public.comments;
DROP TABLE IF EXISTS public.favorites;
DROP TABLE IF EXISTS public.work_likes;
DROP TABLE IF EXISTS public.work_versions;
DROP TABLE IF EXISTS public.work_tags;
DROP TABLE IF EXISTS public.tags;
DROP TABLE IF EXISTS public.work_assets;
DROP TABLE IF EXISTS public.works;
DROP TABLE IF EXISTS public.age_consents;
DROP TABLE IF EXISTS public.recovery_codes;
DROP TABLE IF EXISTS public.registration_tickets;
DROP TABLE IF EXISTS public.registration_attempts;
DROP TABLE IF EXISTS public.registration_challenges;
DROP TABLE IF EXISTS public.question_bank;
DROP TABLE IF EXISTS public.user_sessions;
DROP TABLE IF EXISTS public.app_users;

COMMIT;
