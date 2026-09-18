BEGIN;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.submissions WHERE status IN ('approved','request_changes'))
  THEN RAISE EXCEPTION 'legacy_submission_export_required'; END IF;
END $$;
ALTER TABLE public.submissions DROP CONSTRAINT submissions_status_check;
UPDATE public.submissions SET status='under_review' WHERE status='reviewing';
ALTER TABLE public.submissions ADD CONSTRAINT submissions_status_check CHECK (status IN ('draft','submitted','under_review','accepted','rejected','withdrawn'));
ALTER TABLE public.submissions
  ADD COLUMN summary text NOT NULL DEFAULT '' CHECK (length(summary)<=2000),
  ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN rejection_reason text CHECK (rejection_reason IS NULL OR length(rejection_reason) BETWEEN 1 AND 500),
  ADD COLUMN internal_note text CHECK (internal_note IS NULL OR length(internal_note) BETWEEN 1 AND 2000),
  ADD COLUMN accepted_work_id uuid REFERENCES public.works(id) ON DELETE RESTRICT,
  ADD CONSTRAINT submissions_review_shape CHECK (
    (status='accepted' AND accepted_work_id IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (status='rejected' AND rejection_reason IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND accepted_work_id IS NULL)
    OR (status NOT IN ('accepted','rejected') AND accepted_work_id IS NULL)
  ) NOT VALID;
CREATE INDEX submissions_review_queue_v2_idx ON public.submissions(status,updated_at,id);
CREATE INDEX submissions_daily_quota_idx ON public.submissions(user_id,submitted_at) WHERE submitted_at IS NOT NULL;

ALTER TABLE public.submission_assets
  ADD COLUMN kind text NOT NULL DEFAULT 'attachment' CHECK (kind IN ('cover','page','body','attachment')),
  ADD COLUMN page_no integer CHECK (page_no IS NULL OR page_no BETWEEN 1 AND 100000),
  ADD COLUMN accepted_asset_id uuid REFERENCES public.work_assets(id) ON DELETE RESTRICT,
  ADD CONSTRAINT submission_assets_page_shape CHECK ((kind='page')=(page_no IS NOT NULL));
CREATE UNIQUE INDEX submission_assets_page_slot_idx ON public.submission_assets(submission_id,page_no) WHERE kind='page';
CREATE UNIQUE INDEX submission_assets_cover_slot_idx ON public.submission_assets(submission_id) WHERE kind='cover';
CREATE UNIQUE INDEX submission_assets_body_slot_idx ON public.submission_assets(submission_id) WHERE kind='body';

ALTER TABLE public.upload_files
  ADD COLUMN submission_id uuid REFERENCES public.submissions(id) ON DELETE RESTRICT,
  ADD COLUMN submission_kind text CHECK (submission_kind IS NULL OR submission_kind IN ('cover','page','body','attachment')),
  ADD COLUMN submission_page_no integer CHECK (submission_page_no IS NULL OR submission_page_no BETWEEN 1 AND 100000),
  ADD CONSTRAINT upload_files_submission_shape CHECK (
    (submission_id IS NULL AND submission_kind IS NULL AND submission_page_no IS NULL)
    OR (submission_id IS NOT NULL AND submission_kind IS NOT NULL AND ((submission_kind='page')=(submission_page_no IS NOT NULL)))
  );
CREATE INDEX upload_files_submission_idx ON public.upload_files(submission_id,status);

CREATE TABLE public.submission_operations (
  actor_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,idempotency_key)
);
ALTER TABLE public.submission_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.submission_operations FROM PUBLIC;

CREATE TABLE public.submission_install_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  installed_at timestamptz NOT NULL,
  existing_count bigint NOT NULL CHECK(existing_count>=0),
  seeded_policy boolean NOT NULL
);
WITH inserted_policy AS (
  INSERT INTO public.site_settings(key,value,version)
  VALUES('submission_policy','{"dailySubmitLimit":3,"maxAssets":50}'::jsonb,1)
  ON CONFLICT(key) DO NOTHING RETURNING 1
)
INSERT INTO public.submission_install_state(singleton,installed_at,existing_count,seeded_policy)
SELECT true,clock_timestamp(),(SELECT count(*) FROM public.submissions),EXISTS(SELECT 1 FROM inserted_policy);
ALTER TABLE public.submission_install_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.submission_install_state FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.claim_stale_upload_promotions(p_actor_id uuid, p_limit integer)
RETURNS TABLE(upload_id uuid,file_id uuid,staging_key text,final_key text,storage_zone text,cleanup_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM 1 FROM public.app_users WHERE id=p_actor_id AND status='active' AND role='admin' FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  UPDATE public.upload_sessions SET status='expired' WHERE purpose='submission_asset' AND status='open' AND expires_at<=clock_timestamp();
  RETURN QUERY WITH candidates AS (
    SELECT f.id,f.session_id FROM public.upload_files f JOIN public.upload_sessions session ON session.id=f.session_id WHERE (
      (f.status='promoting' AND f.promotion_started_at < clock_timestamp()-interval '30 minutes')
      OR (f.status='cleanup_pending' AND (f.cleanup_next_retry_at IS NULL OR f.cleanup_next_retry_at <= clock_timestamp()))
      OR (f.status='declared' AND f.submission_id IS NOT NULL AND session.purpose='submission_asset' AND session.status='expired')
    ) AND f.asset_id IS NULL ORDER BY COALESCE(f.promotion_started_at,f.created_at),f.id LIMIT LEAST(GREATEST(p_limit,1),100) FOR UPDATE OF f SKIP LOCKED
  ), updated AS (
    UPDATE public.upload_files f SET status='cleanup_pending',cleanup_token=gen_random_uuid(),cleanup_next_retry_at=clock_timestamp()+interval '5 minutes'
    FROM candidates c WHERE f.id=c.id AND f.status IN ('declared','promoting','cleanup_pending') RETURNING f.*
  ) SELECT u.session_id,u.id,u.object_key,u.final_object_key,u.storage_zone,u.cleanup_token FROM updated u;
END;
$$;

CREATE FUNCTION public.submission_operation_replay(p_actor_id uuid,p_key text,p_hash text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE operation public.submission_operations%ROWTYPE;
BEGIN
  IF p_key !~ '^[A-Za-z0-9_-]{8,128}$' OR p_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'validation_failed'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('submission-operation:'||p_actor_id::text||':'||p_key,20260918));
  SELECT * INTO operation FROM public.submission_operations WHERE actor_id=p_actor_id AND idempotency_key=p_key FOR UPDATE;
  IF FOUND AND (operation.request_hash<>p_hash OR operation.action<>p_action) THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN CASE WHEN FOUND THEN operation.result ELSE NULL END;
END;
$$;

CREATE FUNCTION public.submission_store_operation(p_actor_id uuid,p_key text,p_hash text,p_action text,p_result jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO public.submission_operations(actor_id,idempotency_key,request_hash,action,result) VALUES(p_actor_id,p_key,p_hash,p_action,p_result);
END;
$$;

CREATE FUNCTION public.create_submission_draft_v2(p_user_id uuid,p_session_id uuid,p_type text,p_title text,p_summary text,p_payload jsonb,p_idempotency_key text,p_request_hash text,p_request_id text)
RETURNS TABLE(id uuid,type text,title text,summary text,status text,version bigint,asset_count bigint,rejection_reason text,accepted_work_id uuid,created_at timestamptz,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE created public.submissions%ROWTYPE; replay jsonb;
BEGIN
  PERFORM public.interaction_assert_actor(p_user_id,p_session_id);
  replay:=public.submission_operation_replay(p_user_id,p_idempotency_key,p_request_hash,'submission.create');
  IF replay IS NOT NULL THEN RETURN QUERY SELECT (replay->>'id')::uuid,replay->>'type',replay->>'title',replay->>'summary',replay->>'status',(replay->>'version')::bigint,(replay->>'assetCount')::bigint,NULL::text,NULL::uuid,(replay->>'createdAt')::timestamptz,(replay->>'updatedAt')::timestamptz; RETURN; END IF;
  IF p_type NOT IN ('comic','novel','recommendation','other') OR length(btrim(p_title)) NOT BETWEEN 1 AND 120 OR length(btrim(p_summary))>2000 OR jsonb_typeof(p_payload)<>'object' OR p_payload-'description'-'rating'<>'{}'::jsonb OR length(COALESCE(p_payload->>'description',''))>10000 OR p_payload->>'rating' NOT IN ('general','mature','restricted') THEN RAISE EXCEPTION 'validation_failed'; END IF;
  INSERT INTO public.submissions(user_id,type,title,summary,payload,status) VALUES(p_user_id,p_type,btrim(p_title),btrim(p_summary),p_payload,'draft') RETURNING * INTO created;
  PERFORM public.submission_store_operation(p_user_id,p_idempotency_key,p_request_hash,'submission.create',jsonb_build_object('id',created.id,'type',created.type,'title',created.title,'summary',created.summary,'status',created.status,'version',created.version,'assetCount',0,'createdAt',created.created_at,'updatedAt',created.updated_at));
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id,idempotency_key) VALUES(p_user_id,'submission.create','submission',created.id,jsonb_build_object('status','draft','version',1),p_request_id,p_idempotency_key);
  RETURN QUERY SELECT created.id,created.type,created.title,created.summary,created.status,created.version,0::bigint,NULL::text,NULL::uuid,created.created_at,created.updated_at;
END;
$$;

CREATE FUNCTION public.update_submission_draft_v2(p_user_id uuid,p_session_id uuid,p_submission_id uuid,p_expected_version bigint,p_title text,p_summary text,p_payload jsonb,p_idempotency_key text,p_request_hash text,p_request_id text)
RETURNS TABLE(id uuid,type text,title text,summary text,status text,version bigint,asset_count bigint,rejection_reason text,accepted_work_id uuid,created_at timestamptz,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE submission public.submissions%ROWTYPE; replay jsonb; assets bigint;
BEGIN
  PERFORM public.interaction_assert_actor(p_user_id,p_session_id);
  replay:=public.submission_operation_replay(p_user_id,p_idempotency_key,p_request_hash,'submission.update');
  IF replay IS NOT NULL THEN RETURN QUERY SELECT (replay->>'id')::uuid,replay->>'type',replay->>'title',replay->>'summary',replay->>'status',(replay->>'version')::bigint,(replay->>'assetCount')::bigint,NULL::text,NULL::uuid,(replay->>'createdAt')::timestamptz,(replay->>'updatedAt')::timestamptz; RETURN; END IF;
  SELECT * INTO submission FROM public.submissions WHERE submissions.id=p_submission_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF submission.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF;
  IF submission.status<>'draft' THEN RAISE EXCEPTION 'state_conflict'; END IF;
  IF p_title IS NOT NULL AND length(btrim(p_title)) NOT BETWEEN 1 AND 120 OR p_summary IS NOT NULL AND length(btrim(p_summary))>2000 OR jsonb_typeof(p_payload)<>'object' OR p_payload-'description'-'rating'<>'{}'::jsonb OR length(COALESCE(p_payload->>'description',''))>10000 OR p_payload ? 'rating' AND p_payload->>'rating' NOT IN ('general','mature','restricted') THEN RAISE EXCEPTION 'validation_failed'; END IF;
  UPDATE public.submissions SET title=COALESCE(btrim(p_title),title),summary=COALESCE(btrim(p_summary),summary),payload=payload||p_payload,version=version+1 WHERE submissions.id=p_submission_id RETURNING * INTO submission;
  SELECT count(*) INTO assets FROM public.submission_assets WHERE submission_id=p_submission_id;
  PERFORM public.submission_store_operation(p_user_id,p_idempotency_key,p_request_hash,'submission.update',jsonb_build_object('id',submission.id,'type',submission.type,'title',submission.title,'summary',submission.summary,'status',submission.status,'version',submission.version,'assetCount',assets,'createdAt',submission.created_at,'updatedAt',submission.updated_at));
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id,idempotency_key) VALUES(p_user_id,'submission.update','submission',submission.id,jsonb_build_object('status',submission.status,'version',submission.version),p_request_id,p_idempotency_key);
  RETURN QUERY SELECT submission.id,submission.type,submission.title,submission.summary,submission.status,submission.version,assets,submission.rejection_reason,submission.accepted_work_id,submission.created_at,submission.updated_at;
END;
$$;

CREATE FUNCTION public.transition_submission_v2(p_user_id uuid,p_session_id uuid,p_submission_id uuid,p_expected_version bigint,p_action text,p_idempotency_key text,p_request_hash text,p_request_id text)
RETURNS TABLE(id uuid,type text,title text,summary text,status text,version bigint,asset_count bigint,rejection_reason text,accepted_work_id uuid,created_at timestamptz,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE submission public.submissions%ROWTYPE; replay jsonb; assets bigint; policy jsonb; used integer; next_status text;
BEGIN
  PERFORM public.interaction_assert_actor(p_user_id,p_session_id);
  replay:=public.submission_operation_replay(p_user_id,p_idempotency_key,p_request_hash,'submission.'||p_action);
  IF replay IS NOT NULL THEN RETURN QUERY SELECT (replay->>'id')::uuid,replay->>'type',replay->>'title',replay->>'summary',replay->>'status',(replay->>'version')::bigint,(replay->>'assetCount')::bigint,replay->>'rejectionReason',NULLIF(replay->>'acceptedWorkId','')::uuid,(replay->>'createdAt')::timestamptz,(replay->>'updatedAt')::timestamptz; RETURN; END IF;
  SELECT * INTO submission FROM public.submissions WHERE submissions.id=p_submission_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF submission.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF;
  SELECT count(*) INTO assets FROM public.submission_assets asset JOIN public.upload_files file ON file.id=asset.upload_file_id WHERE asset.submission_id=p_submission_id AND file.status='bound' AND file.final_object_key LIKE 'protected/works/'||p_submission_id||'/%';
  IF submission.status='draft' AND p_action='submit' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('submission-quota:'||p_user_id::text,20260918));
    SELECT value INTO policy FROM public.site_settings WHERE key='submission_policy' FOR SHARE;
    SELECT count(*) INTO used FROM public.submissions quota WHERE quota.user_id=p_user_id AND quota.submitted_at>=date_trunc('day',clock_timestamp()) AND quota.submitted_at<date_trunc('day',clock_timestamp())+interval '1 day';
    IF used>=COALESCE((policy->>'dailySubmitLimit')::integer,3) THEN RAISE EXCEPTION 'daily_quota_exceeded'; END IF;
    IF assets>COALESCE((policy->>'maxAssets')::integer,50) OR EXISTS(SELECT 1 FROM public.submission_assets asset JOIN public.upload_files file ON file.id=asset.upload_file_id WHERE asset.submission_id=p_submission_id AND (file.status<>'bound' OR file.final_object_key NOT LIKE 'protected/works/'||p_submission_id||'/%' OR file.storage_zone<>'private')) THEN RAISE EXCEPTION 'upload_not_verified'; END IF;
    IF submission.type='comic' AND NOT EXISTS(SELECT 1 FROM public.submission_assets WHERE submission_id=p_submission_id AND kind='page') OR submission.type='novel' AND NOT EXISTS(SELECT 1 FROM public.submission_assets WHERE submission_id=p_submission_id AND kind='body') THEN RAISE EXCEPTION 'assets_incomplete'; END IF;
    next_status:='submitted'; UPDATE public.submissions SET status=next_status,submitted_at=clock_timestamp(),version=version+1 WHERE submissions.id=p_submission_id RETURNING * INTO submission;
  ELSIF submission.status IN ('draft','submitted') AND p_action='withdraw' THEN
    next_status:='withdrawn'; UPDATE public.submissions SET status=next_status,version=version+1 WHERE submissions.id=p_submission_id RETURNING * INTO submission;
    UPDATE public.upload_files file SET status='cleanup_pending',promotion_started_at=clock_timestamp(),cleanup_next_retry_at=clock_timestamp() WHERE file.submission_id=p_submission_id AND file.asset_id IS NULL AND file.status IN ('declared','promoting','bound');
  ELSE RAISE EXCEPTION 'state_conflict'; END IF;
  PERFORM public.submission_store_operation(p_user_id,p_idempotency_key,p_request_hash,'submission.'||p_action,jsonb_build_object('id',submission.id,'type',submission.type,'title',submission.title,'summary',submission.summary,'status',submission.status,'version',submission.version,'assetCount',assets,'rejectionReason',submission.rejection_reason,'acceptedWorkId',submission.accepted_work_id,'createdAt',submission.created_at,'updatedAt',submission.updated_at));
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id,idempotency_key) VALUES(p_user_id,'submission.'||p_action,'submission',submission.id,jsonb_build_object('status',submission.status,'version',submission.version),p_request_id,p_idempotency_key);
  RETURN QUERY SELECT submission.id,submission.type,submission.title,submission.summary,submission.status,submission.version,assets,submission.rejection_reason,submission.accepted_work_id,submission.created_at,submission.updated_at;
END;
$$;

CREATE FUNCTION public.review_submission_v2(p_admin_id uuid,p_admin_session_id uuid,p_submission_id uuid,p_expected_version bigint,p_action text,p_rejection_reason text,p_internal_note text,p_idempotency_key text,p_request_hash text,p_request_id text)
RETURNS TABLE(id uuid,type text,title text,summary text,status text,version bigint,asset_count bigint,rejection_reason text,accepted_work_id uuid,created_at timestamptz,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE submission public.submissions%ROWTYPE; replay jsonb; assets bigint; creator public.app_users%ROWTYPE; asset record; new_asset_id uuid; new_chapter_id uuid; mapped_type text; rating text;
BEGIN
  PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id);
  replay:=public.submission_operation_replay(p_admin_id,p_idempotency_key,p_request_hash,'submission.review.'||p_action);
  IF replay IS NOT NULL THEN RETURN QUERY SELECT (replay->>'id')::uuid,replay->>'type',replay->>'title',replay->>'summary',replay->>'status',(replay->>'version')::bigint,(replay->>'assetCount')::bigint,replay->>'rejectionReason',NULLIF(replay->>'acceptedWorkId','')::uuid,(replay->>'createdAt')::timestamptz,(replay->>'updatedAt')::timestamptz; RETURN; END IF;
  SELECT * INTO submission FROM public.submissions WHERE submissions.id=p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF submission.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF;
  SELECT count(*) INTO assets FROM public.submission_assets WHERE submission_id=p_submission_id;
  IF submission.status='submitted' AND p_action='start_review' THEN UPDATE public.submissions SET status='under_review',reviewed_by=p_admin_id,reviewed_at=clock_timestamp(),internal_note=COALESCE(NULLIF(btrim(p_internal_note),''),internal_note),version=version+1 WHERE submissions.id=p_submission_id RETURNING * INTO submission;
  ELSIF submission.status='under_review' AND p_action='reject' AND length(btrim(p_rejection_reason)) BETWEEN 1 AND 500 THEN
    UPDATE public.submissions SET status='rejected',rejection_reason=btrim(p_rejection_reason),reviewed_by=p_admin_id,reviewed_at=clock_timestamp(),internal_note=COALESCE(NULLIF(btrim(p_internal_note),''),internal_note),version=version+1 WHERE submissions.id=p_submission_id RETURNING * INTO submission;
    UPDATE public.upload_files file SET status='cleanup_pending',promotion_started_at=clock_timestamp(),cleanup_next_retry_at=clock_timestamp() WHERE file.submission_id=p_submission_id AND file.asset_id IS NULL AND file.status IN ('declared','promoting','bound');
  ELSIF submission.status='under_review' AND p_action='accept' THEN
    SELECT * INTO creator FROM public.app_users WHERE app_users.id=submission.user_id FOR KEY SHARE;
    mapped_type:=CASE WHEN submission.type IN ('comic','novel') THEN submission.type ELSE 'resource' END; rating:=COALESCE(submission.payload->>'rating','general');
    INSERT INTO public.works(id,slug,type,title,summary,rating,status,author_name,created_by,updated_by)
    VALUES(submission.id,'submission-'||replace(submission.id::text,'-',''),mapped_type,submission.title,submission.summary,rating,'draft',creator.username,submission.user_id,p_admin_id);
    IF mapped_type IN ('comic','novel') THEN INSERT INTO public.work_chapters(work_id,title,position,status,created_by,updated_by) VALUES(submission.id,'正文',1,'draft',submission.user_id,p_admin_id) RETURNING work_chapters.id INTO new_chapter_id; END IF;
    FOR asset IN SELECT sa.*,file.final_object_key,file.mime_type,COALESCE(file.checksum,file.expected_checksum) AS checksum,file.actual_size,file.etag FROM public.submission_assets sa JOIN public.upload_files file ON file.id=sa.upload_file_id WHERE sa.submission_id=p_submission_id AND file.status='bound' AND file.storage_zone='private' AND file.final_object_key LIKE 'protected/works/'||p_submission_id||'/%' ORDER BY COALESCE(sa.page_no,0),sa.upload_file_id FOR UPDATE LOOP
      INSERT INTO public.work_assets(work_id,chapter_id,kind,object_key,storage_zone,access_level,mime_type,size_bytes,checksum,page_no,status)
      VALUES(submission.id,CASE WHEN asset.kind IN ('page','body') THEN new_chapter_id ELSE NULL END,asset.kind,asset.final_object_key,'private','private',asset.mime_type,asset.actual_size,asset.checksum,asset.page_no,'verified') RETURNING work_assets.id INTO new_asset_id;
      UPDATE public.submission_assets SET accepted_asset_id=new_asset_id WHERE submission_id=p_submission_id AND upload_file_id=asset.upload_file_id;
      UPDATE public.upload_files SET asset_id=new_asset_id WHERE id=asset.upload_file_id;
    END LOOP;
    UPDATE public.submissions SET status='accepted',accepted_work_id=submission.id,reviewed_by=p_admin_id,reviewed_at=clock_timestamp(),internal_note=COALESCE(NULLIF(btrim(p_internal_note),''),internal_note),version=version+1 WHERE submissions.id=p_submission_id RETURNING * INTO submission;
  ELSE RAISE EXCEPTION 'state_conflict'; END IF;
  PERFORM public.submission_store_operation(p_admin_id,p_idempotency_key,p_request_hash,'submission.review.'||p_action,jsonb_build_object('id',submission.id,'type',submission.type,'title',submission.title,'summary',submission.summary,'status',submission.status,'version',submission.version,'assetCount',assets,'rejectionReason',submission.rejection_reason,'acceptedWorkId',submission.accepted_work_id,'createdAt',submission.created_at,'updatedAt',submission.updated_at));
  INSERT INTO public.moderation_actions(target_type,target_id,action,reason,admin_id) VALUES('submission',submission.id,CASE p_action WHEN 'start_review' THEN 'review' WHEN 'accept' THEN 'approve' ELSE 'reject' END,COALESCE(NULLIF(btrim(p_rejection_reason),''),'review'),p_admin_id);
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id,idempotency_key) VALUES(p_admin_id,'submission.review.'||p_action,'submission',submission.id,jsonb_build_object('status',submission.status,'version',submission.version,'acceptedWorkId',submission.accepted_work_id),p_request_id,p_idempotency_key);
  RETURN QUERY SELECT submission.id,submission.type,submission.title,submission.summary,submission.status,submission.version,assets,submission.rejection_reason,submission.accepted_work_id,submission.created_at,submission.updated_at;
END;
$$;

CREATE FUNCTION public.list_my_submissions_v2(p_user_id uuid,p_session_id uuid,p_limit integer,p_before_at timestamptz,p_before_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.interaction_assert_actor(p_user_id,p_session_id);
  RETURN (SELECT jsonb_build_object('items',COALESCE(jsonb_agg((to_jsonb(page) - 'internal_note' - 'user_id' - 'reviewed_by') ORDER BY page.updated_at DESC,page.id DESC),'[]'::jsonb),'next_cursor',CASE WHEN count(*)=p_limit THEN min(page.updated_at)::text||'|'||(array_agg(page.id ORDER BY page.updated_at,page.id))[1] ELSE NULL END) FROM (SELECT submission.*, (SELECT count(*) FROM public.submission_assets asset WHERE asset.submission_id=submission.id) asset_count, COALESCE((SELECT jsonb_agg(jsonb_build_object('file_id',file.id,'kind',asset.kind,'page_no',asset.page_no,'status',file.status,'mime_type',file.mime_type,'size_bytes',file.actual_size) ORDER BY COALESCE(asset.page_no,0),file.id) FROM public.submission_assets asset JOIN public.upload_files file ON file.id=asset.upload_file_id WHERE asset.submission_id=submission.id),'[]'::jsonb) assets FROM public.submissions submission WHERE submission.user_id=p_user_id AND (p_before_at IS NULL OR (submission.updated_at,submission.id)<(p_before_at,p_before_id)) ORDER BY submission.updated_at DESC,submission.id DESC LIMIT LEAST(GREATEST(p_limit,1),100)) page);
END;
$$;

CREATE FUNCTION public.get_my_submission_v2(p_user_id uuid,p_session_id uuid,p_submission_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.interaction_assert_actor(p_user_id,p_session_id);
  SELECT to_jsonb(submission)-'internal_note'-'user_id'-'reviewed_by' || jsonb_build_object(
    'asset_count',(SELECT count(*) FROM public.submission_assets asset WHERE asset.submission_id=submission.id),
    'assets',COALESCE((SELECT jsonb_agg(jsonb_build_object('file_id',file.id,'kind',asset.kind,'page_no',asset.page_no,'status',file.status,'mime_type',file.mime_type,'size_bytes',file.actual_size) ORDER BY COALESCE(asset.page_no,0),file.id) FROM public.submission_assets asset JOIN public.upload_files file ON file.id=asset.upload_file_id WHERE asset.submission_id=submission.id),'[]'::jsonb)
  ) INTO result FROM public.submissions submission WHERE submission.id=p_submission_id AND submission.user_id=p_user_id;
  IF result IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.list_admin_submissions_v2(p_admin_id uuid,p_admin_session_id uuid,p_status text,p_limit integer,p_before_at timestamptz,p_before_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id);
  RETURN (SELECT jsonb_build_object('items',COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.updated_at DESC,page.id DESC),'[]'::jsonb),'next_cursor',CASE WHEN count(*)=p_limit THEN min(page.updated_at)::text||'|'||(array_agg(page.id ORDER BY page.updated_at,page.id))[1] ELSE NULL END) FROM (SELECT submission.*, (SELECT count(*) FROM public.submission_assets asset WHERE asset.submission_id=submission.id) asset_count, COALESCE((SELECT jsonb_agg(jsonb_build_object('file_id',file.id,'kind',asset.kind,'page_no',asset.page_no,'status',file.status,'mime_type',file.mime_type,'size_bytes',file.actual_size) ORDER BY COALESCE(asset.page_no,0),file.id) FROM public.submission_assets asset JOIN public.upload_files file ON file.id=asset.upload_file_id WHERE asset.submission_id=submission.id),'[]'::jsonb) assets FROM public.submissions submission WHERE (p_status IS NULL OR submission.status=p_status) AND (p_before_at IS NULL OR (submission.updated_at,submission.id)<(p_before_at,p_before_id)) ORDER BY submission.updated_at DESC,submission.id DESC LIMIT LEAST(GREATEST(p_limit,1),100)) page);
END;
$$;

CREATE FUNCTION public.create_submission_upload_v2(p_user_id uuid,p_session_id uuid,p_submission_id uuid,p_submission_type text,p_upload_id uuid,p_file_id uuid,p_object_key text,p_expected_size bigint,p_mime_type text,p_checksum text,p_kind text,p_page_no integer,p_expires_at timestamptz,p_idempotency_key text,p_request_hash text,p_request_id text)
RETURNS TABLE(upload_id uuid,file_id uuid,object_key text,expires_at timestamptz,state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE upload_session public.upload_sessions%ROWTYPE; file public.upload_files%ROWTYPE; submission public.submissions%ROWTYPE; inserted integer; extension text;
BEGIN
  PERFORM public.interaction_assert_actor(p_user_id,p_session_id);
  SELECT * INTO submission FROM public.submissions WHERE id=p_submission_id AND user_id=p_user_id AND status='draft' FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'state_conflict'; END IF;
  extension:=split_part(p_object_key,'.',-1);
  IF p_submission_type<>submission.type OR NOT (
    submission.type='comic' AND p_kind IN ('page','cover') AND p_mime_type IN ('image/jpeg','image/png','image/webp','image/gif')
    OR submission.type='novel' AND (p_kind='body' AND p_mime_type IN ('text/plain','application/pdf','application/epub+zip') OR p_kind='cover' AND p_mime_type IN ('image/jpeg','image/png','image/webp','image/gif'))
    OR submission.type IN ('recommendation','other') AND (p_kind='attachment' AND p_mime_type IN ('image/jpeg','image/png','image/webp','image/gif','text/plain','application/pdf','application/epub+zip') OR p_kind='cover' AND p_mime_type IN ('image/jpeg','image/png','image/webp','image/gif'))
  ) OR NOT ((p_mime_type='image/jpeg' AND extension IN ('jpg','jpeg')) OR (p_mime_type='image/png' AND extension='png') OR (p_mime_type='image/webp' AND extension='webp') OR (p_mime_type='image/gif' AND extension='gif') OR (p_mime_type='text/plain' AND extension='txt') OR (p_mime_type='application/pdf' AND extension='pdf') OR (p_mime_type='application/epub+zip' AND extension='epub'))
    OR p_expected_size<1 OR p_expected_size>CASE WHEN p_mime_type='text/plain' THEN 5242880 WHEN p_mime_type LIKE 'image/%' THEN 20971520 ELSE 52428800 END THEN RAISE EXCEPTION 'upload_not_verified'; END IF;
  IF p_expires_at<=clock_timestamp() OR p_expires_at>clock_timestamp()+interval '5 minutes 30 seconds' OR p_request_hash!~'^[a-f0-9]{64}$' OR p_object_key<>'staging/submissions/'||p_user_id||'/'||p_submission_id||'/'||p_upload_id||'/'||p_file_id||'.'||split_part(p_object_key,'.',-1) THEN RAISE EXCEPTION 'upload_not_verified'; END IF;
  INSERT INTO public.upload_sessions(id,owner_id,purpose,status,expires_at,idempotency_key,request_hash) VALUES(p_upload_id,p_user_id,'submission_asset','open',p_expires_at,p_idempotency_key,p_request_hash) ON CONFLICT(owner_id,purpose,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING; GET DIAGNOSTICS inserted=ROW_COUNT;
  SELECT * INTO upload_session FROM public.upload_sessions current_upload_session WHERE current_upload_session.owner_id=p_user_id AND current_upload_session.purpose='submission_asset' AND current_upload_session.idempotency_key=p_idempotency_key FOR UPDATE;
  IF inserted=0 THEN SELECT * INTO file FROM public.upload_files WHERE session_id=upload_session.id FOR UPDATE; IF upload_session.request_hash<>p_request_hash OR file.submission_id<>p_submission_id OR file.expected_size<>p_expected_size OR file.mime_type<>p_mime_type OR file.expected_checksum<>p_checksum OR file.submission_kind<>p_kind OR file.submission_page_no IS DISTINCT FROM p_page_no THEN RAISE EXCEPTION 'idempotency_conflict'; END IF; IF file.status='bound' THEN RETURN QUERY SELECT upload_session.id,file.id,NULL::text,upload_session.expires_at,'bound'::text; RETURN; END IF; IF file.status='promoting' THEN RETURN QUERY SELECT upload_session.id,file.id,NULL::text,upload_session.expires_at,'promoting'::text; RETURN; END IF; IF file.status<>'declared' THEN RAISE EXCEPTION 'state_conflict'; END IF; UPDATE public.upload_sessions SET expires_at=p_expires_at WHERE id=upload_session.id; RETURN QUERY SELECT upload_session.id,file.id,file.object_key,p_expires_at,'declared'::text; RETURN; END IF;
  INSERT INTO public.upload_files(id,session_id,object_key,expected_size,mime_type,expected_checksum,status,submission_id,submission_kind,submission_page_no) VALUES(p_file_id,p_upload_id,p_object_key,p_expected_size,p_mime_type,p_checksum,'declared',p_submission_id,p_kind,p_page_no);
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id) VALUES(p_user_id,'submission.upload.create','submission',p_submission_id,jsonb_build_object('uploadId',p_upload_id,'kind',p_kind),p_request_id);
  RETURN QUERY SELECT p_upload_id,p_file_id,p_object_key,p_expires_at,'declared'::text;
END;
$$;

CREATE FUNCTION public.get_submission_upload_v2(p_user_id uuid,p_session_id uuid,p_submission_id uuid,p_upload_id uuid)
RETURNS TABLE(upload_id uuid,file_id uuid,submission_id uuid,owner_id uuid,purpose text,object_key text,expected_size bigint,mime_type text,expected_checksum text,submission_kind text,submission_page_no integer,expires_at timestamptz,status text,promotion_token uuid,final_object_key text,storage_zone text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.interaction_assert_actor(p_user_id,p_session_id);
  RETURN QUERY SELECT upload_session.id,file.id,file.submission_id,upload_session.owner_id,upload_session.purpose,file.object_key,file.expected_size,file.mime_type,file.expected_checksum,file.submission_kind,file.submission_page_no,upload_session.expires_at,file.status,file.promotion_token,file.final_object_key,file.storage_zone FROM public.upload_sessions upload_session JOIN public.upload_files file ON file.session_id=upload_session.id JOIN public.submissions submission ON submission.id=file.submission_id WHERE upload_session.id=p_upload_id AND upload_session.owner_id=p_user_id AND file.submission_id=p_submission_id AND submission.user_id=p_user_id;
END;
$$;

CREATE FUNCTION public.begin_submission_upload_promotion_v2(p_user_id uuid,p_session_id uuid,p_submission_id uuid,p_upload_id uuid,p_file_id uuid,p_promotion_token uuid,p_object_key text,p_actual_size bigint,p_checksum text,p_etag text)
RETURNS TABLE(promotion_token uuid,object_key text,storage_zone text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE file public.upload_files%ROWTYPE; upload_session public.upload_sessions%ROWTYPE;
BEGIN
  PERFORM public.interaction_assert_actor(p_user_id,p_session_id);
  PERFORM 1 FROM public.submissions WHERE id=p_submission_id AND user_id=p_user_id AND status='draft' FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'state_conflict'; END IF;
  SELECT * INTO upload_session FROM public.upload_sessions WHERE id=p_upload_id FOR UPDATE; SELECT * INTO file FROM public.upload_files WHERE id=p_file_id AND session_id=p_upload_id FOR UPDATE;
  IF NOT FOUND OR upload_session.owner_id<>p_user_id OR upload_session.purpose<>'submission_asset' OR file.submission_id<>p_submission_id OR file.status<>'declared' OR upload_session.expires_at<=clock_timestamp() OR p_actual_size<>file.expected_size OR p_checksum<>file.expected_checksum OR p_object_key<>'protected/works/'||p_submission_id||'/'||p_file_id||'.'||split_part(p_object_key,'.',-1) THEN RAISE EXCEPTION 'upload_not_verified'; END IF;
  UPDATE public.upload_files SET status='promoting',actual_size=p_actual_size,checksum=p_checksum,etag=p_etag,final_object_key=p_object_key,storage_zone='private',promotion_token=p_promotion_token,promotion_started_at=clock_timestamp(),scan_status='basic_format_only' WHERE id=p_file_id;
  RETURN QUERY SELECT p_promotion_token,p_object_key,'private'::text;
END;
$$;

CREATE FUNCTION public.complete_submission_upload_v2(p_user_id uuid,p_session_id uuid,p_submission_id uuid,p_upload_id uuid,p_file_id uuid,p_promotion_token uuid,p_object_key text,p_actual_size bigint,p_checksum text,p_etag text,p_request_id text)
RETURNS TABLE(file_id uuid,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE file public.upload_files%ROWTYPE; upload_session public.upload_sessions%ROWTYPE;
BEGIN
  PERFORM public.interaction_assert_actor(p_user_id,p_session_id);
  PERFORM 1 FROM public.submissions WHERE id=p_submission_id AND user_id=p_user_id AND status='draft' FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'state_conflict'; END IF;
  SELECT * INTO upload_session FROM public.upload_sessions current_upload_session WHERE current_upload_session.id=p_upload_id AND current_upload_session.owner_id=p_user_id FOR UPDATE; SELECT * INTO file FROM public.upload_files WHERE id=p_file_id AND session_id=p_upload_id FOR UPDATE;
  IF file.status='bound' AND file.submission_id=p_submission_id THEN RETURN QUERY SELECT file.id,'verified'::text; RETURN; END IF;
  IF NOT FOUND OR upload_session.owner_id<>p_user_id OR upload_session.purpose<>'submission_asset' OR file.submission_id<>p_submission_id OR file.status<>'promoting' OR file.promotion_token<>p_promotion_token OR file.final_object_key<>p_object_key OR file.storage_zone<>'private' OR p_object_key NOT LIKE 'protected/works/'||p_submission_id||'/%' OR p_actual_size<>file.expected_size OR p_checksum<>file.expected_checksum THEN RAISE EXCEPTION 'upload_not_verified'; END IF;
  IF EXISTS(SELECT 1 FROM public.submission_assets slot WHERE slot.submission_id=p_submission_id AND ((file.submission_kind IN ('cover','body') AND slot.kind=file.submission_kind) OR (file.submission_kind='page' AND slot.kind='page' AND slot.page_no=file.submission_page_no))) THEN RAISE EXCEPTION 'state_conflict'; END IF;
  UPDATE public.upload_files SET status='verified',actual_size=p_actual_size,checksum=p_checksum,etag=p_etag WHERE id=p_file_id;
  INSERT INTO public.submission_assets(submission_id,upload_file_id,kind,page_no) VALUES(p_submission_id,p_file_id,file.submission_kind,file.submission_page_no);
  UPDATE public.upload_files SET status='bound',promotion_token=NULL WHERE id=p_file_id;
  UPDATE public.upload_sessions SET status='completed' WHERE id=p_upload_id;
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id) VALUES(p_user_id,'submission.upload.complete','submission',p_submission_id,jsonb_build_object('fileId',p_file_id,'kind',file.submission_kind),p_request_id);
  RETURN QUERY SELECT p_file_id,'verified'::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submission_operation_replay(uuid,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submission_store_operation(uuid,text,text,text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_submission_draft_v2(uuid,uuid,text,text,text,jsonb,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_submission_draft_v2(uuid,uuid,uuid,bigint,text,text,jsonb,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_submission_v2(uuid,uuid,uuid,bigint,text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.review_submission_v2(uuid,uuid,uuid,bigint,text,text,text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_my_submissions_v2(uuid,uuid,integer,timestamptz,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_submission_v2(uuid,uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_admin_submissions_v2(uuid,uuid,text,integer,timestamptz,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_submission_upload_v2(uuid,uuid,uuid,text,uuid,uuid,text,bigint,text,text,text,integer,timestamptz,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_submission_upload_v2(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.begin_submission_upload_promotion_v2(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_submission_upload_v2(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text) FROM PUBLIC;
REVOKE ALL ON TABLE public.submission_operations,public.submission_install_state FROM PUBLIC;

COMMIT;
