BEGIN;

ALTER TABLE public.app_users ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE public.snapshot_jobs ADD COLUMN admin_version bigint NOT NULL DEFAULT 1 CHECK (admin_version > 0);
ALTER TABLE public.upload_files ADD COLUMN cleanup_admin_version bigint NOT NULL DEFAULT 1 CHECK (cleanup_admin_version > 0);
CREATE FUNCTION public.bump_upload_cleanup_admin_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN IF NEW.cleanup_admin_version=OLD.cleanup_admin_version AND (NEW.status,NEW.cleanup_token,NEW.cleanup_attempts,NEW.cleanup_last_error,NEW.cleanup_next_retry_at) IS DISTINCT FROM (OLD.status,OLD.cleanup_token,OLD.cleanup_attempts,OLD.cleanup_last_error,OLD.cleanup_next_retry_at) THEN NEW.cleanup_admin_version:=OLD.cleanup_admin_version+1; END IF; RETURN NEW; END; $$;
REVOKE EXECUTE ON FUNCTION public.bump_upload_cleanup_admin_version() FROM PUBLIC;
CREATE TRIGGER upload_files_cleanup_admin_version BEFORE UPDATE ON public.upload_files FOR EACH ROW EXECUTE FUNCTION public.bump_upload_cleanup_admin_version();
ALTER TABLE public.question_bank ADD COLUMN question_key uuid;
UPDATE public.question_bank SET question_key=id WHERE question_key IS NULL;
ALTER TABLE public.question_bank ALTER COLUMN question_key SET NOT NULL;
CREATE UNIQUE INDEX question_bank_key_version_key ON public.question_bank(question_key,version);

CREATE TABLE public.admin_console_install_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  seeded_announcement boolean NOT NULL,
  seeded_feature_flags boolean NOT NULL
);
WITH announcement AS (
  INSERT INTO public.site_settings(key,value,version)
  VALUES('announcement','{"enabled":false,"text":""}'::jsonb,1)
  ON CONFLICT(key) DO NOTHING RETURNING 1
), feature_flags AS (
  INSERT INTO public.site_settings(key,value,version)
  VALUES('feature_flags','{"registrationEnabled":true,"submissionsEnabled":true,"commentsEnabled":true,"legacyMigrationEnabled":false}'::jsonb,1)
  ON CONFLICT(key) DO NOTHING RETURNING 1
)
INSERT INTO public.admin_console_install_state(singleton,seeded_announcement,seeded_feature_flags)
SELECT true,EXISTS(SELECT 1 FROM announcement),EXISTS(SELECT 1 FROM feature_flags);
ALTER TABLE public.admin_console_install_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_console_install_state FROM PUBLIC;

CREATE TABLE public.admin_console_operations (
  actor_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  action text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,idempotency_key)
);
ALTER TABLE public.admin_console_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_console_operations FROM PUBLIC;

CREATE FUNCTION public.admin_console_replay(p_actor_id uuid,p_key text,p_hash text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.admin_console_operations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('admin-console:'||p_actor_id::text||':'||p_key,20260918));
  SELECT * INTO op FROM public.admin_console_operations WHERE actor_id=p_actor_id AND idempotency_key=p_key FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF op.request_hash<>p_hash OR op.action<>p_action THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN op.result;
END; $$;

CREATE FUNCTION public.admin_dashboard_v2(p_admin_id uuid,p_admin_session_id uuid)
RETURNS TABLE(counts jsonb,todos jsonb,system jsonb,recent_admin_actions jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id);
  RETURN QUERY SELECT jsonb_build_object(
    'works',(SELECT count(*) FROM public.works WHERE status<>'deleted'),
    'pendingSubmissions',(SELECT count(*) FROM public.submissions WHERE status IN ('submitted','under_review')),
    'pendingComments',(SELECT count(*) FROM public.comments WHERE status='pending'),
    'pendingReports',(SELECT count(*) FROM public.reports WHERE status IN ('pending','reviewing')),
    'activeUsers',(SELECT count(*) FROM public.app_users WHERE status='active'),
    'failedUploads',(SELECT count(*) FROM public.upload_files WHERE status='cleanup_pending' AND cleanup_last_error IS NOT NULL),
    'failedJobs',(SELECT count(*) FROM public.snapshot_jobs WHERE status='failed')
  ), jsonb_build_array(
    jsonb_build_object('kind','submissions','count',(SELECT count(*) FROM public.submissions WHERE status='submitted')),
    jsonb_build_object('kind','reports','count',(SELECT count(*) FROM public.reports WHERE status='pending')),
    jsonb_build_object('kind','failedUploads','count',(SELECT count(*) FROM public.upload_files WHERE status='cleanup_pending' AND cleanup_last_error IS NOT NULL))
  ),jsonb_build_object('databaseVersion','20260918_admin_console','snapshotVersion',(SELECT version FROM public.snapshot_current WHERE snapshot_type='catalog'),'storageHealth',CASE WHEN EXISTS(SELECT 1 FROM public.upload_files WHERE status='cleanup_pending' AND cleanup_last_error IS NOT NULL) THEN 'degraded' WHEN EXISTS(SELECT 1 FROM public.snapshot_current WHERE snapshot_type='catalog') THEN 'healthy' ELSE 'unknown' END),
  COALESCE((SELECT jsonb_agg(jsonb_build_object('action',recent.action,'actorId',recent.actor_id,'createdAt',recent.created_at) ORDER BY recent.created_at DESC) FROM (SELECT action,actor_id,created_at FROM public.audit_logs WHERE action LIKE 'admin.%' ORDER BY created_at DESC,id DESC LIMIT 10) recent),'[]'::jsonb);
END; $$;

CREATE FUNCTION public.admin_list_users_v2(p_admin_id uuid,p_admin_session_id uuid,p_status text,p_search text,p_action text,p_limit integer,p_before_at timestamptz,p_before_id uuid)
RETURNS TABLE(items jsonb,next_cursor text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id);
  IF p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
  RETURN QUERY WITH page AS (SELECT u.id,u.username,u.role,u.status,u.version,u.created_at,u.last_login_at,(SELECT count(*) FROM public.user_sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()) active_sessions FROM public.app_users u
    WHERE (p_status IS NULL OR u.status=p_status) AND (p_search IS NULL OR u.username ILIKE '%'||replace(replace(p_search,'%','\%'),'_','\_')||'%' ESCAPE '\')
      AND (p_before_at IS NULL OR (u.created_at,u.id)<(p_before_at,p_before_id)) ORDER BY u.created_at DESC,u.id DESC LIMIT p_limit+1), shown AS (SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT p_limit)
  SELECT COALESCE(jsonb_agg(to_jsonb(shown) ORDER BY created_at DESC,id DESC),'[]'::jsonb), CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT created_at::text||'|'||id::text FROM shown ORDER BY created_at,id LIMIT 1) END FROM shown;
END; $$;

CREATE FUNCTION public.admin_list_questions_v2(p_admin_id uuid,p_admin_session_id uuid,p_status text,p_search text,p_action text,p_limit integer,p_before_at timestamptz,p_before_id uuid)
RETURNS TABLE(items jsonb,next_cursor text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id);
  RETURN QUERY WITH page AS (SELECT q.id,q.prompt,q.options,q.normalization_rule,q.status,q.version,q.sampling_weight,q.created_at,q.updated_at FROM public.question_bank q
    WHERE (p_status IS NULL OR q.status=p_status) AND (p_before_at IS NULL OR (q.updated_at,q.id)<(p_before_at,p_before_id)) ORDER BY q.updated_at DESC,q.id DESC LIMIT LEAST(GREATEST(p_limit,1),100)+1), shown AS (SELECT * FROM page LIMIT LEAST(GREATEST(p_limit,1),100))
  SELECT COALESCE(jsonb_agg(to_jsonb(shown) ORDER BY updated_at DESC,id DESC),'[]'::jsonb),CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT updated_at::text||'|'||id::text FROM shown ORDER BY updated_at,id LIMIT 1) END FROM shown;
END; $$;

CREATE FUNCTION public.admin_list_comments_v2(p_admin_id uuid,p_admin_session_id uuid,p_status text,p_search text,p_action text,p_limit integer,p_before_at timestamptz,p_before_id uuid)
RETURNS TABLE(items jsonb,next_cursor text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); RETURN QUERY WITH page AS (SELECT c.id,c.work_id,c.user_id,c.body,c.status,c.created_at,c.updated_at,1::bigint version FROM public.comments c WHERE (p_status IS NULL OR c.status=p_status) AND (p_before_at IS NULL OR (c.created_at,c.id)<(p_before_at,p_before_id)) ORDER BY c.created_at DESC,c.id DESC LIMIT LEAST(GREATEST(p_limit,1),100)+1),shown AS(SELECT * FROM page LIMIT LEAST(GREATEST(p_limit,1),100)) SELECT COALESCE(jsonb_agg(to_jsonb(shown) ORDER BY created_at DESC,id DESC),'[]'::jsonb),CASE WHEN(SELECT count(*) FROM page)>p_limit THEN(SELECT created_at::text||'|'||id::text FROM shown ORDER BY created_at,id LIMIT 1)END FROM shown; END; $$;

CREATE FUNCTION public.admin_list_reports_v2(p_admin_id uuid,p_admin_session_id uuid,p_status text,p_search text,p_action text,p_limit integer,p_before_at timestamptz,p_before_id uuid)
RETURNS TABLE(items jsonb,next_cursor text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); RETURN QUERY WITH page AS (SELECT r.id,r.target_type,r.target_id,r.reason,r.status,r.created_at,r.updated_at,1::bigint version FROM public.reports r WHERE (p_status IS NULL OR r.status=p_status) AND (p_before_at IS NULL OR (r.created_at,r.id)<(p_before_at,p_before_id)) ORDER BY r.created_at DESC,r.id DESC LIMIT LEAST(GREATEST(p_limit,1),100)+1),shown AS(SELECT * FROM page LIMIT LEAST(GREATEST(p_limit,1),100)) SELECT COALESCE(jsonb_agg(to_jsonb(shown) ORDER BY created_at DESC,id DESC),'[]'::jsonb),CASE WHEN(SELECT count(*) FROM page)>p_limit THEN(SELECT created_at::text||'|'||id::text FROM shown ORDER BY created_at,id LIMIT 1)END FROM shown; END; $$;

CREATE FUNCTION public.admin_list_jobs_v2(p_admin_id uuid,p_admin_session_id uuid,p_status text,p_search text,p_action text,p_limit integer,p_before_at timestamptz,p_before_id uuid)
RETURNS TABLE(items jsonb,next_cursor text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id);
  RETURN QUERY WITH jobs AS (
    SELECT j.id,'snapshot'::text kind,j.status,j.attempts,j.admin_version version,j.updated_at,j.last_error error FROM public.snapshot_jobs j
    UNION ALL SELECT f.id,'cleanup',f.status,f.cleanup_attempts,f.cleanup_admin_version,f.updated_at,f.cleanup_last_error FROM public.upload_files f WHERE f.status='cleanup_pending'
  ),page AS(SELECT * FROM jobs j WHERE(p_status IS NULL OR j.status=p_status)AND(p_before_at IS NULL OR(j.updated_at,j.id)<(p_before_at,p_before_id))ORDER BY j.updated_at DESC,j.id DESC LIMIT LEAST(GREATEST(p_limit,1),100)+1),shown AS(SELECT * FROM page LIMIT LEAST(GREATEST(p_limit,1),100))
  SELECT COALESCE(jsonb_agg(to_jsonb(shown) ORDER BY updated_at DESC,id DESC),'[]'::jsonb),CASE WHEN(SELECT count(*) FROM page)>p_limit THEN(SELECT updated_at::text||'|'||id::text FROM shown ORDER BY updated_at,id LIMIT 1)END FROM shown;
END; $$;

CREATE FUNCTION public.admin_list_audit_v2(p_admin_id uuid,p_admin_session_id uuid,p_status text,p_search text,p_action text,p_limit integer,p_before_at timestamptz,p_before_id uuid)
RETURNS TABLE(items jsonb,next_cursor text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); RETURN QUERY WITH page AS(SELECT a.id,a.actor_id,a.action,a.target_type,a.target_id,a.summary,a.created_at FROM public.audit_logs a WHERE(p_action IS NULL OR a.action=p_action)AND(p_before_at IS NULL OR(a.created_at,a.id)<(p_before_at,p_before_id))ORDER BY a.created_at DESC,a.id DESC LIMIT LEAST(GREATEST(p_limit,1),100)+1),shown AS(SELECT * FROM page LIMIT LEAST(GREATEST(p_limit,1),100)) SELECT COALESCE(jsonb_agg(to_jsonb(shown)ORDER BY created_at DESC,id DESC),'[]'::jsonb),CASE WHEN(SELECT count(*)FROM page)>p_limit THEN(SELECT created_at::text||'|'||id::text FROM shown ORDER BY created_at,id LIMIT 1)END FROM shown; END; $$;

CREATE FUNCTION public.admin_set_user_status_v2(p_admin_id uuid,p_admin_session_id uuid,p_target_id uuid,p_expected_version bigint,p_status text,p_reason text,p_idempotency_key text,p_request_hash text,p_request_id text)
RETURNS public.app_users LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target public.app_users%ROWTYPE; replay jsonb;
BEGIN
  PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); replay:=public.admin_console_replay(p_admin_id,p_idempotency_key,p_request_hash,'user.status'); IF replay IS NOT NULL THEN SELECT * INTO target FROM public.app_users WHERE id=(replay->>'id')::uuid; RETURN target; END IF;
  LOCK TABLE public.app_users IN SHARE ROW EXCLUSIVE MODE;
  PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id);
  SELECT * INTO target FROM public.app_users WHERE id=p_target_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF; IF target.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF; IF p_status NOT IN('active','suspended') OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'state_conflict'; END IF;
  IF target.role='admin' AND target.status='active' AND p_status='suspended' AND (SELECT count(*) FROM public.app_users WHERE role='admin' AND status='active')<=1 THEN RAISE EXCEPTION 'last_active_admin'; END IF;
  UPDATE public.app_users SET status=p_status,version=version+1 WHERE id=p_target_id RETURNING * INTO target;
  IF p_status='suspended' THEN UPDATE public.user_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE user_id=p_target_id; END IF;
  INSERT INTO public.admin_console_operations VALUES(p_admin_id,p_idempotency_key,p_request_hash,'user.status',jsonb_build_object('id',target.id),clock_timestamp());
  INSERT INTO public.moderation_actions(target_type,target_id,action,reason,admin_id) VALUES('user',target.id,CASE WHEN p_status='suspended' THEN 'suspend' ELSE 'restore' END,p_reason,p_admin_id);
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id,idempotency_key) VALUES(p_admin_id,'admin.user.'||p_status,'user',target.id,jsonb_build_object('version',target.version),p_request_id,p_idempotency_key); RETURN target;
END; $$;

CREATE FUNCTION public.admin_create_question_v2(p_admin_id uuid,p_admin_session_id uuid,p_prompt text,p_options jsonb,p_answer_hashes text[],p_normalization_rule text,p_sampling_weight integer,p_idempotency_key text,p_request_hash text,p_request_id text)
RETURNS public.question_bank LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q public.question_bank%ROWTYPE; replay jsonb;
BEGIN PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); replay:=public.admin_console_replay(p_admin_id,p_idempotency_key,p_request_hash,'question.create'); IF replay IS NOT NULL THEN SELECT * INTO q FROM public.question_bank WHERE id=(replay->>'id')::uuid; RETURN q; END IF; INSERT INTO public.question_bank(prompt,options,accepted_answer_hashes,normalization_rule,sampling_weight,question_key)VALUES(p_prompt,p_options,p_answer_hashes,p_normalization_rule,p_sampling_weight,gen_random_uuid())RETURNING * INTO q; INSERT INTO public.admin_console_operations VALUES(p_admin_id,p_idempotency_key,p_request_hash,'question.create',jsonb_build_object('id',q.id),clock_timestamp()); INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id,idempotency_key)VALUES(p_admin_id,'admin.question.create','question',q.id,jsonb_build_object('version',q.version),p_request_id,p_idempotency_key); RETURN q; END; $$;

CREATE FUNCTION public.admin_update_question_v2(p_admin_id uuid,p_admin_session_id uuid,p_question_id uuid,p_expected_version integer,p_changes jsonb,p_idempotency_key text,p_request_hash text,p_request_id text)
RETURNS public.question_bank LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old public.question_bank%ROWTYPE; q public.question_bank%ROWTYPE; replay jsonb;
BEGIN PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); replay:=public.admin_console_replay(p_admin_id,p_idempotency_key,p_request_hash,'question.version'); IF replay IS NOT NULL THEN SELECT * INTO q FROM public.question_bank WHERE id=(replay->>'id')::uuid; RETURN q; END IF; SELECT * INTO old FROM public.question_bank WHERE id=p_question_id; IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF; PERFORM pg_advisory_xact_lock(hashtextextended('question:'||old.question_key::text,20260918)); SELECT * INTO old FROM public.question_bank WHERE id=p_question_id FOR UPDATE; IF old.version<>p_expected_version OR (SELECT max(version) FROM public.question_bank WHERE question_key=old.question_key)<>p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF; IF p_changes?'normalizationRule' AND p_changes->>'normalizationRule'<>old.normalization_rule THEN RAISE EXCEPTION 'normalization_conflict'; END IF;
  INSERT INTO public.question_bank(prompt,options,accepted_answer_hashes,normalization_rule,status,version,sampling_weight,question_key) VALUES(COALESCE(NULLIF(btrim(p_changes->>'prompt'),''),old.prompt),COALESCE(p_changes->'options',old.options),CASE WHEN p_changes?'acceptedAnswerHashes' THEN ARRAY(SELECT jsonb_array_elements_text(p_changes->'acceptedAnswerHashes')) ELSE old.accepted_answer_hashes END,old.normalization_rule,'draft',old.version+1,COALESCE((p_changes->>'samplingWeight')::integer,old.sampling_weight),old.question_key) RETURNING * INTO q;
  INSERT INTO public.admin_console_operations VALUES(p_admin_id,p_idempotency_key,p_request_hash,'question.version',jsonb_build_object('id',q.id),clock_timestamp()); INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id,idempotency_key)VALUES(p_admin_id,'admin.question.version','question',q.id,jsonb_build_object('version',q.version,'previousId',old.id),p_request_id,p_idempotency_key); RETURN q; END; $$;

CREATE FUNCTION public.admin_set_question_status_v2(p_admin_id uuid,p_admin_session_id uuid,p_question_id uuid,p_expected_version integer,p_status text,p_idempotency_key text,p_request_hash text,p_request_id text)
RETURNS public.question_bank LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q public.question_bank%ROWTYPE; next_q public.question_bank%ROWTYPE; replay jsonb;
BEGIN PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); replay:=public.admin_console_replay(p_admin_id,p_idempotency_key,p_request_hash,'question.status'); IF replay IS NOT NULL THEN SELECT * INTO next_q FROM public.question_bank WHERE id=(replay->>'id')::uuid; RETURN next_q; END IF; SELECT * INTO q FROM public.question_bank WHERE id=p_question_id; IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF; PERFORM pg_advisory_xact_lock(hashtextextended('question:'||q.question_key::text,20260918)); SELECT * INTO q FROM public.question_bank WHERE id=p_question_id FOR UPDATE; IF q.version<>p_expected_version OR (SELECT max(version) FROM public.question_bank WHERE question_key=q.question_key)<>p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF; IF p_status NOT IN('active','disabled') THEN RAISE EXCEPTION 'state_conflict'; END IF; UPDATE public.question_bank SET status='disabled' WHERE question_key=q.question_key AND status='active'; INSERT INTO public.question_bank(prompt,options,accepted_answer_hashes,normalization_rule,status,version,sampling_weight,question_key) VALUES(q.prompt,q.options,q.accepted_answer_hashes,q.normalization_rule,p_status,q.version+1,q.sampling_weight,q.question_key) RETURNING * INTO next_q; INSERT INTO public.admin_console_operations VALUES(p_admin_id,p_idempotency_key,p_request_hash,'question.status',jsonb_build_object('id',next_q.id),clock_timestamp()); INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id,idempotency_key)VALUES(p_admin_id,'admin.question.'||p_status,'question',next_q.id,jsonb_build_object('version',next_q.version,'previousId',q.id),p_request_id,p_idempotency_key); RETURN next_q; END; $$;

CREATE FUNCTION public.admin_retry_job_v2(p_admin_id uuid,p_admin_session_id uuid,p_job_id uuid,p_expected_version bigint,p_idempotency_key text,p_request_hash text,p_request_id text)
RETURNS TABLE(id uuid,kind text,status text,attempts integer,version bigint,updated_at timestamptz,error text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.snapshot_jobs%ROWTYPE; file public.upload_files%ROWTYPE; replay jsonb;
BEGIN PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); replay:=public.admin_console_replay(p_admin_id,p_idempotency_key,p_request_hash,'job.retry'); IF replay IS NOT NULL THEN p_job_id:=(replay->>'id')::uuid; END IF;
  SELECT * INTO job FROM public.snapshot_jobs j WHERE j.id=p_job_id FOR UPDATE; IF FOUND THEN IF replay IS NULL AND(job.status<>'failed' OR job.admin_version<>p_expected_version)THEN RAISE EXCEPTION 'version_conflict'; END IF; IF replay IS NULL THEN UPDATE public.snapshot_jobs SET status='queued',last_error=NULL,admin_version=admin_version+1 WHERE snapshot_jobs.id=p_job_id RETURNING * INTO job; END IF; kind:='snapshot';id:=job.id;status:=job.status;attempts:=job.attempts;version:=job.admin_version;updated_at:=job.updated_at;error:=job.last_error;
  ELSE SELECT * INTO file FROM public.upload_files f WHERE f.id=p_job_id FOR UPDATE; IF NOT FOUND OR file.status<>'cleanup_pending' THEN RAISE EXCEPTION 'not_found'; END IF; IF replay IS NULL AND file.cleanup_admin_version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF; IF replay IS NULL THEN UPDATE public.upload_files SET cleanup_next_retry_at=clock_timestamp(),cleanup_token=NULL,cleanup_last_error=NULL WHERE upload_files.id=p_job_id RETURNING * INTO file; END IF; kind:='cleanup';id:=file.id;status:=file.status;attempts:=file.cleanup_attempts;version:=file.cleanup_admin_version;updated_at:=file.updated_at;error:=file.cleanup_last_error; END IF;
  IF replay IS NULL THEN INSERT INTO public.admin_console_operations VALUES(p_admin_id,p_idempotency_key,p_request_hash,'job.retry',jsonb_build_object('id',p_job_id),clock_timestamp()); INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id,idempotency_key)VALUES(p_admin_id,'admin.job.retry','job',p_job_id,jsonb_build_object('kind',kind),p_request_id,p_idempotency_key); END IF; RETURN NEXT; END; $$;

CREATE FUNCTION public.admin_get_reauth_credential_v2(p_admin_id uuid,p_admin_session_id uuid) RETURNS TABLE(password_hash text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); RETURN QUERY SELECT u.password_hash FROM public.app_users u WHERE u.id=p_admin_id AND u.status='active' AND u.role='admin'; END; $$;
CREATE FUNCTION public.admin_mark_reauthenticated_v2(p_admin_id uuid,p_admin_session_id uuid,p_nonce_hash text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); IF p_nonce_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_reauth'; END IF; UPDATE public.user_sessions SET reauthenticated_at=clock_timestamp(),reauth_nonce_hash=p_nonce_hash WHERE id=p_admin_session_id AND user_id=p_admin_id AND revoked_at IS NULL AND expires_at>clock_timestamp() AND recovery_confirmed_at IS NOT NULL; IF NOT FOUND THEN RAISE EXCEPTION 'invalid_reauth' USING ERRCODE='42501'; END IF; RETURN true; END; $$;
CREATE FUNCTION public.admin_promote_user_v2(p_admin_id uuid,p_admin_session_id uuid,p_target_id uuid,p_expected_version bigint,p_nonce_hash text,p_idempotency_key text,p_request_hash text,p_request_id text) RETURNS public.app_users LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE target public.app_users%ROWTYPE; replay jsonb; BEGIN PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); replay:=public.admin_console_replay(p_admin_id,p_idempotency_key,p_request_hash,'user.promote'); IF replay IS NOT NULL THEN SELECT * INTO target FROM public.app_users WHERE id=(replay->>'id')::uuid; RETURN target; END IF; LOCK TABLE public.app_users IN SHARE ROW EXCLUSIVE MODE; PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); PERFORM 1 FROM public.user_sessions WHERE id=p_admin_session_id AND user_id=p_admin_id AND revoked_at IS NULL AND expires_at>clock_timestamp() AND recovery_confirmed_at IS NOT NULL AND reauthenticated_at>=clock_timestamp()-interval '5 minutes' AND reauth_nonce_hash=p_nonce_hash FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'reauthentication_required' USING ERRCODE='42501'; END IF; IF (SELECT count(*) FROM public.app_users WHERE role='admin' AND status='active')<1 THEN RAISE EXCEPTION 'last_active_admin'; END IF; SELECT * INTO target FROM public.app_users WHERE id=p_target_id FOR UPDATE; IF NOT FOUND OR target.status<>'active' OR target.role<>'member' THEN RAISE EXCEPTION 'state_conflict'; END IF; IF target.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF; UPDATE public.app_users SET role='admin',version=version+1 WHERE id=p_target_id RETURNING * INTO target; UPDATE public.user_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE user_id=p_target_id; UPDATE public.user_sessions SET reauth_nonce_hash=NULL,reauthenticated_at=NULL WHERE id=p_admin_session_id; INSERT INTO public.admin_console_operations VALUES(p_admin_id,p_idempotency_key,p_request_hash,'user.promote',jsonb_build_object('id',target.id),clock_timestamp()); INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id,idempotency_key) VALUES(p_admin_id,'admin.user.promote','user',target.id,jsonb_build_object('version',target.version),p_request_id,p_idempotency_key); RETURN target; END; $$;
CREATE FUNCTION public.admin_get_settings_v2(p_admin_id uuid,p_admin_session_id uuid) RETURNS TABLE(items jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); RETURN QUERY SELECT COALESCE(jsonb_agg(jsonb_build_object('key',s.key,'value',s.value,'version',s.version,'updated_at',s.updated_at) ORDER BY s.key),'[]'::jsonb) FROM public.site_settings s WHERE s.key IN('announcement','adult_content_policy','feature_flags'); END; $$;
CREATE FUNCTION public.admin_update_setting_v2(p_admin_id uuid,p_admin_session_id uuid,p_key text,p_expected_version bigint,p_value jsonb,p_idempotency_key text,p_request_hash text,p_request_id text) RETURNS public.site_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE setting public.site_settings%ROWTYPE; replay jsonb; BEGIN PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); replay:=public.admin_console_replay(p_admin_id,p_idempotency_key,p_request_hash,'setting.'||p_key); IF replay IS NOT NULL THEN SELECT * INTO setting FROM public.site_settings WHERE key=p_key; RETURN setting; END IF; IF p_key NOT IN('announcement','adult_content_policy','feature_flags') OR jsonb_typeof(p_value)<>'object' THEN RAISE EXCEPTION 'invalid_setting'; END IF; IF p_key='announcement' AND (jsonb_typeof(p_value->'enabled')<>'boolean' OR jsonb_typeof(p_value->'text')<>'string' OR length(p_value->>'text')>500 OR p_value-ARRAY['enabled','text']<>'{}'::jsonb) THEN RAISE EXCEPTION 'invalid_setting'; END IF; IF p_key='adult_content_policy' AND (COALESCE(p_value->>'version','')!~'^[A-Za-z0-9._-]{1,64}$' OR (p_value?'warning' AND (jsonb_typeof(p_value->'warning')<>'string' OR length(p_value->>'warning')>500)) OR p_value-ARRAY['version','warning']<>'{}'::jsonb) THEN RAISE EXCEPTION 'invalid_setting'; END IF; IF p_key='feature_flags' AND (EXISTS(SELECT 1 FROM jsonb_each(p_value) flag WHERE flag.key NOT IN('registrationEnabled','submissionsEnabled','commentsEnabled','legacyMigrationEnabled') OR jsonb_typeof(flag.value)<>'boolean')) THEN RAISE EXCEPTION 'invalid_setting'; END IF; SELECT * INTO setting FROM public.site_settings WHERE key=p_key FOR UPDATE; IF FOUND AND setting.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF; IF NOT FOUND AND p_expected_version<>1 THEN RAISE EXCEPTION 'version_conflict'; END IF; INSERT INTO public.site_settings(key,value,version,updated_by) VALUES(p_key,p_value,1,p_admin_id) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=public.site_settings.version+1,updated_by=p_admin_id,updated_at=clock_timestamp() RETURNING * INTO setting; INSERT INTO public.admin_console_operations VALUES(p_admin_id,p_idempotency_key,p_request_hash,'setting.'||p_key,jsonb_build_object('id',p_key),clock_timestamp()); INSERT INTO public.audit_logs(actor_id,action,target_type,summary,request_id,idempotency_key) VALUES(p_admin_id,'admin.setting.update','setting',jsonb_build_object('key',p_key,'version',setting.version),p_request_id,p_idempotency_key); RETURN setting; END; $$;
CREATE FUNCTION public.admin_health_v2(p_admin_id uuid,p_admin_session_id uuid) RETURNS TABLE(ok boolean,database_version text,snapshot jsonb,migration jsonb,jobs jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN PERFORM public.interaction_assert_admin(p_admin_id,p_admin_session_id); RETURN QUERY SELECT true,'20260919_final_auth_hardening',jsonb_build_object('currentVersion',(SELECT version FROM public.snapshot_current WHERE snapshot_type='catalog'),'failed',(SELECT count(*) FROM public.snapshot_jobs WHERE status='failed')),jsonb_build_object('activeRuns',(SELECT count(*) FROM public.backend_v2_migration_runs WHERE status='running')),jsonb_build_object('snapshotFailed',(SELECT count(*) FROM public.snapshot_jobs WHERE status='failed'),'cleanupFailed',(SELECT count(*) FROM public.upload_files WHERE status='cleanup_pending' AND cleanup_last_error IS NOT NULL)); END; $$;

DO $$ DECLARE fn record; BEGIN FOR fn IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND(p.proname LIKE 'admin_%_v2' OR p.proname='admin_console_replay') LOOP EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC',fn.signature); END LOOP; END $$;
COMMIT;
