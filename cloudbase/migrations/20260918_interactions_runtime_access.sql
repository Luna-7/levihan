\if :{?backend_role}
\else
\echo 'backend_role is required; pass -v backend_role=your_backend_role'
\quit 3
\endif
BEGIN;
REVOKE ALL ON TABLE public.work_likes,public.favorites,public.comments,public.reading_progress,public.reports,public.moderation_actions,public.audit_logs FROM :"backend_role";
REVOKE EXECUTE ON FUNCTION public.set_work_like(uuid,uuid,boolean),public.set_favorite(uuid,uuid,boolean),public.sync_reading_progress(uuid,uuid,bigint,numeric,bigint,timestamptz) FROM :"backend_role";
GRANT EXECUTE ON FUNCTION public.set_work_reaction_v2(uuid,uuid,text,text,boolean),
  public.list_work_comments_v2(uuid,uuid,text,integer,timestamptz,uuid),public.create_work_comment_v2(uuid,uuid,text,text,uuid,text),
  public.delete_work_comment_v2(uuid,uuid,uuid,text),public.moderate_work_comment_v2(uuid,uuid,uuid,text,text,text),
  public.get_reading_progress_v2(uuid,uuid,text),public.sync_reading_progress_v2(uuid,uuid,text,jsonb,numeric,integer,bigint,bigint,uuid),
  public.create_interaction_report_v2(uuid,uuid,text,uuid,text,text,text),public.moderate_interaction_report_v2(uuid,uuid,uuid,text,text,text)
TO :"backend_role";
COMMIT;
