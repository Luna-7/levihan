\if :{?backend_role}
\else
\echo 'backend_role variable is required'
\quit 3
\endif
BEGIN;
REVOKE EXECUTE ON FUNCTION public.create_submission_draft_v2(uuid,uuid,text,text,text,jsonb,text,text,text),public.update_submission_draft_v2(uuid,uuid,uuid,bigint,text,text,jsonb,text,text,text),public.transition_submission_v2(uuid,uuid,uuid,bigint,text,text,text,text),public.review_submission_v2(uuid,uuid,uuid,bigint,text,text,text,text,text,text),public.list_my_submissions_v2(uuid,uuid,integer,timestamptz,uuid),public.get_my_submission_v2(uuid,uuid,uuid),public.list_admin_submissions_v2(uuid,uuid,text,integer,timestamptz,uuid),public.create_submission_upload_v2(uuid,uuid,uuid,text,uuid,uuid,text,bigint,text,text,text,integer,timestamptz,text,text,text),public.get_submission_upload_v2(uuid,uuid,uuid,uuid),public.begin_submission_upload_promotion_v2(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,text,text),public.complete_submission_upload_v2(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text) FROM :"backend_role";
GRANT SELECT,INSERT,UPDATE ON TABLE public.submissions,public.submission_assets TO :"backend_role";
COMMIT;
