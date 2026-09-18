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
  ADD COLUMN chapter_id uuid REFERENCES public.work_chapters(id) ON DELETE RESTRICT;
ALTER TABLE public.work_assets DROP CONSTRAINT work_assets_work_id_kind_page_no_key;
CREATE UNIQUE INDEX work_assets_work_root_slot_key
  ON public.work_assets (work_id, kind, page_no) WHERE chapter_id IS NULL;
CREATE UNIQUE INDEX work_assets_chapter_slot_key
  ON public.work_assets (chapter_id, kind, page_no) WHERE chapter_id IS NOT NULL;
CREATE INDEX work_assets_chapter_idx ON public.work_assets (chapter_id, status, kind, page_no);

ALTER TABLE public.upload_files
  ADD COLUMN work_id uuid REFERENCES public.works(id) ON DELETE RESTRICT,
  ADD COLUMN chapter_id uuid REFERENCES public.work_chapters(id) ON DELETE RESTRICT,
  ADD COLUMN expected_checksum text,
  ADD COLUMN kind text CHECK (kind IN ('cover', 'page', 'body', 'attachment', 'preview')),
  ADD COLUMN page_no integer CHECK (page_no IS NULL OR page_no > 0),
  ADD COLUMN access_level text CHECK (access_level IN ('public', 'private')),
  ADD COLUMN etag text,
  ADD CONSTRAINT upload_files_expected_checksum_format CHECK (expected_checksum IS NULL OR expected_checksum ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT upload_files_work_shape CHECK (
    (work_id IS NULL AND kind IS NULL AND access_level IS NULL)
    OR (work_id IS NOT NULL AND kind IS NOT NULL AND access_level IS NOT NULL)
  ),
  ADD CONSTRAINT upload_files_page_shape CHECK (kind IS DISTINCT FROM 'page' OR page_no IS NOT NULL);
CREATE INDEX upload_files_work_idx ON public.upload_files (work_id, status);
CREATE INDEX upload_files_chapter_idx ON public.upload_files (chapter_id, status);

ALTER TABLE public.snapshot_jobs DROP CONSTRAINT snapshot_jobs_status_check;
ALTER TABLE public.snapshot_jobs ADD CONSTRAINT snapshot_jobs_status_check
  CHECK (status IN ('queued', 'running', 'prepared', 'succeeded', 'failed', 'cancelled'));

CREATE FUNCTION public.create_work_draft(
  p_slug text, p_type text, p_title text, p_summary text, p_rating text,
  p_author_name text, p_actor_id uuid, p_request_id text
)
RETURNS SETOF public.works
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.app_users%ROWTYPE; created public.works%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.app_users WHERE id = p_actor_id AND status = 'active' FOR KEY SHARE;
  IF NOT FOUND OR actor.role <> 'admin' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  BEGIN
    INSERT INTO public.works (slug, type, title, summary, rating, status, author_name, created_by, updated_by)
    VALUES (p_slug, p_type, btrim(p_title), btrim(p_summary), p_rating, 'draft', btrim(p_author_name), p_actor_id, p_actor_id)
    RETURNING * INTO created;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'slug_conflict' USING ERRCODE = 'P0001'; END;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id)
  VALUES (p_actor_id, 'work.create', 'work', created.id, jsonb_build_object('version', created.version), p_request_id);
  RETURN NEXT created;
END;
$$;

CREATE FUNCTION public.update_work_draft(
  p_work_id uuid, p_expected_version bigint, p_changes jsonb, p_chapters jsonb,
  p_actor_id uuid, p_request_id text
)
RETURNS SETOF public.works
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.app_users%ROWTYPE; work public.works%ROWTYPE; chapter jsonb; chapter_id uuid; updated_count integer;
BEGIN
  SELECT * INTO actor FROM public.app_users WHERE id = p_actor_id AND status = 'active' FOR KEY SHARE;
  IF NOT FOUND OR actor.role <> 'admin' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO work FROM public.works WHERE id = p_work_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001'; END IF;
  IF work.version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'P0001'; END IF;
  IF work.status NOT IN ('draft', 'review') THEN RAISE EXCEPTION 'state_conflict' USING ERRCODE = 'P0001'; END IF;

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
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id)
  VALUES (p_actor_id, 'work.update', 'work', p_work_id, jsonb_build_object('version', work.version, 'fields', (SELECT jsonb_agg(keys.key ORDER BY keys.key) FROM jsonb_object_keys(p_changes) AS keys(key))), p_request_id);
  RETURN NEXT work;
END;
$$;

CREATE FUNCTION public.transition_work_state(
  p_work_id uuid, p_expected_version bigint, p_expected_status text, p_target_status text,
  p_action text, p_actor_id uuid, p_request_id text
)
RETURNS SETOF public.works
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.app_users%ROWTYPE; work public.works%ROWTYPE; asset public.work_assets%ROWTYPE; next_version bigint; snapshot jsonb;
BEGIN
  SELECT * INTO actor FROM public.app_users WHERE id = p_actor_id AND status = 'active' FOR KEY SHARE;
  IF NOT FOUND OR actor.role <> 'admin' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
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
    FOR asset IN SELECT * FROM public.work_assets WHERE work_id = p_work_id FOR UPDATE LOOP
      IF asset.status <> 'verified' AND asset.status <> 'active' THEN RAISE EXCEPTION 'assets_incomplete' USING ERRCODE = 'P0001'; END IF;
    END LOOP;
    IF work.type = 'comic' AND (
      NOT EXISTS (SELECT 1 FROM public.work_assets WHERE work_id = p_work_id AND kind = 'cover' AND status IN ('verified','active')) OR
      NOT EXISTS (SELECT 1 FROM public.work_assets WHERE work_id = p_work_id AND kind = 'page' AND status IN ('verified','active'))
    ) THEN RAISE EXCEPTION 'assets_incomplete' USING ERRCODE = 'P0001'; END IF;
    IF work.type = 'novel' AND (
      NOT EXISTS (SELECT 1 FROM public.work_assets WHERE work_id = p_work_id AND kind = 'cover' AND status IN ('verified','active')) OR
      NOT EXISTS (SELECT 1 FROM public.work_assets WHERE work_id = p_work_id AND kind = 'body' AND status IN ('verified','active'))
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
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id)
  VALUES (p_actor_id, 'work.' || p_action, 'work', p_work_id, jsonb_build_object('from', p_expected_status, 'to', p_target_status, 'version', work.version), p_request_id);
  IF work.rating <> 'restricted' AND p_target_status IN ('published','archived') THEN
    INSERT INTO public.snapshot_jobs (snapshot_type, source_version, status) VALUES ('catalog', work.version, 'queued');
  END IF;
  RETURN NEXT work;
END;
$$;

CREATE FUNCTION public.create_work_upload(
  p_upload_id uuid, p_file_id uuid, p_owner_id uuid, p_work_id uuid, p_chapter_id uuid,
  p_object_key text, p_expected_size bigint, p_mime_type text, p_expected_checksum text,
  p_kind text, p_page_no integer, p_access_level text, p_expires_at timestamptz, p_request_id text
)
RETURNS TABLE (upload_id uuid, file_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.app_users%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.app_users WHERE id = p_owner_id AND status = 'active' FOR KEY SHARE;
  IF NOT FOUND OR actor.role <> 'admin' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.works WHERE id = p_work_id AND status IN ('draft','review') FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'state_conflict' USING ERRCODE = 'P0001'; END IF;
  IF p_chapter_id IS NOT NULL THEN
    PERFORM 1 FROM public.work_chapters WHERE id = p_chapter_id AND work_id = p_work_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'state_conflict' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF p_expires_at <= clock_timestamp() OR p_expires_at > clock_timestamp() + interval '5 minutes 30 seconds'
    OR p_object_key <> 'staging/admin/' || p_upload_id || '/' || p_file_id || '.' || split_part(p_object_key, '.', -1)
  THEN RAISE EXCEPTION 'upload_invalid' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.upload_sessions (id, owner_id, purpose, status, expires_at)
  VALUES (p_upload_id, p_owner_id, 'work_asset', 'open', p_expires_at);
  INSERT INTO public.upload_files (id, session_id, object_key, expected_size, mime_type, expected_checksum, work_id, chapter_id, kind, page_no, access_level, status)
  VALUES (p_file_id, p_upload_id, p_object_key, p_expected_size, p_mime_type, p_expected_checksum, p_work_id, p_chapter_id, p_kind, p_page_no, p_access_level, 'declared');
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id)
  VALUES (p_owner_id, 'upload.create', 'work', p_work_id, jsonb_build_object('uploadId', p_upload_id, 'kind', p_kind), p_request_id);
  RETURN QUERY SELECT p_upload_id, p_file_id;
END;
$$;

CREATE FUNCTION public.get_work_upload_for_completion(p_upload_id uuid, p_owner_id uuid)
RETURNS TABLE (
  upload_id uuid, file_id uuid, owner_id uuid, purpose text, work_id uuid, chapter_id uuid,
  object_key text, expected_size bigint, mime_type text, expected_checksum text, kind text,
  page_no integer, access_level text, expires_at timestamptz, status text
)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT session.id, file.id, session.owner_id, session.purpose, file.work_id, file.chapter_id,
    file.object_key, file.expected_size, file.mime_type, file.expected_checksum, file.kind,
    file.page_no, file.access_level, session.expires_at, file.status
  FROM public.upload_sessions AS session
  JOIN public.upload_files AS file ON file.session_id = session.id
  JOIN public.app_users AS actor ON actor.id = session.owner_id
  WHERE session.id = p_upload_id AND session.owner_id = p_owner_id
    AND actor.status = 'active' AND actor.role = 'admin';
$$;

CREATE FUNCTION public.complete_work_upload(
  p_upload_id uuid, p_file_id uuid, p_actor_id uuid, p_work_id uuid, p_chapter_id uuid,
  p_object_key text, p_actual_size bigint, p_mime_type text, p_checksum text, p_etag text,
  p_kind text, p_page_no integer, p_access_level text, p_request_id text
)
RETURNS TABLE (asset_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.app_users%ROWTYPE; session public.upload_sessions%ROWTYPE; file public.upload_files%ROWTYPE; created_id uuid;
BEGIN
  SELECT * INTO actor FROM public.app_users WHERE id = p_actor_id AND status = 'active' FOR KEY SHARE;
  IF NOT FOUND OR actor.role <> 'admin' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO session FROM public.upload_sessions WHERE id = p_upload_id FOR UPDATE;
  IF NOT FOUND OR session.owner_id <> p_actor_id OR session.purpose <> 'work_asset' OR session.status <> 'open' OR session.expires_at <= clock_timestamp()
  THEN RAISE EXCEPTION 'upload_unavailable' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO file FROM public.upload_files WHERE id = p_file_id AND session_id = p_upload_id FOR UPDATE;
  IF NOT FOUND OR file.status <> 'declared' OR file.work_id <> p_work_id
    OR file.chapter_id IS DISTINCT FROM p_chapter_id OR file.object_key <> p_object_key
    OR file.expected_size <> p_actual_size OR file.mime_type <> p_mime_type
    OR file.expected_checksum <> p_checksum OR file.kind <> p_kind
    OR file.page_no IS DISTINCT FROM p_page_no OR file.access_level <> p_access_level
  THEN RAISE EXCEPTION 'upload_not_verified' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.works WHERE id = p_work_id AND status IN ('draft','review') FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'state_conflict' USING ERRCODE = 'P0001'; END IF;
  IF p_chapter_id IS NOT NULL THEN
    PERFORM 1 FROM public.work_chapters WHERE id = p_chapter_id AND work_id = p_work_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'state_conflict' USING ERRCODE = 'P0001'; END IF;
  END IF;
  INSERT INTO public.work_assets (work_id, chapter_id, kind, object_key, access_level, mime_type, size_bytes, checksum, page_no, status)
  VALUES (p_work_id, p_chapter_id, p_kind, p_object_key, p_access_level, p_mime_type, p_actual_size, p_checksum, p_page_no, 'verified')
  RETURNING id INTO created_id;
  UPDATE public.upload_files SET actual_size = p_actual_size, checksum = p_checksum, etag = p_etag, status = 'bound' WHERE id = p_file_id;
  UPDATE public.upload_sessions SET status = 'completed' WHERE id = p_upload_id;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id)
  VALUES (p_actor_id, 'upload.bind', 'work', p_work_id, jsonb_build_object('uploadId', p_upload_id, 'assetId', created_id), p_request_id);
  RETURN QUERY SELECT created_id, 'verified'::text;
END;
$$;

CREATE FUNCTION public.begin_snapshot_build(p_snapshot_type text, p_actor_id uuid, p_request_id text)
RETURNS TABLE (job_id uuid, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.app_users%ROWTYPE; next_version bigint; created_id uuid;
BEGIN
  SELECT * INTO actor FROM public.app_users WHERE id = p_actor_id AND status = 'active' FOR KEY SHARE;
  IF NOT FOUND OR actor.role <> 'admin' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF p_snapshot_type NOT IN ('catalog','tags','config') THEN RAISE EXCEPTION 'snapshot_type_invalid' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('snapshot:' || p_snapshot_type));
  SELECT COALESCE(MAX(candidate), 0) + 1 INTO next_version FROM (
    SELECT snapshot_version.version AS candidate FROM public.snapshot_versions AS snapshot_version WHERE snapshot_version.snapshot_type = p_snapshot_type
    UNION ALL SELECT snapshot_job.source_version FROM public.snapshot_jobs AS snapshot_job WHERE snapshot_job.snapshot_type = p_snapshot_type
  ) versions;
  INSERT INTO public.snapshot_jobs (snapshot_type, source_version, status, attempts)
  VALUES (p_snapshot_type, next_version, 'running', 1) RETURNING id INTO created_id;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id)
  VALUES (p_actor_id, 'snapshot.begin', 'snapshot_job', created_id, jsonb_build_object('type', p_snapshot_type, 'version', next_version), p_request_id);
  RETURN QUERY SELECT created_id, next_version;
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
      'assets', COALESCE((SELECT jsonb_agg(jsonb_build_object('chapterPosition', chapter.position, 'kind', asset.kind, 'objectKey', asset.object_key, 'accessLevel', asset.access_level, 'pageNo', asset.page_no) ORDER BY COALESCE(chapter.position,0), COALESCE(asset.page_no,0), asset.id)
        FROM public.work_assets AS asset LEFT JOIN public.work_chapters AS chapter ON chapter.id = asset.chapter_id
        WHERE asset.work_id = work.id AND asset.status = 'active' AND asset.access_level = 'public'), '[]'::jsonb)
    ) AS item
    FROM public.works AS work
    WHERE work.status = 'published' AND work.rating <> 'restricted'
  ) visible;
$$;

CREATE FUNCTION public.prepare_snapshot_version(p_job_id uuid, p_snapshot_type text, p_version bigint, p_object_key text, p_checksum text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE job public.snapshot_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.snapshot_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR job.status <> 'running' OR job.snapshot_type <> p_snapshot_type OR job.source_version <> p_version
    OR p_checksum !~ '^[0-9a-f]{64}$' OR p_object_key <> 'snapshots/public/' || p_snapshot_type || '.v' || p_version || '.json'
  THEN RAISE EXCEPTION 'snapshot_conflict' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.snapshot_versions (snapshot_job_id, snapshot_type, version, object_key, checksum)
  VALUES (p_job_id, p_snapshot_type, p_version, p_object_key, p_checksum);
  UPDATE public.snapshot_jobs SET status = 'prepared' WHERE id = p_job_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.complete_snapshot_build(p_job_id uuid, p_actor_id uuid, p_request_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.app_users%ROWTYPE; job public.snapshot_jobs%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.app_users WHERE id = p_actor_id AND status = 'active' FOR KEY SHARE;
  IF NOT FOUND OR actor.role <> 'admin' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO job FROM public.snapshot_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR job.status <> 'prepared' OR NOT EXISTS (SELECT 1 FROM public.snapshot_versions WHERE snapshot_job_id = p_job_id)
  THEN RAISE EXCEPTION 'snapshot_conflict' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.snapshot_jobs SET status = 'succeeded', last_error = NULL WHERE id = p_job_id;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id)
  VALUES (p_actor_id, 'snapshot.complete', 'snapshot_job', p_job_id, jsonb_build_object('type', job.snapshot_type, 'version', job.source_version), p_request_id);
  RETURN true;
END;
$$;

CREATE FUNCTION public.fail_snapshot_build(p_job_id uuid, p_error text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.snapshot_jobs SET status = 'failed', last_error = left(COALESCE(p_error, 'snapshot failed'), 500)
  WHERE id = p_job_id AND status IN ('queued','running','prepared','succeeded');
  RETURN FOUND;
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
      WHERE asset.work_id = work.id AND asset.status = 'active' AND asset.access_level = 'public'), '[]'::jsonb)
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

REVOKE EXECUTE ON FUNCTION public.create_work_draft(text,text,text,text,text,text,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_work_draft(uuid,bigint,jsonb,jsonb,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_work_state(uuid,bigint,text,text,text,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_work_upload(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,integer,text,timestamptz,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_work_upload_for_completion(uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_work_upload(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,text,integer,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.begin_snapshot_build(text,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_public_catalog() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prepare_snapshot_version(uuid,text,bigint,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_snapshot_build(uuid,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fail_snapshot_build(uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_work(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_public_work(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_admin_works(integer,text,text) FROM PUBLIC;
REVOKE ALL ON TABLE public.work_chapters FROM PUBLIC;

COMMIT;
