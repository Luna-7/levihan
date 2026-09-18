\if :{?backend_role}
\else
\echo 'backend_role is required; pass -v backend_role=your_backend_role'
\quit 3
\endif

BEGIN;

GRANT SELECT ON TABLE public.work_chapters TO :"backend_role";
REVOKE INSERT, UPDATE, DELETE ON TABLE public.works, public.work_assets, public.work_chapters,
  public.work_versions, public.upload_sessions, public.upload_files, public.snapshot_jobs,
  public.snapshot_versions, public.snapshot_current, public.audit_logs FROM :"backend_role";

DROP POLICY IF EXISTS content_pipeline_runtime_select ON public.work_chapters;
CREATE POLICY content_pipeline_runtime_select ON public.work_chapters FOR SELECT TO :"backend_role" USING (true);

GRANT EXECUTE ON FUNCTION
  public.create_work_draft(text,text,text,text,text,text,uuid,text,text),
  public.update_work_draft(uuid,bigint,jsonb,jsonb,uuid,text,text),
  public.transition_work_state(uuid,bigint,text,text,text,uuid,text,text),
  public.create_work_upload(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,integer,text,timestamptz,text,text,text),
  public.get_work_upload_for_completion(uuid,uuid),
  public.begin_work_upload_promotion(uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,text),
  public.complete_work_upload(uuid,uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,text,integer,text,text),
  public.begin_snapshot_build(text,uuid,text,text), public.list_public_catalog(),
  public.prepare_snapshot_version(uuid,uuid,text,bigint,text,text), public.get_current_snapshot(text),
  public.complete_snapshot_build(uuid,uuid,uuid,text), public.fail_snapshot_build(uuid,uuid,text),
  public.claim_stale_upload_promotions(uuid,integer), public.finalize_upload_promotion_cleanup(uuid,uuid,uuid),
  public.get_admin_work(uuid), public.get_public_work(text), public.list_admin_works(integer,text,text)
TO :"backend_role";

COMMIT;
