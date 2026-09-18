BEGIN;

DROP TRIGGER IF EXISTS work_chapters_set_updated_at ON public.work_chapters;

DROP FUNCTION IF EXISTS public.list_admin_works(integer,text,text);
DROP FUNCTION IF EXISTS public.get_public_work(text);
DROP FUNCTION IF EXISTS public.get_admin_work(uuid);
DROP FUNCTION IF EXISTS public.fail_snapshot_build(uuid,text);
DROP FUNCTION IF EXISTS public.complete_snapshot_build(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.prepare_snapshot_version(uuid,text,bigint,text,text);
DROP FUNCTION IF EXISTS public.list_public_catalog();
DROP FUNCTION IF EXISTS public.begin_snapshot_build(text,uuid,text);
DROP FUNCTION IF EXISTS public.complete_work_upload(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,text,integer,text,text);
DROP FUNCTION IF EXISTS public.get_work_upload_for_completion(uuid,uuid);
DROP FUNCTION IF EXISTS public.create_work_upload(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,integer,text,timestamptz,text);
DROP FUNCTION IF EXISTS public.transition_work_state(uuid,bigint,text,text,text,uuid,text);
DROP FUNCTION IF EXISTS public.update_work_draft(uuid,bigint,jsonb,jsonb,uuid,text);
DROP FUNCTION IF EXISTS public.create_work_draft(text,text,text,text,text,text,uuid,text);

DROP INDEX IF EXISTS public.upload_files_chapter_idx;
DROP INDEX IF EXISTS public.upload_files_work_idx;
ALTER TABLE public.upload_files DROP CONSTRAINT IF EXISTS upload_files_page_shape;
ALTER TABLE public.upload_files DROP CONSTRAINT IF EXISTS upload_files_work_shape;
ALTER TABLE public.upload_files DROP CONSTRAINT IF EXISTS upload_files_expected_checksum_format;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS etag;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS access_level;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS page_no;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS kind;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS expected_checksum;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS chapter_id;
ALTER TABLE public.upload_files DROP COLUMN IF EXISTS work_id;

UPDATE public.snapshot_jobs SET status = 'failed', last_error = 'content pipeline rolled back' WHERE status = 'prepared';
ALTER TABLE public.snapshot_jobs DROP CONSTRAINT IF EXISTS snapshot_jobs_status_check;
ALTER TABLE public.snapshot_jobs ADD CONSTRAINT snapshot_jobs_status_check
  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'));

DROP INDEX IF EXISTS public.work_assets_chapter_idx;
DROP INDEX IF EXISTS public.work_assets_chapter_slot_key;
DROP INDEX IF EXISTS public.work_assets_work_root_slot_key;
ALTER TABLE public.work_assets DROP COLUMN IF EXISTS chapter_id;
ALTER TABLE public.work_assets ADD CONSTRAINT work_assets_work_id_kind_page_no_key UNIQUE (work_id, kind, page_no);

DROP TABLE IF EXISTS public.work_chapters;

COMMIT;
