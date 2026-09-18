BEGIN;

CREATE TABLE public.content_access_install_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  seeded_policy boolean NOT NULL
);
WITH inserted AS (
  INSERT INTO public.site_settings (key, value, version)
  VALUES ('adult_content_policy', jsonb_build_object(
    'version', '2026-09',
    'warning', '包含成人向内容。此确认仅为年满18岁的自我声明，不是实名年龄核验，也不替代当地法律、版权授权或平台规则。'
  ), 1)
  ON CONFLICT (key) DO NOTHING RETURNING 1
)
INSERT INTO public.content_access_install_state(singleton,seeded_policy)
SELECT true,EXISTS(SELECT 1 FROM inserted);

CREATE TABLE public.content_access_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES public.user_sessions(id) ON DELETE RESTRICT,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE RESTRICT,
  work_version bigint NOT NULL CHECK (work_version > 0),
  asset_set_hash text NOT NULL CHECK (asset_set_hash ~ '^[0-9a-f]{64}$'),
  policy_version text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued', 'denied', 'expired')),
  expires_at timestamptz NOT NULL,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > created_at),
  CHECK ((status = 'issued' AND issued_at IS NOT NULL) OR (status <> 'issued' AND issued_at IS NULL))
);
CREATE INDEX content_access_authorizations_pending_idx
  ON public.content_access_authorizations (user_id, work_id, expires_at)
  WHERE status = 'pending';
CREATE INDEX content_access_authorizations_expiry_idx ON public.content_access_authorizations(expires_at);
CREATE INDEX content_access_authorizations_session_idx ON public.content_access_authorizations(session_id,expires_at);
ALTER TABLE public.content_access_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.content_access_authorizations FROM PUBLIC;

CREATE TABLE public.restricted_access_controls (
  user_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('blocked','allowed')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  updated_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.restricted_access_controls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.restricted_access_controls FROM PUBLIC;

CREATE FUNCTION public.resolve_content_user_session(p_token_hash text)
RETURNS TABLE (user_id uuid, role text, session_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT session.user_id,app_user.role,session.id
    FROM public.user_sessions AS session JOIN public.app_users AS app_user ON app_user.id=session.user_id
   WHERE p_token_hash ~ '^[0-9a-f]{64}$' AND session.token_hash=p_token_hash
     AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp()
     AND session.recovery_confirmed_at IS NOT NULL AND app_user.status='active'
     AND app_user.recovery_confirmed_at IS NOT NULL LIMIT 1;
$$;

CREATE FUNCTION public.content_access_asset_manifest(p_work_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',asset.id,'object_key',asset.object_key,'checksum',asset.checksum,'kind',asset.kind,'mime_type',asset.mime_type,
    'page_no',asset.page_no,'chapter_id',asset.chapter_id,'chapter_position',chapter.position,
    'storage_zone',asset.storage_zone,'access_level',asset.access_level,'status',asset.status
  ) ORDER BY COALESCE(chapter.position,0),COALESCE(asset.page_no,0),asset.kind,asset.id),'[]'::jsonb)
  FROM public.work_assets AS asset LEFT JOIN public.work_chapters AS chapter ON chapter.id=asset.chapter_id
  WHERE asset.work_id=p_work_id AND asset.storage_zone='private' AND asset.access_level='private'
    AND asset.status='active' AND starts_with(asset.object_key,'protected/works/'||p_work_id::text||'/');
$$;

CREATE FUNCTION public.content_access_asset_hash(p_manifest jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT encode(digest(convert_to(COALESCE(p_manifest,'[]'::jsonb)::text,'UTF8'),'sha256'),'hex');
$$;

CREATE FUNCTION public.content_access_constant_time_equal(p_left text,p_right text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, public AS $$
DECLARE left_bytes bytea; right_bytes bytea; difference integer := 0; position integer;
BEGIN
  IF p_left !~ '^[0-9a-f]{64}$' OR p_right !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  left_bytes := decode(p_left,'hex'); right_bytes := decode(p_right,'hex');
  FOR position IN 0..31 LOOP difference := difference | (get_byte(left_bytes,position) # get_byte(right_bytes,position)); END LOOP;
  RETURN difference=0;
END;
$$;

CREATE FUNCTION public.get_current_age_policy()
RETURNS TABLE (policy_version text, warning text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT setting.value->>'version', setting.value->>'warning'
    FROM public.site_settings AS setting
   WHERE setting.key = 'adult_content_policy'
     AND jsonb_typeof(setting.value) = 'object'
     AND length(btrim(setting.value->>'version')) BETWEEN 1 AND 64
     AND length(btrim(setting.value->>'warning')) BETWEEN 1 AND 2000;
$$;

CREATE FUNCTION public.set_age_consent(p_user_id uuid, p_policy_version text, p_request_id text)
RETURNS TABLE (accepted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE app_user public.app_users%ROWTYPE; current_policy text; accepted timestamptz := clock_timestamp(); existing_accepted timestamptz;
BEGIN
  SELECT * INTO app_user FROM public.app_users WHERE id = p_user_id FOR NO KEY UPDATE;
  IF NOT FOUND OR app_user.status <> 'active' THEN RAISE EXCEPTION 'access_denied'; END IF;
  SELECT value->>'version' INTO current_policy FROM public.site_settings WHERE key='adult_content_policy' FOR SHARE;
  IF current_policy IS NULL OR p_policy_version IS DISTINCT FROM current_policy THEN RAISE EXCEPTION 'policy_stale'; END IF;
  SELECT consent.accepted_at INTO existing_accepted FROM public.age_consents AS consent
   WHERE consent.user_id=p_user_id AND consent.policy_version=current_policy AND consent.revoked_at IS NULL FOR UPDATE;
  IF existing_accepted IS NOT NULL THEN RETURN QUERY SELECT existing_accepted; RETURN; END IF;
  UPDATE public.age_consents SET revoked_at=accepted, updated_at=accepted WHERE user_id=p_user_id AND revoked_at IS NULL;
  INSERT INTO public.age_consents(user_id,policy_version,accepted_at,revoked_at,updated_at)
  VALUES(p_user_id,current_policy,accepted,NULL,accepted)
  ON CONFLICT(user_id,policy_version) DO UPDATE SET accepted_at=EXCLUDED.accepted_at, revoked_at=NULL, updated_at=EXCLUDED.updated_at;
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id)
  VALUES(p_user_id,'age_consent.accept','user',p_user_id,jsonb_build_object('policyVersion',current_policy,'selfDeclaredAdult',true),p_request_id);
  RETURN QUERY SELECT accepted;
END;
$$;

CREATE FUNCTION public.revoke_age_consent(p_user_id uuid, p_request_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE app_user public.app_users%ROWTYPE; changed boolean;
BEGIN
  SELECT * INTO app_user FROM public.app_users WHERE id=p_user_id FOR NO KEY UPDATE;
  IF NOT FOUND OR app_user.status <> 'active' THEN RAISE EXCEPTION 'access_denied'; END IF;
  UPDATE public.age_consents SET revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE user_id=p_user_id AND revoked_at IS NULL;
  changed := FOUND;
  IF changed THEN
    INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id)
    VALUES(p_user_id,'age_consent.revoke','user',p_user_id,jsonb_build_object('revoked',true),p_request_id);
  END IF;
  RETURN changed;
END;
$$;

CREATE FUNCTION public.authorize_work_access(p_user_id uuid, p_session_id uuid, p_work_id uuid)
RETURNS TABLE (authorization_id uuid, allowed boolean, error_code text, work_id uuid, work_type text, title text, rating text, assets jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE app_user public.app_users%ROWTYPE; session public.user_sessions%ROWTYPE; work public.works%ROWTYPE; policy text; consent_ok boolean := false; blocked boolean := false; authorization uuid; manifest jsonb; manifest_hash text;
BEGIN
  SELECT * INTO app_user FROM public.app_users WHERE id=p_user_id FOR NO KEY UPDATE;
  IF NOT FOUND OR app_user.status <> 'active' OR app_user.recovery_confirmed_at IS NULL THEN
    RETURN QUERY SELECT NULL::uuid,false,'ACCESS_DENIED',NULL::uuid,NULL::text,NULL::text,NULL::text,'[]'::jsonb; RETURN;
  END IF;
  SELECT * INTO session FROM public.user_sessions WHERE id=p_session_id AND user_id=p_user_id FOR SHARE;
  IF NOT FOUND OR session.revoked_at IS NOT NULL OR session.expires_at<=clock_timestamp() OR session.recovery_confirmed_at IS NULL THEN
    RETURN QUERY SELECT NULL::uuid,false,'SESSION_EXPIRED',NULL::uuid,NULL::text,NULL::text,NULL::text,'[]'::jsonb; RETURN;
  END IF;
  SELECT * INTO work FROM public.works WHERE id=p_work_id FOR SHARE;
  IF NOT FOUND OR work.status='deleted' OR (app_user.role <> 'admin' AND work.status <> 'published') THEN
    RETURN QUERY SELECT NULL::uuid,false,'NOT_FOUND',NULL::uuid,NULL::text,NULL::text,NULL::text,'[]'::jsonb; RETURN;
  END IF;
  SELECT value->>'version' INTO policy FROM public.site_settings WHERE key='adult_content_policy' FOR SHARE;
  SELECT control.status='blocked' INTO blocked FROM public.restricted_access_controls AS control WHERE control.user_id=p_user_id FOR SHARE;
  IF work.rating='restricted' AND blocked IS TRUE THEN
    RETURN QUERY SELECT NULL::uuid,false,'ACCESS_DENIED',work.id,work.type,work.title,work.rating,'[]'::jsonb; RETURN;
  END IF;
  IF work.rating='restricted' AND app_user.role<>'admin' THEN
    SELECT true INTO consent_ok FROM public.age_consents
     WHERE user_id=p_user_id AND policy_version=policy AND revoked_at IS NULL
     ORDER BY accepted_at DESC LIMIT 1 FOR SHARE;
    IF consent_ok IS DISTINCT FROM true THEN
      RETURN QUERY SELECT NULL::uuid,false,'AGE_CONSENT_REQUIRED',work.id,work.type,work.title,work.rating,'[]'::jsonb; RETURN;
    END IF;
  END IF;
  PERFORM 1 FROM public.work_assets AS asset WHERE asset.work_id=work.id FOR SHARE;
  manifest := public.content_access_asset_manifest(work.id);
  manifest_hash := public.content_access_asset_hash(manifest);
  INSERT INTO public.content_access_authorizations(user_id,session_id,work_id,work_version,asset_set_hash,policy_version,status,expires_at)
  VALUES(p_user_id,p_session_id,p_work_id,work.version,manifest_hash,CASE WHEN work.rating='restricted' THEN policy ELSE NULL END,'pending',clock_timestamp()+interval '1 minute')
  RETURNING id INTO authorization;
  RETURN QUERY SELECT authorization,true,NULL::text,work.id,work.type,work.title,work.rating,manifest;
END;
$$;

CREATE FUNCTION public.finalize_work_access(p_authorization_id uuid, p_user_id uuid, p_session_id uuid, p_work_id uuid)
RETURNS TABLE (allowed boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE authorization public.content_access_authorizations%ROWTYPE; app_user public.app_users%ROWTYPE; session public.user_sessions%ROWTYPE; work public.works%ROWTYPE; policy text; consent_ok boolean := false; blocked boolean := false; denial text; manifest_hash text;
BEGIN
  SELECT * INTO app_user FROM public.app_users WHERE id=p_user_id FOR NO KEY UPDATE;
  SELECT * INTO session FROM public.user_sessions WHERE id=p_session_id AND user_id=p_user_id FOR SHARE;
  SELECT * INTO work FROM public.works WHERE id=p_work_id FOR SHARE;
  SELECT value->>'version' INTO policy FROM public.site_settings WHERE key='adult_content_policy' FOR SHARE;
  SELECT control.status='blocked' INTO blocked FROM public.restricted_access_controls AS control WHERE control.user_id=p_user_id FOR SHARE;
  PERFORM 1 FROM public.work_assets AS asset WHERE asset.work_id=p_work_id FOR SHARE;
  manifest_hash := public.content_access_asset_hash(public.content_access_asset_manifest(p_work_id));
  SELECT * INTO authorization FROM public.content_access_authorizations
   WHERE id=p_authorization_id AND user_id=p_user_id AND session_id=p_session_id AND work_id=p_work_id FOR UPDATE;
  IF NOT FOUND OR authorization.status<>'pending' OR authorization.expires_at<=clock_timestamp() THEN
    RETURN QUERY SELECT false,'ACCESS_DENIED'; RETURN;
  END IF;
  IF app_user.id IS NULL OR app_user.status<>'active' OR app_user.recovery_confirmed_at IS NULL THEN denial := 'ACCESS_DENIED';
  ELSIF session.id IS NULL OR session.revoked_at IS NOT NULL OR session.expires_at<=clock_timestamp() OR session.recovery_confirmed_at IS NULL THEN denial := 'SESSION_EXPIRED';
  ELSIF work.id IS NULL OR work.status='deleted' OR (app_user.role <> 'admin' AND work.status <> 'published') THEN denial := 'NOT_FOUND';
  ELSIF work.rating='restricted' AND blocked IS TRUE THEN denial := 'ACCESS_DENIED';
  ELSIF work.version<>authorization.work_version OR NOT public.content_access_constant_time_equal(manifest_hash,authorization.asset_set_hash) THEN denial := 'ASSET_SET_CHANGED';
  ELSIF work.rating='restricted' AND app_user.role <> 'admin' THEN
    SELECT true INTO consent_ok FROM public.age_consents
     WHERE user_id=p_user_id AND policy_version=policy AND revoked_at IS NULL
     ORDER BY accepted_at DESC LIMIT 1 FOR SHARE;
    IF consent_ok IS DISTINCT FROM true OR authorization.policy_version IS DISTINCT FROM policy THEN denial := 'AGE_CONSENT_REQUIRED'; END IF;
  END IF;
  IF denial IS NOT NULL THEN
    UPDATE public.content_access_authorizations SET status='denied' WHERE id=authorization.id;
    RETURN QUERY SELECT false,denial; RETURN;
  END IF;
  UPDATE public.content_access_authorizations SET status='issued',issued_at=clock_timestamp() WHERE id=authorization.id;
  RETURN QUERY SELECT true,NULL::text;
END;
$$;

CREATE FUNCTION public.set_restricted_access_control(p_admin_id uuid,p_user_id uuid,p_action text,p_reason text,p_request_id text)
RETURNS TABLE (id uuid,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE admin public.app_users%ROWTYPE; target public.app_users%ROWTYPE; next_status text;
BEGIN
  IF p_action NOT IN ('revoke','restore') OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'invalid_access_control'; END IF;
  PERFORM 1 FROM public.app_users WHERE id IN (p_admin_id,p_user_id) ORDER BY id FOR NO KEY UPDATE;
  SELECT * INTO admin FROM public.app_users WHERE id=p_admin_id;
  SELECT * INTO target FROM public.app_users WHERE id=p_user_id;
  IF admin.id IS NULL OR admin.status<>'active' OR admin.role<>'admin' OR admin.recovery_confirmed_at IS NULL THEN RAISE EXCEPTION 'access_denied'; END IF;
  IF target.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  next_status := CASE p_action WHEN 'revoke' THEN 'blocked' ELSE 'allowed' END;
  INSERT INTO public.restricted_access_controls(user_id,status,reason,updated_by,updated_at)
  VALUES(p_user_id,next_status,btrim(p_reason),p_admin_id,clock_timestamp())
  ON CONFLICT(user_id) DO UPDATE SET status=EXCLUDED.status,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at;
  IF next_status='blocked' THEN
    UPDATE public.content_access_authorizations SET status='denied'
     WHERE user_id=p_user_id AND status='pending';
  END IF;
  INSERT INTO public.audit_logs(actor_id,action,target_type,target_id,summary,request_id)
  VALUES(p_admin_id,'restricted_access.'||p_action,'user',p_user_id,jsonb_build_object('status',next_status,'reason',btrim(p_reason)),p_request_id);
  RETURN QUERY SELECT p_user_id,next_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_work(p_slug text)
RETURNS TABLE (slug text, type text, title text, summary text, rating text, author_name text, published_at timestamptz, chapters jsonb, assets jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT work.slug,work.type,work.title,work.summary,work.rating,work.author_name,work.published_at,
    CASE WHEN work.rating='restricted' THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('title',chapter.title,'position',chapter.position) ORDER BY chapter.position) FROM public.work_chapters AS chapter WHERE chapter.work_id=work.id AND chapter.status='published'),'[]'::jsonb) END,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('chapter_position',chapter.position,'kind',asset.kind,'object_key',asset.object_key,'page_no',asset.page_no) ORDER BY COALESCE(chapter.position,0),COALESCE(asset.page_no,0),asset.id)
      FROM public.work_assets AS asset LEFT JOIN public.work_chapters AS chapter ON chapter.id=asset.chapter_id
      WHERE asset.work_id=work.id AND asset.status='active' AND asset.access_level='public' AND asset.storage_zone='public'
        AND (work.rating <> 'restricted' OR asset.kind='preview')), '[]'::jsonb)
  FROM public.works AS work WHERE work.slug=p_slug AND work.status='published';
$$;

CREATE FUNCTION public.get_public_restricted_access_id(p_slug text)
RETURNS TABLE (work_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT work.id FROM public.works AS work
   WHERE work.slug=p_slug AND work.status='published' AND work.rating='restricted';
$$;

REVOKE EXECUTE ON FUNCTION public.get_current_age_policy() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_content_user_session(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.content_access_asset_manifest(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.content_access_asset_hash(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.content_access_constant_time_equal(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_age_consent(uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_age_consent(uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.authorize_work_access(uuid,uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_work_access(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_restricted_access_control(uuid,uuid,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_public_restricted_access_id(text) FROM PUBLIC;

COMMIT;
