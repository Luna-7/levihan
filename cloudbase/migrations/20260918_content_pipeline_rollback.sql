BEGIN;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.upload_files
    WHERE status IN ('promoting','cleanup_pending')
      OR ((promotion_token IS NOT NULL OR cleanup_token IS NOT NULL)
          AND status NOT IN ('bound','orphaned','deleted','rejected'))
  ) THEN
    RAISE EXCEPTION 'rollback_requires_promotion_drain' USING ERRCODE='P0001';
  END IF;
END $$;

-- Safe only before content uses the expanded chapter/asset cardinality. Export and
-- transform content (or restore the database) once these predicates become true.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.work_assets WHERE chapter_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.work_assets WHERE kind IN ('cover','body') AND status <> 'deleted' GROUP BY work_id,kind HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM public.work_assets WHERE kind='page' AND status <> 'deleted' GROUP BY work_id,page_no HAVING count(*) > 1)
  THEN RAISE EXCEPTION 'rollback_requires_content_export' USING ERRCODE='P0001'; END IF;
END $$;

DROP TRIGGER IF EXISTS work_chapters_set_updated_at ON public.work_chapters;

DROP FUNCTION IF EXISTS public.list_admin_works(integer,text,text);
DROP FUNCTION IF EXISTS public.get_public_work(text);
DROP FUNCTION IF EXISTS public.get_admin_work(uuid);
DROP FUNCTION IF EXISTS public.fail_snapshot_build(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.complete_snapshot_build(uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.get_current_snapshot(text);
DROP FUNCTION IF EXISTS public.claim_stale_upload_promotions(uuid,integer);
DROP FUNCTION IF EXISTS public.finalize_upload_promotion_cleanup(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.fail_upload_promotion_cleanup(uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.prepare_snapshot_version(uuid,uuid,text,bigint,text,text);
DROP FUNCTION IF EXISTS public.list_public_catalog();
DROP FUNCTION IF EXISTS public.begin_snapshot_build(text,uuid,text,text);
DROP FUNCTION IF EXISTS public.complete_work_upload(uuid,uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,text,integer,text,text);
DROP FUNCTION IF EXISTS public.begin_work_upload_promotion(uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,text);
DROP FUNCTION IF EXISTS public.get_work_upload_for_completion(uuid,uuid);
DROP FUNCTION IF EXISTS public.create_work_upload(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,integer,text,timestamptz,text,text,text);
DROP FUNCTION IF EXISTS public.transition_work_state(uuid,bigint,text,text,text,uuid,text,text);
DROP FUNCTION IF EXISTS public.update_work_draft(uuid,bigint,jsonb,jsonb,uuid,text,text);
DROP FUNCTION IF EXISTS public.create_work_draft(text,text,text,text,text,text,uuid,text,text);

DROP INDEX IF EXISTS public.audit_logs_actor_action_idempotency_key;
ALTER TABLE public.audit_logs DROP COLUMN IF EXISTS idempotency_key;

DROP INDEX IF EXISTS public.upload_files_chapter_idx;
DROP INDEX IF EXISTS public.upload_files_work_idx;
DROP INDEX IF EXISTS public.upload_files_promotion_cleanup_idx;
DROP INDEX IF EXISTS public.upload_files_cleanup_retry_idx;
ALTER TABLE public.upload_files DROP CONSTRAINT IF EXISTS upload_files_status_check;
UPDATE public.upload_files SET status = 'uploaded' WHERE status IN ('promoting','cleanup_pending');
ALTER TABLE public.upload_files ADD CONSTRAINT upload_files_status_check
  CHECK (status IN ('declared','uploaded','verified','bound','rejected','orphaned','deleted'));
DROP INDEX IF EXISTS public.upload_sessions_owner_purpose_idempotency_key;
ALTER TABLE public.upload_sessions DROP COLUMN IF EXISTS idempotency_key;
ALTER TABLE public.upload_sessions DROP COLUMN IF EXISTS request_hash;
ALTER TABLE public.upload_files DROP CONSTRAINT IF EXISTS upload_files_page_shape;
ALTER TABLE public.upload_files DROP CONSTRAINT IF EXISTS upload_files_work_shape;
ALTER TABLE public.upload_files DROP CONSTRAINT IF EXISTS upload_files_expected_checksum_format;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS etag;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS content_disposition;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS scan_status;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS promotion_started_at;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS promotion_token;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS cleanup_token;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS cleanup_attempts;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS cleanup_last_error;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS cleanup_next_retry_at;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS storage_zone;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS final_object_key;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS asset_id;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS access_level;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS page_no;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS kind;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS expected_checksum;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS chapter_id;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS work_id;

UPDATE public.snapshot_jobs SET status = 'failed', last_error = 'content pipeline rolled back' WHERE status = 'prepared';
DROP INDEX IF EXISTS public.snapshot_jobs_one_active_type;
ALTER TABLE public.snapshot_jobs DROP COLUMN IF EXISTS lease_expires_at;
ALTER TABLE public.snapshot_jobs DROP COLUMN IF EXISTS delivery_version;
ALTER TABLE public.snapshot_jobs DROP COLUMN IF EXISTS lease_token;
ALTER TABLE public.snapshot_jobs DROP COLUMN IF EXISTS lease_epoch;
ALTER TABLE public.snapshot_jobs DROP COLUMN IF EXISTS build_generated_at;
ALTER TABLE public.snapshot_jobs DROP CONSTRAINT IF EXISTS snapshot_jobs_status_check;
ALTER TABLE public.snapshot_jobs ADD CONSTRAINT snapshot_jobs_status_check
  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'));
DROP TABLE IF EXISTS public.snapshot_current;

DROP INDEX IF EXISTS public.work_assets_chapter_idx;
DROP INDEX IF EXISTS public.work_assets_chapter_page_key;
DROP INDEX IF EXISTS public.work_assets_chapter_body_key;
DROP INDEX IF EXISTS public.work_assets_chapter_cover_key;
DROP INDEX IF EXISTS public.work_assets_root_page_key;
DROP INDEX IF EXISTS public.work_assets_root_body_key;
DROP INDEX IF EXISTS public.work_assets_root_cover_key;
ALTER TABLE public.work_assets DROP CONSTRAINT IF EXISTS work_assets_zone_key;
ALTER TABLE public.work_assets DROP COLUMN IF EXISTS storage_zone;
ALTER TABLE public.work_assets DROP COLUMN IF EXISTS chapter_id;
ALTER TABLE public.work_assets ADD CONSTRAINT work_assets_work_id_kind_page_no_key UNIQUE (work_id, kind, page_no);

DROP TABLE IF EXISTS public.work_chapters;

COMMIT;
