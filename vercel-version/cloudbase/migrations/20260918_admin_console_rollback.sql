BEGIN;
LOCK TABLE public.admin_console_operations,public.admin_console_install_state,public.site_settings,public.question_bank,public.app_users,public.snapshot_jobs IN SHARE MODE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.admin_console_operations) THEN RAISE EXCEPTION 'rollback_requires_admin_console_export'; END IF; IF EXISTS(SELECT 1 FROM public.question_bank q WHERE q.question_key<>q.id) THEN RAISE EXCEPTION 'rollback_requires_question_version_export'; END IF; END $$;
DROP FUNCTION IF EXISTS public.admin_health_v2(uuid,uuid);
DROP FUNCTION IF EXISTS public.admin_update_setting_v2(uuid,uuid,text,bigint,jsonb,text,text,text);
DROP FUNCTION IF EXISTS public.admin_get_settings_v2(uuid,uuid);
DROP FUNCTION IF EXISTS public.admin_promote_user_v2(uuid,uuid,uuid,bigint,text,text,text,text);
DROP FUNCTION IF EXISTS public.admin_mark_reauthenticated_v2(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.admin_get_reauth_credential_v2(uuid,uuid);
DROP FUNCTION IF EXISTS public.admin_retry_job_v2(uuid,uuid,uuid,bigint,text,text,text);
DROP FUNCTION IF EXISTS public.admin_set_question_status_v2(uuid,uuid,uuid,integer,text,text,text,text);
DROP FUNCTION IF EXISTS public.admin_update_question_v2(uuid,uuid,uuid,integer,jsonb,text,text,text);
DROP FUNCTION IF EXISTS public.admin_create_question_v2(uuid,uuid,text,jsonb,text[],text,integer,text,text,text);
DROP FUNCTION IF EXISTS public.admin_set_user_status_v2(uuid,uuid,uuid,bigint,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.admin_list_audit_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid);
DROP FUNCTION IF EXISTS public.admin_list_jobs_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid);
DROP FUNCTION IF EXISTS public.admin_list_reports_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid);
DROP FUNCTION IF EXISTS public.admin_list_comments_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid);
DROP FUNCTION IF EXISTS public.admin_list_questions_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid);
DROP FUNCTION IF EXISTS public.admin_list_users_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid);
DROP FUNCTION IF EXISTS public.admin_dashboard_v2(uuid,uuid);
DROP FUNCTION IF EXISTS public.admin_console_replay(uuid,text,text,text);
DROP TABLE public.admin_console_operations;
DELETE FROM public.site_settings setting USING public.admin_console_install_state state
 WHERE state.singleton AND (
   (state.seeded_announcement AND setting.key='announcement' AND setting.version=1 AND setting.updated_by IS NULL AND setting.value='{"enabled":false,"text":""}'::jsonb)
   OR (state.seeded_feature_flags AND setting.key='feature_flags' AND setting.version=1 AND setting.updated_by IS NULL AND setting.value='{"registrationEnabled":true,"submissionsEnabled":true,"commentsEnabled":true,"legacyMigrationEnabled":false}'::jsonb)
 );
DROP TABLE public.admin_console_install_state;
DROP TRIGGER IF EXISTS upload_files_cleanup_admin_version ON public.upload_files;
DROP FUNCTION IF EXISTS public.bump_upload_cleanup_admin_version();
ALTER TABLE public.upload_files DROP COLUMN cleanup_admin_version;
DROP INDEX IF EXISTS public.question_bank_key_version_key;
ALTER TABLE public.question_bank DROP COLUMN question_key;
ALTER TABLE public.snapshot_jobs DROP COLUMN admin_version;
ALTER TABLE public.app_users DROP COLUMN version;
COMMIT;
