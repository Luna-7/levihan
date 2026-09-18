\if :{?backend_role}
\else
\echo 'backend_role variable is required'
\quit 3
\endif
BEGIN;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_v2(uuid,uuid),public.admin_list_users_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid),public.admin_list_questions_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid),public.admin_list_comments_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid),public.admin_list_reports_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid),public.admin_list_jobs_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid),public.admin_list_audit_v2(uuid,uuid,text,text,text,integer,timestamptz,uuid),public.admin_set_user_status_v2(uuid,uuid,uuid,bigint,text,text,text,text,text),public.admin_create_question_v2(uuid,uuid,text,jsonb,text[],text,integer,text,text,text),public.admin_update_question_v2(uuid,uuid,uuid,integer,jsonb,text,text,text),public.admin_set_question_status_v2(uuid,uuid,uuid,integer,text,text,text,text),public.admin_retry_job_v2(uuid,uuid,uuid,bigint,text,text,text) FROM :"backend_role";
COMMIT;
