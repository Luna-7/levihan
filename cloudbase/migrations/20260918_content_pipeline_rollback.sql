BEGIN;

DROP TRIGGER IF EXISTS work_chapters_set_updated_at ON public.work_chapters;

DROP FUNCTION IF EXISTS public.list_admin_works(integer,text,text);
DROP FUNCTION IF EXISTS public.get_public_work(text);
DROP FUNCTION IF EXISTS public.get_admin_work(uuid);
DROP FUNCTION IF EXISTS public.fail_snapshot_build(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.complete_snapshot_build(uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.authorize_snapshot_manifest(uuid,uuid);
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
ALTER TABLE public.upload_files DROP CONSTRAINT IF EXISTS upload_files_status_check;
UPDATE public.upload_files SET status = 'uploaded' WHERE status = 'promoting';
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
ALTER TABLE public.snapshot_jobs DROP CONSTRAINT IF EXISTS snapshot_jobs_status_check;
ALTER TABLE public.snapshot_jobs ADD CONSTRAINT snapshot_jobs_status_check
  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'));

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
