BEGIN;

CREATE TABLE public.interaction_install_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  seeded_policy boolean NOT NULL,
  seeded_work_id uuid,
  migrated_progress_count bigint NOT NULL,
  installed_at timestamptz NOT NULL
);
ALTER TABLE public.interaction_install_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.interaction_install_state,public.work_likes,public.favorites,public.comments,public.reading_progress,public.reports,public.moderation_actions FROM PUBLIC;
WITH inserted_policy AS (
  INSERT INTO public.site_settings(key,value,version)
  VALUES('interaction_comment_policy','{"newAccountHours":24,"rapidCommentCount":3,"riskTerms":["spam","telegram","裸聊"]}'::jsonb,1)
  ON CONFLICT(key) DO NOTHING RETURNING 1
)
INSERT INTO public.interaction_install_state(singleton,seeded_policy,seeded_work_id,migrated_progress_count,installed_at)
SELECT true,EXISTS(SELECT 1 FROM inserted_policy),NULL,(SELECT count(*) FROM public.reading_progress),clock_timestamp();

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.works WHERE slug ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  THEN RAISE EXCEPTION 'interaction_uuid_shaped_slug'; END IF;
END $$;
ALTER TABLE public.works ADD CONSTRAINT works_slug_not_uuid CHECK (slug !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

DO $$ DECLARE legacy public.works%ROWTYPE; inserted_id uuid;
BEGIN
  SELECT * INTO legacy FROM public.works WHERE slug='lh-001' FOR NO KEY UPDATE;
  IF FOUND THEN
    IF legacy.type<>'comic' OR legacy.rating<>'restricted' OR legacy.status<>'draft' OR legacy.published_at IS NOT NULL
    THEN RAISE EXCEPTION 'unsafe_legacy_archive_work'; END IF;
  ELSE
    INSERT INTO public.works(slug,type,title,summary,rating,status,author_name,published_at)
    VALUES('lh-001','comic','春','旧版漫画归档兼容记录；私有资产导入完成后方可发布','restricted','draft','未知',NULL)
    RETURNING id INTO inserted_id;
    UPDATE public.interaction_install_state SET seeded_work_id=inserted_id WHERE singleton=true;
    SELECT * INTO legacy FROM public.works WHERE id=inserted_id;
  END IF;
  PERFORM 1 FROM public.work_assets asset WHERE asset.work_id=legacy.id ORDER BY asset.id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.work_assets asset WHERE asset.work_id=legacy.id AND (asset.status='active' OR asset.storage_zone<>'private' OR asset.access_level<>'private' OR NOT starts_with(asset.object_key,'protected/works/'||legacy.id::text||'/')))
  THEN RAISE EXCEPTION 'unsafe_legacy_archive_assets'; END IF;
END $$;

CREATE TABLE public.comment_idempotency (
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE RESTRICT,
  result_status text NOT NULL CHECK (result_status IN ('pending','published')),
  result_created_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,idempotency_key)
);
ALTER TABLE public.comment_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.comment_idempotency FROM PUBLIC;

ALTER TABLE public.reading_progress
  ADD COLUMN position_data jsonb,
  ADD COLUMN logic_version integer,
  ADD COLUMN client_mutation_id uuid;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.reading_progress progress JOIN public.works work ON work.id=progress.work_id WHERE work.type NOT IN ('comic','novel'))
  THEN RAISE EXCEPTION 'interaction_progress_unsupported_work_type'; END IF;
  IF EXISTS(SELECT 1 FROM public.reading_progress progress JOIN public.works work ON work.id=progress.work_id WHERE (work.type='comic' AND progress.position>100000) OR (work.type='novel' AND progress.position>10000000))
  THEN RAISE EXCEPTION 'interaction_progress_position_requires_cleanup'; END IF;
END $$;
UPDATE public.reading_progress progress SET
  position_data=CASE work.type WHEN 'comic' THEN jsonb_build_object('kind','comic','page',GREATEST(1,progress.position))
    ELSE jsonb_build_object('kind','novel','chapter',1,'offset',progress.position) END,
  logic_version=1,client_version=GREATEST(progress.client_version,1),client_mutation_id=gen_random_uuid()
FROM public.works work WHERE work.id=progress.work_id;
UPDATE public.interaction_install_state SET installed_at=clock_timestamp() WHERE singleton=true;
ALTER TABLE public.reading_progress
  ALTER COLUMN position_data SET NOT NULL,
  ALTER COLUMN logic_version SET NOT NULL,
  ALTER COLUMN client_mutation_id SET NOT NULL,
  ADD CHECK (logic_version > 0);

ALTER TABLE public.reports
  ADD COLUMN note text NOT NULL DEFAULT '' CHECK (length(note) <= 500);
ALTER TABLE public.reports ALTER COLUMN note DROP DEFAULT;
ALTER TABLE public.reports DROP CONSTRAINT reports_reporter_id_target_type_target_id_key;
CREATE UNIQUE INDEX reports_active_target_uidx ON public.reports(reporter_id,target_type,target_id)
  WHERE status IN ('pending','reviewing');
ALTER TABLE public.reports ADD CONSTRAINT reports_reason_v2_check
  CHECK (reason IN ('illegal','copyright','harassment','spam','other')) NOT VALID;

ALTER TABLE public.moderation_actions DROP CONSTRAINT moderation_actions_action_check;
ALTER TABLE public.moderation_actions ADD CONSTRAINT moderation_actions_action_check
  CHECK (action IN ('approve','hide','reject','request_changes','withdraw','restore','suspend','review','resolve'));

CREATE FUNCTION public.interaction_valid_position(p_position jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_position)<>'object' THEN false
    WHEN p_position->>'kind'='comic' THEN
      (SELECT array_agg(key ORDER BY key)=ARRAY['kind','page'] FROM jsonb_object_keys(p_position) key)
      AND (p_position->>'page') ~ '^[1-9][0-9]{0,5}$' AND (p_position->>'page')::integer<=100000
    WHEN p_position->>'kind'='novel' THEN
      (SELECT array_agg(key ORDER BY key)=ARRAY['chapter','kind','offset'] FROM jsonb_object_keys(p_position) key)
      AND (p_position->>'chapter') ~ '^[1-9][0-9]{0,5}$' AND (p_position->>'chapter')::integer<=100000
      AND (p_position->>'offset') ~ '^(0|[1-9][0-9]{0,7})$' AND (p_position->>'offset')::bigint<=10000000
    ELSE false END;
$$;
ALTER TABLE public.reading_progress ADD CONSTRAINT reading_progress_position_v2_check CHECK (public.interaction_valid_position(position_data));

CREATE FUNCTION public.interaction_assert_actor(p_user_id uuid,p_session_id uuid)
RETURNS public.app_users LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE app_user public.app_users%ROWTYPE; session public.user_sessions%ROWTYPE;
BEGIN
  SELECT * INTO app_user FROM public.app_users WHERE id=p_user_id FOR KEY SHARE;
  IF NOT FOUND OR app_user.status<>'active' OR app_user.recovery_confirmed_at IS NULL THEN RAISE EXCEPTION 'access_denied'; END IF;
  SELECT * INTO session FROM public.user_sessions WHERE id=p_session_id AND user_id=p_user_id FOR SHARE;
  IF NOT FOUND OR session.revoked_at IS NOT NULL OR session.expires_at<=clock_timestamp() OR session.recovery_confirmed_at IS NULL THEN RAISE EXCEPTION 'session_expired'; END IF;
  RETURN app_user;
END;
$$;

CREATE FUNCTION public.interaction_assert_admin(p_admin_id uuid,p_session_id uuid)
RETURNS public.app_users LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE admin public.app_users%ROWTYPE;
BEGIN
  admin := public.interaction_assert_actor(p_admin_id,p_session_id);
  IF admin.role<>'admin' THEN RAISE EXCEPTION 'access_denied'; END IF;
  RETURN admin;
END;
$$;

CREATE FUNCTION public.interaction_assert_work(p_user_id uuid,p_session_id uuid,p_work_ref text,p_allow_anonymous boolean)
RETURNS public.works LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE work public.works%ROWTYPE; decision record;
BEGIN
  IF p_work_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    SELECT * INTO work FROM public.works WHERE id=p_work_ref::uuid FOR SHARE;
  ELSE
    SELECT * INTO work FROM public.works WHERE slug=p_work_ref FOR SHARE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF p_user_id IS NULL THEN
    IF NOT p_allow_anonymous OR work.status<>'published' OR work.rating='restricted' THEN RAISE EXCEPTION 'not_found'; END IF;
    RETURN work;
  END IF;
  SELECT * INTO decision FROM public.authorize_work_access(p_user_id,p_session_id,work.id);
  IF decision.allowed IS DISTINCT FROM true THEN
    IF decision.error_code='SESSION_EXPIRED' THEN RAISE EXCEPTION 'session_expired';
    ELSIF decision.error_code='AGE_CONSENT_REQUIRED' THEN RAISE EXCEPTION 'age_consent_required';
    ELSIF decision.error_code='NOT_FOUND' THEN RAISE EXCEPTION 'not_found';
    ELSE RAISE EXCEPTION 'access_denied'; END IF;
  END IF;
  DELETE FROM public.content_access_authorizations WHERE id=decision.authorization_id AND status='pending';
  SELECT * INTO work FROM public.works WHERE id=decision.work_id;
  RETURN work;
END;
$$;

CREATE FUNCTION public.set_work_reaction_v2(p_user_id uuid,p_session_id uuid,p_work_ref text,p_reaction_type text,p_active boolean)
RETURNS TABLE(active boolean,reaction_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE work public.works%ROWTYPE;
BEGIN
  IF p_reaction_type NOT IN ('like','favorite') THEN RAISE EXCEPTION 'validation_failed'; END IF;
  work := public.interaction_assert_work(p_user_id,p_session_id,p_work_ref,false);
  PERFORM pg_advisory_xact_lock(hashtextextended(work.id::text||':'||p_reaction_type,20260918));
  IF p_reaction_type='like' THEN
    IF p_active THEN INSERT INTO public.work_likes(user_id,work_id) VALUES(p_user_id,work.id) ON CONFLICT (user_id,work_id) DO NOTHING;
    ELSE DELETE FROM public.work_likes WHERE user_id=p_user_id AND work_id=work.id; END IF;
    RETURN QUERY SELECT p_active,(SELECT count(*) FROM public.work_likes WHERE work_id=work.id);
  ELSE
    IF p_active THEN INSERT INTO public.favorites(user_id,work_id) VALUES(p_user_id,work.id) ON CONFLICT (user_id,work_id) DO NOTHING;
    ELSE DELETE FROM public.favorites WHERE user_id=p_user_id AND work_id=work.id; END IF;
    RETURN QUERY SELECT p_active,(SELECT count(*) FROM public.favorites WHERE work_id=work.id);
  END IF;
END;
$$;

CREATE FUNCTION public.list_work_comments_v2(p_user_id uuid,p_session_id uuid,p_work_ref text,p_limit integer,p_before_at timestamptz,p_before_id uuid)
RETURNS TABLE(id uuid,author_name text,body text,created_at timestamptz,published_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE work public.works%ROWTYPE;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'validation_failed'; END IF;
  work := public.interaction_assert_work(p_user_id,p_session_id,p_work_ref,true);
  RETURN QUERY SELECT comment.id,app_user.username,comment.body,comment.created_at,
    (SELECT count(*) FROM public.comments visible WHERE visible.work_id=work.id AND visible.status='published')
  FROM public.comments comment JOIN public.app_users app_user ON app_user.id=comment.user_id
  WHERE comment.work_id=work.id AND comment.status='published' AND (p_before_at IS NULL OR (comment.created_at,comment.id)<(p_before_at,p_before_id))
  ORDER BY comment.created_at DESC,comment.id DESC LIMIT p_limit;
END;
$$;

CREATE FUNCTION public.create_work_comment_v2(p_user_id uuid,p_session_id uuid,p_work_ref text,p_body text,p_parent_id uuid,p_idempotency_key text,p_request_id text)
RETURNS TABLE(id uuid,status text,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE app_user public.app_users%ROWTYPE; work public.works%ROWTYPE; normalized text; policy jsonb; next_status text := 'published'; created public.comments%ROWTYPE; replay public.comment_idempotency%ROWTYPE; recent_count integer; request_hash text;
BEGIN
  work := public.interaction_assert_work(p_user_id,p_session_id,p_work_ref,false);
  normalized := regexp_replace(btrim(p_body),'[[:space:]]+',' ','g');
  IF length(normalized) NOT BETWEEN 1 AND 500 OR normalized ~ '[[:cntrl:]]' OR p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'validation_failed'; END IF;
  request_hash := encode(digest(work.id::text||chr(31)||normalized||chr(31)||COALESCE(p_parent_id::text,''),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,20260918));
  SELECT * INTO replay FROM public.comment_idempotency WHERE user_id=p_user_id AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF replay.payload_hash<>request_hash THEN RAISE EXCEPTION 'state_conflict'; END IF;
    RETURN QUERY SELECT replay.comment_id,replay.result_status,replay.result_created_at; RETURN;
  END IF;
  IF p_parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.comments parent WHERE parent.id=p_parent_id AND parent.work_id=work.id AND parent.status='published' AND parent.parent_id IS NULL) THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO app_user FROM public.app_users WHERE id=p_user_id;
  SELECT value INTO policy FROM public.site_settings WHERE key='interaction_comment_policy' FOR SHARE;
  SELECT count(*) INTO recent_count FROM public.comments WHERE user_id=p_user_id AND created_at>clock_timestamp()-interval '1 minute';
  IF app_user.created_at>clock_timestamp()-make_interval(hours=>COALESCE((policy->>'newAccountHours')::integer,24))
    OR recent_count>=COALESCE((policy->>'rapidCommentCount')::integer,3)
    OR normalized ~* '(https?://|www\.)'
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(policy->'riskTerms','[]'::jsonb)) term WHERE lower(normalized) LIKE '%'||lower(term)||'%')
  THEN next_status := 'pending'; END IF;
  INSERT INTO public.comments(work_id,user_id,parent_id,body,status,risk_level)
  VALUES(work.id,p_user_id,p_parent_id,normalized,next_status,CASE next_status WHEN 'pending' THEN 'medium' ELSE 'low' END) RETURNING * INTO created;
  INSERT INTO public.comment_idempotency(user_id,idempotency_key,payload_hash,comment_id,result_status,result_created_at)
  VALUES(p_user_id,p_idempotency_key,request_hash,created.id,created.status,created.created_at);
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id)
  VALUES(p_user_id,'comment.create','comment',created.id,jsonb_build_object('status',next_status,'workId',work.id),p_request_id);
  RETURN QUERY SELECT created.id,created.status,created.created_at;
END;
$$;

CREATE FUNCTION public.delete_work_comment_v2(p_user_id uuid,p_session_id uuid,p_comment_id uuid,p_request_id text)
RETURNS TABLE(id uuid,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE comment public.comments%ROWTYPE;
BEGIN
  PERFORM public.interaction_assert_actor(p_user_id,p_session_id);
  SELECT * INTO comment FROM public.comments WHERE comments.id=p_comment_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF comment.status<>'deleted' THEN
    UPDATE public.comments SET status='deleted',deleted_at=clock_timestamp() WHERE comments.id=p_comment_id RETURNING * INTO comment;
    INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id)
    VALUES(p_user_id,'comment.delete','comment',comment.id,'{"status":"deleted"}'::jsonb,p_request_id);
  END IF;
  RETURN QUERY SELECT comment.id,comment.status;
END;
$$;

CREATE FUNCTION public.moderate_work_comment_v2(p_admin_id uuid,p_session_id uuid,p_comment_id uuid,p_action text,p_reason text,p_request_id text)
RETURNS TABLE(id uuid,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE admin public.app_users%ROWTYPE; comment public.comments%ROWTYPE; next_status text;
BEGIN
  admin := public.interaction_assert_admin(p_admin_id,p_session_id);
  IF p_action NOT IN ('hide','restore') OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'validation_failed'; END IF;
  SELECT * INTO comment FROM public.comments WHERE comments.id=p_comment_id FOR UPDATE;
  IF NOT FOUND OR comment.status='deleted' THEN RAISE EXCEPTION 'not_found'; END IF;
  next_status := CASE p_action WHEN 'hide' THEN 'hidden' ELSE 'published' END;
  IF comment.status<>next_status THEN UPDATE public.comments SET status=next_status WHERE comments.id=p_comment_id RETURNING * INTO comment;
    INSERT INTO public.moderation_actions(target_type,target_id,action,reason,admin_id) VALUES('comment',comment.id,p_action,btrim(p_reason),p_admin_id);
    INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id)
    VALUES(p_admin_id,'comment.moderate','comment',comment.id,jsonb_build_object('action',p_action,'status',next_status,'reason',btrim(p_reason)),p_request_id);
  END IF;
  RETURN QUERY SELECT comment.id,comment.status;
END;
$$;

CREATE FUNCTION public.get_reading_progress_v2(p_user_id uuid,p_session_id uuid,p_work_ref text)
RETURNS TABLE(position_data jsonb,percent numeric,logic_version integer,client_version bigint,client_mutation_id uuid,server_version bigint,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE work public.works%ROWTYPE;
BEGIN
  work := public.interaction_assert_work(p_user_id,p_session_id,p_work_ref,false);
  RETURN QUERY SELECT progress.position_data,progress.percent,progress.logic_version,progress.client_version,progress.client_mutation_id,progress.server_version,progress.updated_at
  FROM public.reading_progress progress WHERE progress.user_id=p_user_id AND progress.work_id=work.id;
END;
$$;

CREATE FUNCTION public.sync_reading_progress_v2(p_user_id uuid,p_session_id uuid,p_work_ref text,p_position jsonb,p_percent numeric,p_logic_version integer,p_client_version bigint,p_base_server_version bigint,p_mutation_id uuid)
RETURNS TABLE(accepted boolean,position_data jsonb,percent numeric,logic_version integer,client_version bigint,client_mutation_id uuid,server_version bigint,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE work public.works%ROWTYPE; current_progress public.reading_progress%ROWTYPE; should_accept boolean := false; scalar_position bigint;
BEGIN
  work := public.interaction_assert_work(p_user_id,p_session_id,p_work_ref,false);
  IF NOT public.interaction_valid_position(p_position) OR p_percent IS NULL OR p_percent<0 OR p_percent>100 OR p_logic_version IS NULL OR p_logic_version<1 OR p_client_version IS NULL OR p_client_version<1 OR p_base_server_version IS NULL OR p_base_server_version<0 OR p_mutation_id IS NULL THEN RAISE EXCEPTION 'validation_failed'; END IF;
  IF (work.type='comic' AND p_position->>'kind'<>'comic') OR (work.type='novel' AND p_position->>'kind'<>'novel') OR work.type NOT IN ('comic','novel') THEN RAISE EXCEPTION 'validation_failed'; END IF;
  scalar_position := CASE p_position->>'kind' WHEN 'comic' THEN (p_position->>'page')::bigint ELSE (p_position->>'offset')::bigint END;
  PERFORM pg_advisory_xact_lock(hashtextextended(work.id::text||':'||p_user_id::text,20260918));
  SELECT * INTO current_progress FROM public.reading_progress WHERE user_id=p_user_id AND work_id=work.id FOR UPDATE;
  IF NOT FOUND THEN
    IF p_base_server_version<>0 THEN RAISE EXCEPTION 'state_conflict'; END IF;
    INSERT INTO public.reading_progress(user_id,work_id,position,position_data,percent,logic_version,client_version,client_mutation_id,client_updated_at,server_version,updated_at)
    VALUES(p_user_id,work.id,scalar_position,p_position,p_percent,p_logic_version,p_client_version,p_mutation_id,clock_timestamp(),1,clock_timestamp()) RETURNING * INTO current_progress;
    should_accept := true;
  ELSIF current_progress.client_mutation_id=p_mutation_id THEN should_accept := true;
  ELSIF p_base_server_version=current_progress.server_version AND (p_logic_version > current_progress.logic_version OR (p_logic_version=current_progress.logic_version AND p_client_version>current_progress.client_version)) THEN
    UPDATE public.reading_progress SET position=scalar_position,position_data=p_position,percent=p_percent,logic_version=p_logic_version,
      client_version=p_client_version,client_mutation_id=p_mutation_id,client_updated_at=clock_timestamp(),server_version=server_version+1,updated_at=clock_timestamp()
    WHERE user_id=p_user_id AND work_id=work.id RETURNING * INTO current_progress;
    should_accept := true;
  END IF;
  RETURN QUERY SELECT should_accept,current_progress.position_data,current_progress.percent,current_progress.logic_version,current_progress.client_version,current_progress.client_mutation_id,current_progress.server_version,current_progress.updated_at;
END;
$$;

CREATE FUNCTION public.interaction_assert_report_target(p_reporter_id uuid,p_session_id uuid,p_target_type text,p_target_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE work_id uuid; work public.works%ROWTYPE;
BEGIN
  IF p_target_type='work' THEN work := public.interaction_assert_work(p_reporter_id,p_session_id,p_target_id::text,false);
  ELSIF p_target_type='comment' THEN
    SELECT comment.work_id INTO work_id FROM public.comments comment WHERE comment.id=p_target_id AND comment.status='published';
    IF work_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
    work := public.interaction_assert_work(p_reporter_id,p_session_id,work_id::text,false);
    PERFORM 1 FROM public.comments comment WHERE comment.id=p_target_id AND comment.work_id=work.id AND comment.status='published' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  ELSE RAISE EXCEPTION 'validation_failed'; END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION public.create_interaction_report_v2(p_reporter_id uuid,p_session_id uuid,p_target_type text,p_target_id uuid,p_reason text,p_note text,p_request_id text)
RETURNS TABLE(id uuid,status text,duplicate boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE existing public.reports%ROWTYPE; created public.reports%ROWTYPE; normalized_note text;
BEGIN
  PERFORM public.interaction_assert_report_target(p_reporter_id,p_session_id,p_target_type,p_target_id);
  IF p_reason NOT IN ('illegal','copyright','harassment','spam','other') THEN RAISE EXCEPTION 'validation_failed'; END IF;
  normalized_note := regexp_replace(btrim(COALESCE(p_note,'')),'[[:space:]]+',' ','g');
  IF length(normalized_note)>500 OR normalized_note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'validation_failed'; END IF;
  SELECT * INTO existing FROM public.reports WHERE reporter_id=p_reporter_id AND target_type=p_target_type AND target_id=p_target_id AND status IN ('pending','reviewing') FOR UPDATE;
  IF FOUND THEN RETURN QUERY SELECT existing.id,existing.status,true; RETURN; END IF;
  INSERT INTO public.reports(reporter_id,target_type,target_id,reason,note,status)
  VALUES(p_reporter_id,p_target_type,p_target_id,p_reason,normalized_note,'pending') RETURNING * INTO created;
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id)
  VALUES(p_reporter_id,'report.create','report',created.id,jsonb_build_object('targetType',p_target_type,'reason',p_reason),p_request_id);
  RETURN QUERY SELECT created.id,created.status,false;
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO existing FROM public.reports WHERE reporter_id=p_reporter_id AND target_type=p_target_type AND target_id=p_target_id AND status IN ('pending','reviewing');
  RETURN QUERY SELECT existing.id,existing.status,true;
END;
$$;

CREATE FUNCTION public.moderate_interaction_report_v2(p_admin_id uuid,p_session_id uuid,p_report_id uuid,p_status text,p_reason text,p_request_id text)
RETURNS TABLE(id uuid,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE admin public.app_users%ROWTYPE; report public.reports%ROWTYPE; action text;
BEGIN
  admin := public.interaction_assert_admin(p_admin_id,p_session_id);
  IF p_status NOT IN ('reviewing','resolved','rejected') OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'validation_failed'; END IF;
  SELECT * INTO report FROM public.reports WHERE reports.id=p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF report.status=p_status THEN RETURN QUERY SELECT report.id,report.status; RETURN; END IF;
  IF report.status NOT IN ('pending','reviewing') OR (report.status='reviewing' AND p_status='reviewing') THEN RAISE EXCEPTION 'state_conflict'; END IF;
  UPDATE public.reports SET status=p_status,handled_by=p_admin_id,updated_at=clock_timestamp() WHERE reports.id=p_report_id RETURNING * INTO report;
  action := CASE p_status WHEN 'reviewing' THEN 'review' WHEN 'resolved' THEN 'resolve' ELSE 'reject' END;
  INSERT INTO public.moderation_actions(target_type,target_id,action,reason,admin_id) VALUES('report',report.id,action,btrim(p_reason),p_admin_id);
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id)
  VALUES(p_admin_id,'report.moderate','report',report.id,jsonb_build_object('status',p_status,'reason',btrim(p_reason)),p_request_id);
  RETURN QUERY SELECT report.id,report.status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.interaction_valid_position(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.interaction_assert_actor(uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.interaction_assert_admin(uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.interaction_assert_work(uuid,uuid,text,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_work_reaction_v2(uuid,uuid,text,text,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_work_comments_v2(uuid,uuid,text,integer,timestamptz,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_work_comment_v2(uuid,uuid,text,text,uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_work_comment_v2(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.moderate_work_comment_v2(uuid,uuid,uuid,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_reading_progress_v2(uuid,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_reading_progress_v2(uuid,uuid,text,jsonb,numeric,integer,bigint,bigint,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.interaction_assert_report_target(uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_interaction_report_v2(uuid,uuid,text,uuid,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.moderate_interaction_report_v2(uuid,uuid,uuid,text,text,text) FROM PUBLIC;

COMMIT;
