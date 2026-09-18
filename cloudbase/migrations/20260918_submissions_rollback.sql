BEGIN;
LOCK TABLE public.submission_operations,public.submissions,public.submission_assets,public.upload_sessions,public.upload_files IN SHARE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.submission_operations)
    OR EXISTS(SELECT 1 FROM public.submissions WHERE status='accepted' OR submitted_at IS NOT NULL OR version>1 OR rejection_reason IS NOT NULL OR internal_note IS NOT NULL OR accepted_work_id IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.upload_sessions WHERE purpose='submission_asset')
    OR EXISTS(SELECT 1 FROM public.submission_install_state state WHERE (SELECT count(*) FROM public.submissions)<>state.existing_count)
  THEN RAISE EXCEPTION 'rollback_requires_submission_export'; END IF;
END $$;
DROP FUNCTION IF EXISTS public.complete_submission_upload_v2(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text);
DROP FUNCTION IF EXISTS public.begin_submission_upload_promotion_v2(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,text,text);
DROP FUNCTION IF EXISTS public.get_submission_upload_v2(uuid,uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.create_submission_upload_v2(uuid,uuid,uuid,text,uuid,uuid,text,bigint,text,text,text,integer,timestamptz,text,text,text);
DROP FUNCTION IF EXISTS public.list_admin_submissions_v2(uuid,uuid,text,integer,timestamptz,uuid);
DROP FUNCTION IF EXISTS public.get_my_submission_v2(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.list_my_submissions_v2(uuid,uuid,integer,timestamptz,uuid);
DROP FUNCTION IF EXISTS public.review_submission_v2(uuid,uuid,uuid,bigint,text,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.transition_submission_v2(uuid,uuid,uuid,bigint,text,text,text,text);
DROP FUNCTION IF EXISTS public.update_submission_draft_v2(uuid,uuid,uuid,bigint,text,text,jsonb,text,text,text);
DROP FUNCTION IF EXISTS public.create_submission_draft_v2(uuid,uuid,text,text,text,jsonb,text,text,text);
DROP FUNCTION IF EXISTS public.submission_store_operation(uuid,text,text,text,jsonb);
DROP FUNCTION IF EXISTS public.submission_operation_replay(uuid,text,text,text);
CREATE OR REPLACE FUNCTION public.claim_stale_upload_promotions(p_actor_id uuid, p_limit integer)
RETURNS TABLE(upload_id uuid,file_id uuid,staging_key text,final_key text,storage_zone text,cleanup_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM 1 FROM public.app_users WHERE id=p_actor_id AND status='active' AND role='admin' FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  RETURN QUERY WITH claimed AS (
    SELECT f.id FROM public.upload_files f WHERE (
      (f.status='promoting' AND f.promotion_started_at < clock_timestamp()-interval '30 minutes')
      OR (f.status='cleanup_pending' AND (f.cleanup_next_retry_at IS NULL OR f.cleanup_next_retry_at <= clock_timestamp()))
    ) AND f.asset_id IS NULL
    ORDER BY f.promotion_started_at,f.id LIMIT LEAST(GREATEST(p_limit,1),100) FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE public.upload_files f SET status='cleanup_pending',cleanup_token=gen_random_uuid(),cleanup_next_retry_at=clock_timestamp()+interval '5 minutes'
    FROM claimed c WHERE f.id=c.id AND f.status IN ('promoting','cleanup_pending')
    RETURNING f.*
  ) SELECT u.session_id,u.id,u.object_key,u.final_object_key,u.storage_zone,u.cleanup_token FROM updated u;
END;
$$;
DELETE FROM public.site_settings WHERE key='submission_policy' AND EXISTS(SELECT 1 FROM public.submission_install_state WHERE singleton=true AND seeded_policy=true);
DROP TABLE public.submission_operations;
DROP TABLE public.submission_install_state;
DROP INDEX IF EXISTS upload_files_submission_idx,submission_assets_page_slot_idx,submission_assets_cover_slot_idx,submission_assets_body_slot_idx,submissions_review_queue_v2_idx,submissions_daily_quota_idx;
ALTER TABLE public.upload_files DROP CONSTRAINT upload_files_submission_shape,DROP COLUMN submission_page_no,DROP COLUMN submission_kind,DROP COLUMN submission_id;
ALTER TABLE public.submission_assets DROP CONSTRAINT submission_assets_page_shape,DROP COLUMN accepted_asset_id,DROP COLUMN page_no,DROP COLUMN kind;
ALTER TABLE public.submissions DROP CONSTRAINT submissions_review_shape,DROP COLUMN accepted_work_id,DROP COLUMN internal_note,DROP COLUMN rejection_reason,DROP COLUMN reviewed_at,DROP COLUMN reviewed_by,DROP COLUMN submitted_at,DROP COLUMN version,DROP COLUMN summary;
ALTER TABLE public.submissions DROP CONSTRAINT submissions_status_check;
UPDATE public.submissions SET status='reviewing' WHERE status='under_review';
ALTER TABLE public.submissions ADD CONSTRAINT submissions_status_check CHECK(status IN ('draft','submitted','reviewing','approved','request_changes','rejected','withdrawn'));
COMMIT;
