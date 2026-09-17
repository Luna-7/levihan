-- Roll back only objects introduced by 20260918_backend_v2.sql.
-- This intentionally does not drop pgcrypto or touch legacy public.users and
-- public.submission_inbox, which may predate this migration.
DROP FUNCTION IF EXISTS public.sync_reading_progress(uuid, uuid, bigint, numeric, bigint, timestamptz);
DROP FUNCTION IF EXISTS public.set_favorite(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.set_work_like(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.consume_recovery_code(text, text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.rotate_user_session(text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.consume_registration_ticket(text, text, text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.backend_v2_validate_submission_asset();
DROP FUNCTION IF EXISTS public.backend_v2_enforce_comment_reply_depth();

DROP TABLE IF EXISTS public.rate_limit_buckets;
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

DROP FUNCTION IF EXISTS public.backend_v2_set_updated_at();
