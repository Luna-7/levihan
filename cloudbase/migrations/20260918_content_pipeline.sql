BEGIN;

CREATE TABLE public.work_chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  position integer NOT NULL CHECK (position > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'archived')),
  created_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX work_chapters_work_status_idx ON public.work_chapters (work_id, status, position);
CREATE INDEX work_chapters_created_by_idx ON public.work_chapters (created_by);
CREATE INDEX work_chapters_updated_by_idx ON public.work_chapters (updated_by);
ALTER TABLE public.work_chapters ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER work_chapters_set_updated_at BEFORE UPDATE ON public.work_chapters
  FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();

ALTER TABLE public.work_assets
  ADD COLUMN chapter_id uuid REFERENCES public.work_chapters(id) ON DELETE RESTRICT,
  ADD COLUMN storage_zone text NOT NULL DEFAULT 'private' CHECK (storage_zone IN ('public','private')),
  ADD CONSTRAINT work_assets_zone_key CHECK (
    (storage_zone = 'public' AND access_level = 'public' AND object_key LIKE 'media/works/%')
    OR (storage_zone = 'private' AND access_level = 'private' AND object_key LIKE 'protected/works/%')
  );
ALTER TABLE public.work_assets DROP CONSTRAINT work_assets_work_id_kind_page_no_key;
CREATE UNIQUE INDEX work_assets_root_cover_key ON public.work_assets (work_id) WHERE chapter_id IS NULL AND kind = 'cover' AND status <> 'deleted';
CREATE UNIQUE INDEX work_assets_root_body_key ON public.work_assets (work_id) WHERE chapter_id IS NULL AND kind = 'body' AND status <> 'deleted';
CREATE UNIQUE INDEX work_assets_root_page_key ON public.work_assets (work_id, page_no) WHERE chapter_id IS NULL AND kind = 'page' AND status <> 'deleted';
CREATE UNIQUE INDEX work_assets_chapter_cover_key ON public.work_assets (chapter_id) WHERE chapter_id IS NOT NULL AND kind = 'cover' AND status <> 'deleted';
CREATE UNIQUE INDEX work_assets_chapter_body_key ON public.work_assets (chapter_id) WHERE chapter_id IS NOT NULL AND kind = 'body' AND status <> 'deleted';
CREATE UNIQUE INDEX work_assets_chapter_page_key ON public.work_assets (chapter_id, page_no) WHERE chapter_id IS NOT NULL AND kind = 'page' AND status <> 'deleted';
CREATE INDEX work_assets_chapter_idx ON public.work_assets (chapter_id, status, kind, page_no);

ALTER TABLE public.upload_files
  ADD COLUMN work_id uuid REFERENCES public.works(id) ON DELETE RESTRICT,
  ADD COLUMN chapter_id uuid REFERENCES public.work_chapters(id) ON DELETE RESTRICT,
  ADD COLUMN expected_checksum text,
  ADD COLUMN kind text CHECK (kind IN ('cover', 'page', 'body', 'attachment', 'preview')),
  ADD COLUMN page_no integer CHECK (page_no IS NULL OR page_no > 0),
  ADD COLUMN access_level text CHECK (access_level IN ('public', 'private')),
  ADD COLUMN asset_id uuid REFERENCES public.work_assets(id) ON DELETE RESTRICT,
  ADD COLUMN final_object_key text,
  ADD COLUMN storage_zone text CHECK (storage_zone IN ('public','private')),
  ADD COLUMN promotion_token uuid,
  ADD COLUMN promotion_started_at timestamptz,
  ADD COLUMN scan_status text CHECK (scan_status IS NULL OR scan_status IN ('basic_format_only')),
  ADD COLUMN content_disposition text CHECK (content_disposition IS NULL OR content_disposition = 'attachment'),
  ADD COLUMN etag text,
  ADD CONSTRAINT upload_files_expected_checksum_format CHECK (expected_checksum IS NULL OR expected_checksum ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT upload_files_work_shape CHECK (
    (work_id IS NULL AND kind IS NULL AND access_level IS NULL)
    OR (work_id IS NOT NULL AND kind IS NOT NULL AND access_level IS NOT NULL)
  ),
  ADD CONSTRAINT upload_files_page_shape CHECK (kind IS DISTINCT FROM 'page' OR page_no IS NOT NULL);
CREATE INDEX upload_files_work_idx ON public.upload_files (work_id, status);
CREATE INDEX upload_files_chapter_idx ON public.upload_files (chapter_id, status);
CREATE INDEX upload_files_promotion_cleanup_idx ON public.upload_files (promotion_started_at) WHERE status = 'promoting';
ALTER TABLE public.upload_files DROP CONSTRAINT upload_files_status_check;
ALTER TABLE public.upload_files ADD CONSTRAINT upload_files_status_check
  CHECK (status IN ('declared','uploaded','promoting','cleanup_pending','verified','bound','rejected','orphaned','deleted'));
ALTER TABLE public.upload_files ADD COLUMN cleanup_token uuid;

ALTER TABLE public.upload_sessions ADD COLUMN idempotency_key text;
ALTER TABLE public.upload_sessions ADD COLUMN request_hash text CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX upload_sessions_owner_purpose_idempotency_key
  ON public.upload_sessions (owner_id, purpose, idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.snapshot_jobs DROP CONSTRAINT snapshot_jobs_status_check;
ALTER TABLE public.snapshot_jobs ADD CONSTRAINT snapshot_jobs_status_check
  CHECK (status IN ('queued', 'running', 'prepared', 'succeeded', 'failed', 'cancelled'));
ALTER TABLE public.snapshot_jobs ADD COLUMN delivery_version bigint CHECK (delivery_version IS NULL OR delivery_version > 0);
ALTER TABLE public.snapshot_jobs ADD COLUMN lease_expires_at timestamptz;
ALTER TABLE public.snapshot_jobs ADD COLUMN lease_token uuid;
ALTER TABLE public.snapshot_jobs ADD COLUMN lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0);
ALTER TABLE public.snapshot_jobs ADD COLUMN build_generated_at timestamptz;
CREATE TABLE public.snapshot_current (
  snapshot_type text PRIMARY KEY CHECK (snapshot_type IN ('catalog','tags','config')),
  version bigint NOT NULL CHECK (version > 0),
  object_key text NOT NULL,
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.snapshot_current ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX snapshot_jobs_one_active_type
  ON public.snapshot_jobs (snapshot_type) WHERE status IN ('running','prepared');

ALTER TABLE public.audit_logs ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX audit_logs_actor_action_idempotency_key
  ON public.audit_logs (actor_id, action, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE FUNCTION public.create_work_draft(
  p_slug text, p_type text, p_title text, p_summary text, p_rating text,
  p_author_name text, p_actor_id uuid, p_request_id text, p_idempotency_key text
)
RETURNS SETOF public.works
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.app_users%ROWTYPE; created public.works%ROWTYPE; prior_target uuid;
BEGIN
  SELECT * INTO actor FROM public.app_users WHERE id = p_actor_id AND status = 'active' FOR KEY SHARE;
  IF NOT FOUND OR actor.role <> 'admin' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT target_id INTO prior_target FROM public.audit_logs WHERE actor_id = p_actor_id AND action = 'work.create' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN SELECT * INTO created FROM public.works WHERE id = prior_target; SELECT (summary->>'status')::text, (summary->>'version')::bigint INTO created.status, created.version FROM public.audit_logs WHERE actor_id=p_actor_id AND action='work.create' AND idempotency_key=p_idempotency_key; RETURN NEXT created; RETURN; END IF;
  BEGIN
    INSERT INTO public.works (slug, type, title, summary, rating, status, author_name, created_by, updated_by)
    VALUES (p_slug, p_type, btrim(p_title), btrim(p_summary), p_rating, 'draft', btrim(p_author_name), p_actor_id, p_actor_id)
    RETURNING * INTO created;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'slug_conflict' USING ERRCODE = 'P0001'; END;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id, idempotency_key)
  VALUES (p_actor_id, 'work.create', 'work', created.id, jsonb_build_object('id',created.id,'status',created.status,'version', created.version), p_request_id, p_idempotency_key);
  RETURN NEXT created;
END;
$$;

CREATE FUNCTION public.update_work_draft(
  p_work_id uuid, p_expected_version bigint, p_changes jsonb, p_chapters jsonb,
  p_actor_id uuid, p_request_id text, p_idempotency_key text
)
RETURNS SETOF public.works
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.app_users%ROWTYPE; work public.works%ROWTYPE; chapter jsonb; chapter_id uuid; updated_count integer;
BEGIN
  SELECT * INTO actor FROM public.app_users WHERE id = p_actor_id AND status = 'active' FOR KEY SHARE;
  IF NOT FOUND OR actor.role <> 'admin' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.audit_logs WHERE actor_id = p_actor_id AND action = 'work.update' AND idempotency_key = p_idempotency_key AND target_id = p_work_id)
  THEN SELECT * INTO work FROM public.works WHERE id = p_work_id; SELECT (summary->>'status')::text, (summary->>'version')::bigint INTO work.status, work.version FROM public.audit_logs WHERE actor_id=p_actor_id AND action='work.update' AND idempotency_key=p_idempotency_key; RETURN NEXT work; RETURN; END IF;
  SELECT * INTO work FROM public.works WHERE id = p_work_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001'; END IF;
  IF work.version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'P0001'; END IF;
  IF work.status NOT IN ('draft', 'review') THEN RAISE EXCEPTION 'state_conflict' USING ERRCODE = 'P0001'; END IF;

  IF COALESCE(p_changes->>'rating', work.rating) = 'restricted' AND EXISTS (
    SELECT 1 FROM public.work_assets a WHERE a.work_id=p_work_id AND a.kind IN ('page','body','attachment') AND (a.access_level <> 'private' OR a.storage_zone <> 'private')
    UNION ALL SELECT 1 FROM public.upload_files f WHERE f.work_id=p_work_id AND f.kind IN ('page','body','attachment') AND (
      (f.status='declared' AND f.access_level <> 'private') OR (f.status IN ('promoting','cleanup_pending') AND (f.access_level <> 'private' OR f.storage_zone <> 'private')))
  ) THEN RAISE EXCEPTION 'restricted_storage_invalid' USING ERRCODE='P0001'; END IF;

  IF p_chapters IS NOT NULL THEN
    IF jsonb_typeof(p_chapters) <> 'array' OR jsonb_array_length(p_chapters) > 1000 THEN RAISE EXCEPTION 'chapters_invalid' USING ERRCODE = '22023'; END IF;
    SET CONSTRAINTS work_chapters_work_id_position_key DEFERRED;
    FOR chapter IN SELECT value FROM jsonb_array_elements(p_chapters) LOOP
      chapter_id := NULLIF(chapter->>'id', '')::uuid;
      IF chapter_id IS NULL THEN
        INSERT INTO public.work_chapters (work_id, title, position, created_by, updated_by)
        VALUES (p_work_id, btrim(chapter->>'title'), (chapter->>'position')::integer, p_actor_id, p_actor_id);
      ELSE
        UPDATE public.work_chapters
           SET title = btrim(chapter->>'title'), position = (chapter->>'position')::integer,
               version = version + 1, updated_by = p_actor_id
         WHERE id = chapter_id AND work_id = p_work_id AND version = (chapter->>'version')::bigint;
        GET DIAGNOSTICS updated_count = ROW_COUNT;
        IF updated_count <> 1 THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'P0001'; END IF;
      END IF;
    END LOOP;
  END IF;

  BEGIN
    UPDATE public.works SET
      slug = COALESCE(p_changes->>'slug', slug), title = COALESCE(p_changes->>'title', title),
      summary = COALESCE(p_changes->>'summary', summary), rating = COALESCE(p_changes->>'rating', rating),
      author_name = COALESCE(p_changes->>'authorName', author_name), version = version + 1, updated_by = p_actor_id
    WHERE id = p_work_id RETURNING * INTO work;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'slug_conflict' USING ERRCODE = 'P0001'; END;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id, idempotency_key)
  VALUES (p_actor_id, 'work.update', 'work', p_work_id, jsonb_build_object('id',work.id,'status',work.status,'version', work.version, 'fields', (SELECT jsonb_agg(keys.key ORDER BY keys.key) FROM jsonb_object_keys(p_changes) AS keys(key))), p_request_id, p_idempotency_key);
  RETURN NEXT work;
END;
$$;

CREATE FUNCTION public.transition_work_state(
  p_work_id uuid, p_expected_version bigint, p_expected_status text, p_target_status text,
  p_action text, p_actor_id uuid, p_request_id text, p_idempotency_key text
)
RETURNS SETOF public.works
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.app_users%ROWTYPE; work public.works%ROWTYPE; asset public.work_assets%ROWTYPE; next_version bigint; snapshot jsonb;
BEGIN
  SELECT * INTO actor FROM public.app_users WHERE id = p_actor_id AND status = 'active' FOR KEY SHARE;
  IF NOT FOUND OR actor.role <> 'admin' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.audit_logs WHERE actor_id = p_actor_id AND action = 'work.' || p_action AND idempotency_key = p_idempotency_key AND target_id = p_work_id)
  THEN SELECT * INTO work FROM public.works WHERE id = p_work_id; SELECT (summary->>'status')::text, (summary->>'version')::bigint INTO work.status, work.version FROM public.audit_logs WHERE actor_id=p_actor_id AND action='work.'||p_action AND idempotency_key=p_idempotency_key; RETURN NEXT work; RETURN; END IF;
  SELECT * INTO work FROM public.works WHERE id = p_work_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001'; END IF;
  IF work.version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'P0001'; END IF;
  IF work.status <> p_expected_status OR NOT (
    (p_expected_status = 'draft' AND p_target_status = 'review' AND p_action = 'review') OR
    (p_expected_status = 'review' AND p_target_status = 'published' AND p_action = 'publish') OR
    (p_expected_status = 'published' AND p_target_status = 'archived' AND p_action = 'archive') OR
    (p_expected_status = 'archived' AND p_target_status = 'draft' AND p_action = 'restore')
  ) THEN RAISE EXCEPTION 'state_conflict' USING ERRCODE = 'P0001'; END IF;

  IF p_target_status = 'published' THEN
    IF work.rating = 'restricted' AND EXISTS (
      SELECT 1 FROM public.work_assets AS restricted_asset
      WHERE restricted_asset.work_id = p_work_id AND restricted_asset.status IN ('verified','active')
        AND restricted_asset.kind IN ('page','body','attachment')
        AND (restricted_asset.access_level <> 'private' OR restricted_asset.storage_zone <> 'private')
    ) THEN RAISE EXCEPTION 'asset_policy_invalid' USING ERRCODE = 'P0001'; END IF;
    PERFORM 1 FROM public.work_assets WHERE work_id=p_work_id AND status IN ('verified','active') FOR UPDATE;
    IF work.type = 'comic' AND (
      NOT EXISTS (SELECT 1 FROM public.work_assets WHERE work_id = p_work_id AND kind = 'cover' AND status IN ('verified','active')) OR
      NOT EXISTS (SELECT 1 FROM public.work_assets WHERE work_id = p_work_id AND kind = 'page' AND status IN ('verified','active'))
    ) THEN RAISE EXCEPTION 'assets_incomplete' USING ERRCODE = 'P0001'; END IF;
    IF work.type = 'comic' AND EXISTS (
      SELECT 1 FROM public.work_chapters AS chapter
      WHERE chapter.work_id = p_work_id AND NOT EXISTS (
        SELECT 1 FROM public.work_assets AS page WHERE page.chapter_id = chapter.id AND page.kind = 'page' AND page.status IN ('verified','active')
      )
    ) THEN RAISE EXCEPTION 'assets_incomplete' USING ERRCODE = 'P0001'; END IF;
    IF work.type = 'comic' AND EXISTS (
      SELECT 1 FROM public.work_assets AS page WHERE page.work_id = p_work_id AND page.kind = 'page' AND page.status IN ('verified','active')
      GROUP BY page.chapter_id HAVING min(page.page_no) <> 1 OR max(page.page_no) <> count(*) OR count(DISTINCT page.page_no) <> count(*)
    ) THEN RAISE EXCEPTION 'page_sequence_invalid' USING ERRCODE = 'P0001'; END IF;
    IF work.type = 'novel' AND NOT EXISTS (
      SELECT 1 FROM public.work_assets WHERE work_id = p_work_id AND kind = 'cover' AND status IN ('verified','active')
    ) THEN RAISE EXCEPTION 'assets_incomplete' USING ERRCODE = 'P0001'; END IF;
    IF work.type = 'novel' AND NOT EXISTS (SELECT 1 FROM public.work_chapters WHERE work_id = p_work_id) AND
      (SELECT count(*) FROM public.work_assets WHERE work_id = p_work_id AND chapter_id IS NULL AND kind = 'body' AND status IN ('verified','active')) <> 1
    THEN RAISE EXCEPTION 'assets_incomplete' USING ERRCODE = 'P0001'; END IF;
    IF work.type = 'novel' AND EXISTS (SELECT 1 FROM public.work_chapters WHERE work_id = p_work_id) AND EXISTS (
      SELECT 1 FROM public.work_assets WHERE work_id = p_work_id AND chapter_id IS NULL AND kind = 'body' AND status IN ('verified','active')
    ) THEN RAISE EXCEPTION 'assets_incomplete' USING ERRCODE = 'P0001'; END IF;
    IF work.type = 'novel' AND EXISTS (
      SELECT 1 FROM public.work_chapters AS chapter LEFT JOIN public.work_assets AS body
        ON body.chapter_id = chapter.id AND body.kind = 'body' AND body.status IN ('verified','active')
      WHERE chapter.work_id = p_work_id GROUP BY chapter.id HAVING count(body.id) <> 1
    ) THEN RAISE EXCEPTION 'assets_incomplete' USING ERRCODE = 'P0001'; END IF;
    IF work.type IN ('art','resource') AND NOT EXISTS (
      SELECT 1 FROM public.work_assets WHERE work_id = p_work_id AND status IN ('verified','active')
    ) THEN RAISE EXCEPTION 'assets_incomplete' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.work_assets SET status = 'active' WHERE work_id = p_work_id AND status = 'verified';
    UPDATE public.work_chapters SET status = 'published' WHERE work_id = p_work_id AND status IN ('draft','review');
  ELSIF p_target_status = 'archived' THEN
    UPDATE public.work_chapters SET status = 'archived' WHERE work_id = p_work_id AND status = 'published';
  ELSIF p_target_status = 'draft' THEN
    UPDATE public.work_chapters SET status = 'draft' WHERE work_id = p_work_id AND status = 'archived';
  END IF;

  next_version := work.version + 1;
  UPDATE public.works SET status = p_target_status, version = next_version, updated_by = p_actor_id,
    published_at = CASE WHEN p_target_status = 'published' THEN COALESCE(published_at, clock_timestamp()) ELSE published_at END
  WHERE id = p_work_id RETURNING * INTO work;

  snapshot := jsonb_build_object(
    'schemaVersion', 1, 'id', work.id, 'slug', work.slug, 'type', work.type, 'title', work.title,
    'summary', work.summary, 'rating', work.rating, 'status', work.status, 'version', work.version,
    'authorName', work.author_name, 'publishedAt', work.published_at,
    'chapters', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'title', title, 'position', position, 'version', version) ORDER BY position, id) FROM public.work_chapters WHERE work_id = p_work_id), '[]'::jsonb),
    'assets', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'chapterId', chapter_id, 'kind', kind, 'objectKey', object_key, 'accessLevel', access_level, 'mimeType', mime_type, 'sizeBytes', size_bytes, 'checksum', checksum, 'pageNo', page_no, 'status', status) ORDER BY COALESCE(page_no,0), id) FROM public.work_assets WHERE work_id = p_work_id AND status <> 'deleted'), '[]'::jsonb)
  );
  INSERT INTO public.work_versions (work_id, version, snapshot, created_by) VALUES (p_work_id, work.version, snapshot, p_actor_id);
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id, idempotency_key)
  VALUES (p_actor_id, 'work.' || p_action, 'work', p_work_id, jsonb_build_object('id',work.id,'status',work.status,'from', p_expected_status, 'to', p_target_status, 'version', work.version), p_request_id, p_idempotency_key);
  IF work.rating <> 'restricted' AND p_target_status IN ('published','archived') THEN
    INSERT INTO public.snapshot_jobs (snapshot_type, source_version, status) VALUES ('catalog', work.version, 'queued');
  END IF;
  RETURN NEXT work;
END;
$$;

CREATE FUNCTION public.create_work_upload(
  p_upload_id uuid, p_file_id uuid, p_owner_id uuid, p_work_id uuid, p_chapter_id uuid,
  p_object_key text, p_expected_size bigint, p_mime_type text, p_expected_checksum text,
  p_kind text, p_page_no integer, p_access_level text, p_expires_at timestamptz, p_request_id text, p_idempotency_key text, p_request_hash text
)
RETURNS TABLE (upload_id uuid, file_id uuid, object_key text, expires_at timestamptz, state text, asset_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.app_users%ROWTYPE; prior_session public.upload_sessions%ROWTYPE; prior_file public.upload_files%ROWTYPE; created_count integer;
BEGIN
  SELECT * INTO actor FROM public.app_users WHERE id = p_owner_id AND status = 'active' FOR KEY SHARE;
  IF NOT FOUND OR actor.role <> 'admin' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.works WHERE id = p_work_id AND status IN ('draft','review') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'state_conflict' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.works WHERE id=p_work_id AND rating='restricted') AND p_kind IN ('page','body','attachment') AND p_access_level <> 'private'
  THEN RAISE EXCEPTION 'restricted_storage_invalid' USING ERRCODE='P0001'; END IF;
  IF p_chapter_id IS NOT NULL THEN
    PERFORM 1 FROM public.work_chapters WHERE id = p_chapter_id AND work_id = p_work_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'state_conflict' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF p_expires_at <= clock_timestamp() OR p_expires_at > clock_timestamp() + interval '5 minutes 30 seconds'
    OR p_request_hash !~ '^[0-9a-f]{64}$'
    OR p_object_key <> 'staging/admin/' || p_upload_id || '/' || p_file_id || '.' || split_part(p_object_key, '.', -1)
  THEN RAISE EXCEPTION 'upload_invalid' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.upload_sessions (id, owner_id, purpose, status, expires_at, idempotency_key, request_hash)
  VALUES (p_upload_id, p_owner_id, 'work_asset', 'open', p_expires_at, p_idempotency_key, p_request_hash)
  ON CONFLICT (owner_id, purpose, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS created_count = ROW_COUNT;
  SELECT * INTO prior_session FROM public.upload_sessions AS current_session
   WHERE current_session.owner_id = p_owner_id AND current_session.purpose = 'work_asset' AND current_session.idempotency_key = p_idempotency_key FOR UPDATE;
  IF created_count = 0 THEN
    SELECT * INTO prior_file FROM public.upload_files AS current_file WHERE current_file.session_id = prior_session.id FOR UPDATE;
    IF prior_file.chapter_id IS DISTINCT FROM p_chapter_id OR prior_file.expected_size <> p_expected_size OR prior_file.mime_type <> p_mime_type
      OR prior_file.expected_checksum <> p_expected_checksum OR prior_file.kind <> p_kind OR prior_file.page_no IS DISTINCT FROM p_page_no
      OR prior_file.access_level <> p_access_level OR prior_session.request_hash <> p_request_hash
    THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0001'; END IF;
    IF prior_file.status = 'bound' AND prior_file.asset_id IS NOT NULL THEN
      RETURN QUERY SELECT prior_session.id, prior_file.id, prior_file.object_key, prior_session.expires_at, 'bound'::text, prior_file.asset_id; RETURN;
    END IF;
    IF prior_file.status = 'promoting' THEN
      RETURN QUERY SELECT prior_session.id, prior_file.id, NULL::text, prior_session.expires_at, 'promoting'::text, NULL::uuid; RETURN;
    END IF;
    IF prior_file.status <> 'declared' THEN RAISE EXCEPTION 'upload_state_conflict' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.upload_sessions SET expires_at = p_expires_at, status = 'open' WHERE id = prior_session.id;
    RETURN QUERY SELECT prior_session.id, prior_file.id, prior_file.object_key, p_expires_at, 'declared'::text, NULL::uuid; RETURN;
  END IF;
  INSERT INTO public.upload_files (id, session_id, object_key, expected_size, mime_type, expected_checksum, work_id, chapter_id, kind, page_no, access_level, status)
  VALUES (p_file_id, p_upload_id, p_object_key, p_expected_size, p_mime_type, p_expected_checksum, p_work_id, p_chapter_id, p_kind, p_page_no, p_access_level, 'declared');
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id)
  VALUES (p_owner_id, 'upload.create', 'work', p_work_id, jsonb_build_object('uploadId', p_upload_id, 'kind', p_kind), p_request_id);
  RETURN QUERY SELECT p_upload_id, p_file_id, p_object_key, p_expires_at, 'declared'::text, NULL::uuid;
END;
$$;

CREATE FUNCTION public.get_work_upload_for_completion(p_upload_id uuid, p_owner_id uuid)
RETURNS TABLE (
  upload_id uuid, file_id uuid, owner_id uuid, purpose text, work_id uuid, chapter_id uuid,
  object_key text, expected_size bigint, mime_type text, expected_checksum text, kind text,
  page_no integer, access_level text, expires_at timestamptz, status text,
  asset_id uuid, final_object_key text, storage_zone text, promotion_token uuid
)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT session.id, file.id, session.owner_id, session.purpose, file.work_id, file.chapter_id,
    file.object_key, file.expected_size, file.mime_type, file.expected_checksum, file.kind,
    file.page_no, file.access_level, session.expires_at, file.status, file.asset_id, file.final_object_key, file.storage_zone, file.promotion_token
  FROM public.upload_sessions AS session
  JOIN public.upload_files AS file ON file.session_id = session.id
  JOIN public.app_users AS actor ON actor.id = session.owner_id
  WHERE session.id = p_upload_id AND session.owner_id = p_owner_id
    AND actor.status = 'active' AND actor.role = 'admin';
$$;

CREATE FUNCTION public.begin_work_upload_promotion(
  p_upload_id uuid, p_file_id uuid, p_actor_id uuid, p_promotion_token uuid,
  p_object_key text, p_storage_zone text, p_actual_size bigint, p_mime_type text,
  p_checksum text, p_etag text, p_content_disposition text
)
RETURNS TABLE (promotion_token uuid, object_key text, storage_zone text, state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE session public.upload_sessions%ROWTYPE; file public.upload_files%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.app_users WHERE id = p_actor_id AND status = 'active' AND role = 'admin' FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO session FROM public.upload_sessions WHERE id = p_upload_id FOR UPDATE;
  SELECT * INTO file FROM public.upload_files WHERE id = p_file_id AND session_id = p_upload_id FOR UPDATE;
  PERFORM 1 FROM public.works WHERE id = file.work_id FOR UPDATE;
  IF session.owner_id <> p_actor_id OR session.purpose <> 'work_asset' OR NOT FOUND THEN RAISE EXCEPTION 'upload_unavailable' USING ERRCODE = 'P0001'; END IF;
  IF file.status = 'bound' THEN RETURN QUERY SELECT file.promotion_token, file.final_object_key, file.storage_zone, 'bound'::text; RETURN; END IF;
  IF file.status = 'promoting' THEN RETURN QUERY SELECT file.promotion_token, file.final_object_key, file.storage_zone, 'promoting'::text; RETURN; END IF;
  IF file.status <> 'declared' OR session.status <> 'open' OR session.expires_at <= clock_timestamp()
    OR file.expected_size <> p_actual_size OR file.mime_type <> p_mime_type OR file.expected_checksum <> p_checksum
  THEN RAISE EXCEPTION 'upload_not_verified' USING ERRCODE = 'P0001'; END IF;
  IF (p_storage_zone = 'public' AND (file.access_level <> 'public' OR p_object_key NOT LIKE 'media/works/%'))
    OR (p_storage_zone = 'private' AND (file.access_level <> 'private' OR p_object_key NOT LIKE 'protected/works/%'))
  THEN RAISE EXCEPTION 'storage_zone_invalid' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.works AS work WHERE work.id = file.work_id AND work.rating = 'restricted')
    AND file.kind IN ('page','body','attachment') AND p_storage_zone <> 'private'
  THEN RAISE EXCEPTION 'asset_policy_invalid' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.upload_files SET status = 'promoting', promotion_token = p_promotion_token, promotion_started_at = clock_timestamp(),
    final_object_key = p_object_key, storage_zone = p_storage_zone, actual_size = p_actual_size,
    checksum = p_checksum, etag = p_etag, scan_status = 'basic_format_only', content_disposition = p_content_disposition
  WHERE id = p_file_id RETURNING * INTO file;
  RETURN QUERY SELECT file.promotion_token, file.final_object_key, file.storage_zone, 'promoting'::text;
END;
$$;

CREATE FUNCTION public.complete_work_upload(
  p_upload_id uuid, p_file_id uuid, p_actor_id uuid, p_work_id uuid, p_chapter_id uuid,
  p_promotion_token uuid, p_object_key text, p_storage_zone text, p_actual_size bigint, p_mime_type text, p_checksum text, p_etag text,
  p_kind text, p_page_no integer, p_access_level text, p_request_id text
)
RETURNS TABLE (asset_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.app_users%ROWTYPE; session public.upload_sessions%ROWTYPE; file public.upload_files%ROWTYPE; created_id uuid;
BEGIN
  SELECT * INTO actor FROM public.app_users WHERE id = p_actor_id AND status = 'active' FOR KEY SHARE;
  IF NOT FOUND OR actor.role <> 'admin' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO session FROM public.upload_sessions WHERE id = p_upload_id FOR UPDATE;
  IF NOT FOUND OR session.owner_id <> p_actor_id OR session.purpose <> 'work_asset'
  THEN RAISE EXCEPTION 'upload_unavailable' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO file FROM public.upload_files WHERE id = p_file_id AND session_id = p_upload_id FOR UPDATE;
  IF FOUND AND file.status = 'bound' AND file.asset_id IS NOT NULL AND file.promotion_token = p_promotion_token THEN
    RETURN QUERY SELECT file.asset_id, 'verified'::text; RETURN;
  END IF;
  IF NOT FOUND OR file.status <> 'promoting' OR file.promotion_token <> p_promotion_token OR file.work_id <> p_work_id
    OR file.chapter_id IS DISTINCT FROM p_chapter_id OR file.final_object_key <> p_object_key OR file.storage_zone <> p_storage_zone
    OR file.expected_size <> p_actual_size OR file.mime_type <> p_mime_type
    OR file.expected_checksum <> p_checksum OR file.kind <> p_kind
    OR file.page_no IS DISTINCT FROM p_page_no OR file.access_level <> p_access_level
  THEN RAISE EXCEPTION 'upload_not_verified' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.works WHERE id = p_work_id AND status IN ('draft','review') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'state_conflict' USING ERRCODE = 'P0001'; END IF;
  IF p_chapter_id IS NOT NULL THEN
    PERFORM 1 FROM public.work_chapters WHERE id = p_chapter_id AND work_id = p_work_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'state_conflict' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF (p_storage_zone = 'public' AND (p_access_level <> 'public' OR p_object_key NOT LIKE 'media/works/%'))
    OR (p_storage_zone = 'private' AND (p_access_level <> 'private' OR p_object_key NOT LIKE 'protected/works/%'))
  THEN RAISE EXCEPTION 'storage_zone_invalid' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.works WHERE id=p_work_id AND rating='restricted') AND p_kind IN ('page','body','attachment') AND (p_access_level <> 'private' OR p_storage_zone <> 'private')
  THEN RAISE EXCEPTION 'restricted_storage_invalid' USING ERRCODE='P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.work_assets a WHERE a.work_id=p_work_id AND a.chapter_id IS NOT DISTINCT FROM p_chapter_id AND a.status <> 'deleted' AND (
    (p_kind IN ('cover','body') AND a.kind=p_kind) OR (p_kind='page' AND a.kind='page' AND a.page_no=p_page_no)
  )) THEN RAISE EXCEPTION 'slot_conflict' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.work_assets (work_id, chapter_id, kind, object_key, storage_zone, access_level, mime_type, size_bytes, checksum, page_no, status)
  VALUES (p_work_id, p_chapter_id, p_kind, p_object_key, p_storage_zone, p_access_level, p_mime_type, p_actual_size, p_checksum, p_page_no, 'verified')
  RETURNING id INTO created_id;
  UPDATE public.upload_files SET actual_size = p_actual_size, checksum = p_checksum, etag = p_etag,
    asset_id = created_id, final_object_key = p_object_key, storage_zone = p_storage_zone, status = 'bound' WHERE id = p_file_id;
  UPDATE public.upload_sessions SET status = 'completed' WHERE id = p_upload_id;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id)
  VALUES (p_actor_id, 'upload.bind', 'work', p_work_id, jsonb_build_object('uploadId', p_upload_id, 'assetId', created_id), p_request_id);
  RETURN QUERY SELECT created_id, 'verified'::text;
END;
$$;

CREATE FUNCTION public.begin_snapshot_build(p_snapshot_type text, p_actor_id uuid, p_request_id text, p_idempotency_key text)
RETURNS TABLE (job_id uuid, version bigint, state text, object_key text, checksum text, lease_token uuid, lease_epoch bigint, generated_at timestamptz, source_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.app_users%ROWTYPE; job public.snapshot_jobs%ROWTYPE; next_version bigint; immutable public.snapshot_versions%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.app_users WHERE id = p_actor_id AND status = 'active' FOR KEY SHARE;
  IF NOT FOUND OR actor.role <> 'admin' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF p_snapshot_type NOT IN ('catalog','tags','config') THEN RAISE EXCEPTION 'snapshot_type_invalid' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('snapshot:' || p_snapshot_type));
  SELECT snapshot_job.* INTO job FROM public.audit_logs AS audit
    JOIN public.snapshot_jobs AS snapshot_job ON snapshot_job.id = audit.target_id
   WHERE audit.actor_id = p_actor_id AND audit.action = 'snapshot.request' AND audit.idempotency_key = p_idempotency_key;
  IF FOUND AND (job.status = 'succeeded' OR (job.status = 'prepared' AND job.lease_expires_at > clock_timestamp())) THEN
    SELECT * INTO immutable FROM public.snapshot_versions WHERE snapshot_job_id = job.id;
    RETURN QUERY SELECT job.id, job.delivery_version, job.status, immutable.object_key, immutable.checksum, job.lease_token, job.lease_epoch, job.build_generated_at, job.source_version; RETURN;
  ELSIF FOUND AND job.status = 'running' AND job.lease_expires_at > clock_timestamp() THEN
    RAISE EXCEPTION 'snapshot_busy' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO job FROM public.snapshot_jobs
   WHERE snapshot_type = p_snapshot_type AND status IN ('running','prepared')
   ORDER BY created_at, id LIMIT 1 FOR UPDATE;
  IF FOUND AND job.lease_expires_at > clock_timestamp() THEN
    RAISE EXCEPTION 'snapshot_busy' USING ERRCODE = 'P0001';
  END IF;
  IF NOT FOUND THEN
    SELECT * INTO job FROM public.snapshot_jobs
     WHERE snapshot_type = p_snapshot_type AND status IN ('queued','failed')
     ORDER BY created_at, id LIMIT 1 FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    INSERT INTO public.snapshot_jobs (snapshot_type, source_version, status, attempts)
    VALUES (p_snapshot_type, GREATEST(COALESCE((SELECT max(work.version) FROM public.works AS work), 1), 1), 'queued', 0)
    RETURNING * INTO job;
  END IF;
  IF job.delivery_version IS NULL THEN
    SELECT COALESCE(MAX(candidate), 0) + 1 INTO next_version FROM (
      SELECT snapshot_version.version AS candidate FROM public.snapshot_versions AS snapshot_version WHERE snapshot_version.snapshot_type = p_snapshot_type
      UNION ALL SELECT snapshot_job.delivery_version FROM public.snapshot_jobs AS snapshot_job WHERE snapshot_job.snapshot_type = p_snapshot_type AND snapshot_job.delivery_version IS NOT NULL
    ) versions;
  ELSE next_version := job.delivery_version; END IF;
  UPDATE public.snapshot_jobs SET delivery_version = next_version, build_generated_at = COALESCE(build_generated_at, clock_timestamp()),
    status = CASE WHEN job.status = 'prepared' THEN 'prepared' ELSE 'running' END,
    attempts = attempts + 1, lease_expires_at = clock_timestamp() + interval '2 minutes', lease_token = gen_random_uuid(), lease_epoch = lease_epoch + 1, last_error = NULL
  WHERE id = job.id RETURNING * INTO job;
  IF job.status = 'prepared' THEN SELECT * INTO immutable FROM public.snapshot_versions WHERE snapshot_job_id = job.id; END IF;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id, idempotency_key)
  VALUES (p_actor_id, 'snapshot.request', 'snapshot_job', job.id, jsonb_build_object('type', p_snapshot_type, 'version', next_version, 'attempt', job.attempts), p_request_id, p_idempotency_key)
  ON CONFLICT (actor_id, action, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  RETURN QUERY SELECT job.id, next_version, job.status, immutable.object_key, immutable.checksum, job.lease_token, job.lease_epoch, job.build_generated_at, job.source_version;
END;
$$;

CREATE FUNCTION public.list_public_catalog()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('items', COALESCE(jsonb_agg(item ORDER BY item->>'slug'), '[]'::jsonb))
  FROM (
    SELECT jsonb_build_object(
      'slug', work.slug, 'type', work.type, 'title', work.title, 'summary', work.summary,
      'rating', work.rating, 'publishedAt', work.published_at,
      'chapters', COALESCE((SELECT jsonb_agg(jsonb_build_object('title', chapter.title, 'position', chapter.position) ORDER BY chapter.position, chapter.id)
        FROM public.work_chapters AS chapter WHERE chapter.work_id = work.id AND chapter.status = 'published'), '[]'::jsonb),
      'assets', COALESCE((SELECT jsonb_agg(jsonb_build_object('chapterPosition', chapter.position, 'kind', asset.kind, 'objectKey', asset.object_key, 'storageZone', asset.storage_zone, 'accessLevel', asset.access_level, 'pageNo', asset.page_no) ORDER BY COALESCE(chapter.position,0), COALESCE(asset.page_no,0), asset.id)
        FROM public.work_assets AS asset LEFT JOIN public.work_chapters AS chapter ON chapter.id = asset.chapter_id
        WHERE asset.work_id = work.id AND asset.status = 'active' AND asset.access_level = 'public' AND asset.storage_zone = 'public'), '[]'::jsonb)
    ) AS item
    FROM public.works AS work
    WHERE work.status = 'published' AND work.rating <> 'restricted'
  ) visible;
$$;

CREATE FUNCTION public.prepare_snapshot_version(p_job_id uuid, p_lease_token uuid, p_snapshot_type text, p_version bigint, p_object_key text, p_checksum text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE job public.snapshot_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.snapshot_jobs WHERE id = p_job_id FOR UPDATE;
  IF FOUND AND job.status = 'succeeded' AND job.lease_token = p_lease_token THEN RETURN true; END IF;
  IF NOT FOUND OR job.status <> 'running' OR job.lease_token <> p_lease_token OR job.snapshot_type <> p_snapshot_type OR job.delivery_version <> p_version OR job.lease_expires_at <= clock_timestamp()
    OR p_checksum !~ '^[0-9a-f]{64}$' OR p_object_key <> 'snapshots/public/' || p_snapshot_type || '.v' || p_version || '.json'
  THEN RAISE EXCEPTION 'snapshot_conflict' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.snapshot_versions (snapshot_job_id, snapshot_type, version, object_key, checksum)
  VALUES (p_job_id, p_snapshot_type, p_version, p_object_key, p_checksum)
  ON CONFLICT (snapshot_type, version) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.snapshot_versions WHERE snapshot_job_id = p_job_id AND snapshot_type = p_snapshot_type AND version = p_version AND object_key = p_object_key AND checksum = p_checksum)
  THEN RAISE EXCEPTION 'snapshot_conflict' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.snapshot_jobs SET status = 'prepared', lease_expires_at = clock_timestamp() + interval '2 minutes' WHERE id = p_job_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.complete_snapshot_build(p_job_id uuid, p_lease_token uuid, p_actor_id uuid, p_request_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.app_users%ROWTYPE; job public.snapshot_jobs%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.app_users WHERE id = p_actor_id AND status = 'active' FOR KEY SHARE;
  IF NOT FOUND OR actor.role <> 'admin' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO job FROM public.snapshot_jobs WHERE id = p_job_id FOR UPDATE;
  IF FOUND AND job.status = 'succeeded' AND job.lease_token = p_lease_token THEN RETURN true; END IF;
  IF NOT FOUND OR job.status <> 'prepared' OR job.lease_token <> p_lease_token OR NOT EXISTS (SELECT 1 FROM public.snapshot_versions WHERE snapshot_job_id = p_job_id)
  THEN RAISE EXCEPTION 'snapshot_conflict' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.snapshot_current WHERE snapshot_type=job.snapshot_type AND version > job.delivery_version)
  THEN RAISE EXCEPTION 'snapshot_conflict' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.snapshot_current(snapshot_type,version,object_key,checksum,updated_at)
  SELECT job.snapshot_type,v.version,v.object_key,v.checksum,clock_timestamp() FROM public.snapshot_versions v WHERE v.snapshot_job_id=p_job_id
  ON CONFLICT(snapshot_type) DO UPDATE SET version=EXCLUDED.version, object_key=EXCLUDED.object_key, checksum=EXCLUDED.checksum, updated_at=EXCLUDED.updated_at
  WHERE public.snapshot_current.version <= EXCLUDED.version;
  UPDATE public.snapshot_jobs SET status = 'succeeded', last_error = NULL, lease_expires_at = NULL WHERE id = p_job_id;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id)
  VALUES (p_actor_id, 'snapshot.complete', 'snapshot_job', p_job_id, jsonb_build_object('type', job.snapshot_type, 'version', job.delivery_version), p_request_id);
  RETURN true;
END;
$$;

CREATE FUNCTION public.get_current_snapshot(p_snapshot_type text)
RETURNS TABLE(version bigint, object_key text, checksum text, updated_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT c.version,c.object_key,c.checksum,c.updated_at FROM public.snapshot_current c WHERE c.snapshot_type=p_snapshot_type;
$$;

CREATE FUNCTION public.fail_snapshot_build(p_job_id uuid, p_lease_token uuid, p_error text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.snapshot_jobs SET
    status = CASE WHEN status = 'prepared' THEN 'prepared' ELSE 'failed' END,
    lease_expires_at = clock_timestamp() - interval '1 second',
    last_error = left(COALESCE(p_error, 'snapshot failed'), 500)
  WHERE id = p_job_id AND lease_token = p_lease_token AND status IN ('queued','running','prepared');
  IF NOT FOUND THEN RAISE EXCEPTION 'snapshot_conflict' USING ERRCODE = 'P0001'; END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION public.claim_stale_upload_promotions(p_actor_id uuid, p_limit integer)
RETURNS TABLE(upload_id uuid,file_id uuid,staging_key text,final_key text,storage_zone text,cleanup_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM 1 FROM public.app_users WHERE id=p_actor_id AND status='active' AND role='admin' FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  RETURN QUERY WITH claimed AS (
    SELECT f.id FROM public.upload_files f WHERE f.status IN ('promoting','cleanup_pending')
      AND f.promotion_started_at < clock_timestamp()-interval '30 minutes'
    ORDER BY f.promotion_started_at,f.id LIMIT LEAST(GREATEST(p_limit,1),100) FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE public.upload_files f SET status='cleanup_pending',cleanup_token=gen_random_uuid()
    FROM claimed c WHERE f.id=c.id AND f.status IN ('promoting','cleanup_pending')
    RETURNING f.*
  ) SELECT u.session_id,u.id,u.object_key,u.final_object_key,u.storage_zone,u.cleanup_token FROM updated u;
END;
$$;

CREATE FUNCTION public.finalize_upload_promotion_cleanup(p_file_id uuid,p_cleanup_token uuid,p_actor_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM 1 FROM public.app_users WHERE id=p_actor_id AND status='active' AND role='admin' FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  UPDATE public.upload_files SET status='orphaned',cleanup_token=NULL WHERE id=p_file_id AND status='cleanup_pending' AND cleanup_token=p_cleanup_token AND asset_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'upload_state_conflict' USING ERRCODE='P0001'; END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION public.get_admin_work(p_work_id uuid)
RETURNS TABLE (id uuid, slug text, type text, title text, summary text, rating text, status text, version bigint, author_name text, published_at timestamptz, created_at timestamptz, updated_at timestamptz, chapters jsonb, assets jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT work.id, work.slug, work.type, work.title, work.summary, work.rating, work.status, work.version, work.author_name,
    work.published_at, work.created_at, work.updated_at,
    COALESCE((SELECT jsonb_agg(to_jsonb(chapter) - 'created_by' - 'updated_by' ORDER BY chapter.position, chapter.id) FROM public.work_chapters AS chapter WHERE chapter.work_id = work.id), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(to_jsonb(asset) ORDER BY COALESCE(asset.page_no,0), asset.id) FROM public.work_assets AS asset WHERE asset.work_id = work.id AND asset.status <> 'deleted'), '[]'::jsonb)
  FROM public.works AS work WHERE work.id = p_work_id;
$$;

CREATE FUNCTION public.get_public_work(p_slug text)
RETURNS TABLE (slug text, type text, title text, summary text, rating text, author_name text, published_at timestamptz, chapters jsonb, assets jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT work.slug, work.type, work.title, work.summary, work.rating, work.author_name, work.published_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('title', chapter.title, 'position', chapter.position) ORDER BY chapter.position) FROM public.work_chapters AS chapter WHERE chapter.work_id = work.id AND chapter.status = 'published'), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('chapter_position', chapter.position, 'kind', asset.kind, 'object_key', asset.object_key, 'page_no', asset.page_no) ORDER BY COALESCE(chapter.position,0), COALESCE(asset.page_no,0), asset.id)
      FROM public.work_assets AS asset LEFT JOIN public.work_chapters AS chapter ON chapter.id = asset.chapter_id
      WHERE asset.work_id = work.id AND asset.status = 'active' AND asset.access_level = 'public' AND asset.storage_zone = 'public'), '[]'::jsonb)
  FROM public.works AS work WHERE work.slug = p_slug AND work.status = 'published' AND work.rating <> 'restricted';
$$;

CREATE FUNCTION public.list_admin_works(p_limit integer, p_cursor text, p_status text)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.updated_at DESC, page.id DESC), '[]'::jsonb),
    'next_cursor', CASE WHEN count(*) = p_limit THEN min(page.updated_at)::text || '|' || (array_agg(page.id ORDER BY page.updated_at ASC, page.id ASC))[1]::text ELSE NULL END
  ) FROM (
    SELECT work.* FROM public.works AS work
    WHERE (p_status IS NULL OR work.status = p_status)
      AND (p_cursor IS NULL OR (work.updated_at, work.id) < (split_part(p_cursor, '|', 1)::timestamptz, split_part(p_cursor, '|', 2)::uuid))
    ORDER BY work.updated_at DESC, work.id DESC LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ) page;
$$;

REVOKE EXECUTE ON FUNCTION public.create_work_draft(text,text,text,text,text,text,uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_work_draft(uuid,bigint,jsonb,jsonb,uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_work_state(uuid,bigint,text,text,text,uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_work_upload(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,integer,text,timestamptz,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_work_upload_for_completion(uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.begin_work_upload_promotion(uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_work_upload(uuid,uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,text,integer,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.begin_snapshot_build(text,uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_public_catalog() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prepare_snapshot_version(uuid,uuid,text,bigint,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_snapshot_build(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fail_snapshot_build(uuid,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_current_snapshot(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_stale_upload_promotions(uuid,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_upload_promotion_cleanup(uuid,uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_work(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_public_work(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_admin_works(integer,text,text) FROM PUBLIC;
REVOKE ALL ON TABLE public.work_chapters FROM PUBLIC;
REVOKE ALL ON TABLE public.snapshot_current FROM PUBLIC;

COMMIT;
