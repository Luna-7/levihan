\if :{?backend_role}
\else
\echo 'backend_role variable is required'
\quit 3
\endif
BEGIN;
REVOKE ALL ON TABLE public.admin_console_operations FROM :"backend_role";
GRANT EXECUTE ON FUNCTION public.admin_dashboard_v2(uuid,uuid),
 public.admin_list_users_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid),public.admin_list_questions_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid),
 public.admin_list_comments_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid),public.admin_list_reports_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid),
 public.admin_list_jobs_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid),public.admin_list_audit_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid),
 public.admin_set_user_status_v2(uuid,uuid,uuid,bigint,text,text,text,text,text),public.admin_create_question_v2(uuid,uuid,text,jsonb,text[],text,integer,text,text,text),
 public.admin_update_question_v2(uuid,uuid,uuid,integer,jsonb,text,text,text),public.admin_set_question_status_v2(uuid,uuid,uuid,integer,text,text,text,text),
 public.admin_retry_job_v2(uuid,uuid,uuid,bigint,text,text,text),public.admin_get_reauth_credential_v2(uuid,uuid),
 public.admin_mark_reauthenticated_v2(uuid,uuid,text),public.admin_promote_user_v2(uuid,uuid,uuid,bigint,text,text,text,text),
 public.admin_get_settings_v2(uuid,uuid),public.admin_update_setting_v2(uuid,uuid,text,bigint,jsonb,text,text,text),
 public.admin_health_v2(uuid,uuid) TO :"backend_role";
COMMIT;
