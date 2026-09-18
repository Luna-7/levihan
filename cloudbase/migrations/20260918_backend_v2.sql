-- Backend v2 is additive.  In particular, the legacy public.users table is
-- deliberately untouched: all v2 identity foreign keys target app_users.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION public.backend_v2_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TABLE public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL CHECK (
    username = btrim(username)
    AND username = lower(username)
    AND username ~ '^[a-z0-9_]{3,32}$'
  ),
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  recovery_confirmed_at timestamptz DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX app_users_username_lower_key ON public.app_users (lower(username));

CREATE TABLE public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  recovery_confirmed_at timestamptz,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX user_sessions_token_hash_key ON public.user_sessions (token_hash);
CREATE INDEX user_sessions_user_active_idx ON public.user_sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE public.question_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt text NOT NULL CHECK (length(btrim(prompt)) > 0),
  options jsonb NOT NULL CHECK (
    jsonb_typeof(options) = 'array'
    AND jsonb_array_length(options) BETWEEN 2 AND 8
    AND NOT options @? '$[*] ? (@.type() != "string" || @ like_regex "^\\s*$")'
  ),
  accepted_answer_hashes text[] NOT NULL CHECK (cardinality(accepted_answer_hashes) > 0),
  normalization_rule text NOT NULL DEFAULT 'trim_lowercase',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  sampling_weight integer NOT NULL DEFAULT 1 CHECK (sampling_weight > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX question_bank_active_idx ON public.question_bank (status, sampling_weight DESC) WHERE status = 'active';

CREATE TABLE public.registration_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_ids uuid[] NOT NULL CHECK (cardinality(question_ids) > 0),
  question_versions integer[] NOT NULL CHECK (
    cardinality(question_versions) = cardinality(question_ids)
    AND 0 < ALL(question_versions)
  ),
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed', 'expired', 'consumed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  expires_at timestamptz NOT NULL,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (attempt_count <= max_attempts)
);
CREATE INDEX registration_challenges_ip_expiry_idx ON public.registration_challenges (ip_hash, expires_at DESC);
CREATE INDEX registration_challenges_pending_expiry_idx ON public.registration_challenges (status, expires_at) WHERE status = 'pending';

CREATE TABLE public.registration_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.registration_challenges(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  result text NOT NULL CHECK (result IN ('correct', 'incorrect', 'expired', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, attempt_no)
);
CREATE INDEX registration_attempts_challenge_idx ON public.registration_attempts (challenge_id, created_at DESC);

CREATE TABLE public.registration_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.registration_challenges(id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  UNIQUE (challenge_id),
  UNIQUE (token_hash)
);
CREATE INDEX registration_tickets_active_idx ON public.registration_tickets (expires_at) WHERE used_at IS NULL;

CREATE TABLE public.recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code_hash)
);
CREATE INDEX recovery_codes_user_active_idx ON public.recovery_codes (user_id, created_at DESC) WHERE used_at IS NULL;

CREATE TABLE public.age_consents (
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  policy_version text NOT NULL CHECK (length(btrim(policy_version)) > 0),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, policy_version),
  CHECK (revoked_at IS NULL OR revoked_at >= accepted_at)
);
CREATE INDEX age_consents_active_idx ON public.age_consents (user_id, accepted_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE public.works (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,127}$'),
  type text NOT NULL CHECK (type IN ('comic', 'novel', 'art', 'resource')),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  summary text NOT NULL DEFAULT '',
  rating text NOT NULL DEFAULT 'general' CHECK (rating IN ('general', 'mature', 'restricted')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'archived', 'deleted')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  author_name text NOT NULL,
  published_at timestamptz,
  created_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug)
);
CREATE INDEX works_public_directory_idx ON public.works (status, published_at DESC) WHERE status = 'published';
CREATE INDEX works_created_by_idx ON public.works (created_by);
CREATE INDEX works_updated_by_idx ON public.works (updated_by);

CREATE TABLE public.work_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('cover', 'page', 'body', 'attachment', 'preview')),
  object_key text NOT NULL,
  access_level text NOT NULL DEFAULT 'public' CHECK (access_level IN ('public', 'private')),
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  checksum text NOT NULL,
  page_no integer CHECK (page_no IS NULL OR page_no > 0),
  status text NOT NULL DEFAULT 'staging' CHECK (status IN ('staging', 'verified', 'active', 'orphaned', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'page' OR page_no IS NOT NULL),
  UNIQUE (object_key),
  UNIQUE (work_id, kind, page_no)
);
CREATE INDEX work_assets_work_status_idx ON public.work_assets (work_id, status, kind, page_no);

CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug),
  UNIQUE (name)
);

CREATE TABLE public.work_tags (
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE RESTRICT,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_id, tag_id)
);
CREATE INDEX work_tags_tag_idx ON public.work_tags (tag_id, work_id);

CREATE TABLE public.work_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE RESTRICT,
  version bigint NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL,
  created_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_id, version)
);
CREATE INDEX work_versions_creator_idx ON public.work_versions (created_by);

CREATE TABLE public.work_likes (
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_id)
);
CREATE INDEX work_likes_work_idx ON public.work_likes (work_id, created_at DESC);

CREATE TABLE public.favorites (
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_id)
);
CREATE INDEX favorites_work_idx ON public.favorites (work_id, created_at DESC);

CREATE TABLE public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  parent_id uuid REFERENCES public.comments(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('pending', 'published', 'hidden', 'deleted', 'rejected')),
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX comments_work_list_idx ON public.comments (work_id, status, created_at DESC);
CREATE INDEX comments_user_idx ON public.comments (user_id, created_at DESC);
CREATE INDEX comments_parent_idx ON public.comments (parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE public.reading_progress (
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE RESTRICT,
  position bigint NOT NULL CHECK (position >= 0),
  percent numeric(5,2) NOT NULL CHECK (percent >= 0 AND percent <= 100),
  client_version bigint NOT NULL DEFAULT 0 CHECK (client_version >= 0),
  client_updated_at timestamptz NOT NULL,
  server_version bigint NOT NULL DEFAULT 1 CHECK (server_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_id)
);
CREATE INDEX reading_progress_work_idx ON public.reading_progress (work_id, updated_at DESC);

CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  target_type text NOT NULL CHECK (target_type IN ('work', 'comment', 'submission', 'user')),
  target_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'resolved', 'rejected')),
  handled_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, target_type, target_id)
);
CREATE INDEX reports_queue_idx ON public.reports (status, created_at);
CREATE INDEX reports_handled_by_idx ON public.reports (handled_by);

CREATE TABLE public.upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('work_asset', 'submission_asset')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'expired', 'cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX upload_sessions_owner_status_idx ON public.upload_sessions (owner_id, status, expires_at DESC);

CREATE TABLE public.upload_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.upload_sessions(id) ON DELETE RESTRICT,
  object_key text NOT NULL,
  expected_size bigint NOT NULL CHECK (expected_size >= 0),
  actual_size bigint CHECK (actual_size >= 0),
  mime_type text NOT NULL,
  checksum text,
  status text NOT NULL DEFAULT 'declared' CHECK (status IN ('declared', 'uploaded', 'verified', 'bound', 'rejected', 'orphaned', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actual_size IS NULL OR actual_size = expected_size),
  UNIQUE (object_key)
);
CREATE INDEX upload_files_session_status_idx ON public.upload_files (session_id, status);

CREATE TABLE public.submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('comic', 'novel', 'recommendation', 'other')),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'reviewing', 'approved', 'request_changes', 'rejected', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX submissions_queue_idx ON public.submissions (status, created_at);
CREATE INDEX submissions_user_idx ON public.submissions (user_id, created_at DESC);

CREATE TABLE public.submission_assets (
  submission_id uuid NOT NULL REFERENCES public.submissions(id) ON DELETE RESTRICT,
  upload_file_id uuid NOT NULL REFERENCES public.upload_files(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, upload_file_id),
  UNIQUE (upload_file_id)
);
CREATE INDEX submission_assets_file_idx ON public.submission_assets (upload_file_id);

CREATE TABLE public.snapshot_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type text NOT NULL CHECK (snapshot_type IN ('catalog', 'tags', 'config')),
  source_version bigint NOT NULL CHECK (source_version > 0),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX snapshot_jobs_queue_idx ON public.snapshot_jobs (status, created_at);

CREATE TABLE public.snapshot_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_job_id uuid REFERENCES public.snapshot_jobs(id) ON DELETE RESTRICT,
  snapshot_type text NOT NULL CHECK (snapshot_type IN ('catalog', 'tags', 'config')),
  version bigint NOT NULL CHECK (version > 0),
  object_key text NOT NULL,
  checksum text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_type, version),
  UNIQUE (object_key)
);
CREATE INDEX snapshot_versions_job_idx ON public.snapshot_versions (snapshot_job_id);

CREATE TABLE public.moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('comment', 'submission', 'report', 'work', 'user')),
  target_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('approve', 'hide', 'reject', 'request_changes', 'withdraw', 'restore', 'suspend')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  admin_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_target_idx ON public.moderation_actions (target_type, target_id, created_at DESC);
CREATE INDEX moderation_actions_admin_idx ON public.moderation_actions (admin_id, created_at DESC);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_target_idx ON public.audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON public.audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_request_idx ON public.audit_logs (request_id);

CREATE TABLE public.site_settings (
  key text PRIMARY KEY CHECK (length(btrim(key)) > 0),
  value jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_settings_updated_by_idx ON public.site_settings (updated_by);

CREATE TABLE public.blocked_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'ip', 'device')),
  subject_hash text NOT NULL,
  reason text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_type, subject_hash)
);
CREATE INDEX blocked_subjects_expiry_idx ON public.blocked_subjects (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE public.rate_limit_buckets (
  subject_hash text NOT NULL,
  bucket text NOT NULL,
  window_started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  hit_count integer NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_hash, bucket, window_started_at),
  CHECK (expires_at > window_started_at)
);
CREATE INDEX rate_limit_buckets_expiry_idx ON public.rate_limit_buckets (expires_at);
CREATE TABLE public.idempotency_records (
  scope text NOT NULL CHECK (scope <> ''),
  actor_scope_hash text NOT NULL CHECK (actor_scope_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('processing', 'completed')),
  response jsonb,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, actor_scope_hash, idempotency_key),
  CHECK ((status = 'processing' AND response IS NULL) OR (status = 'completed' AND response IS NOT NULL))
);
CREATE INDEX idempotency_records_expiry_idx ON public.idempotency_records (expires_at);
CREATE FUNCTION public.resolve_user_session(p_token_hash text)
RETURNS TABLE (user_id uuid, role text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT session.user_id, app_user.role
    FROM public.user_sessions AS session
    JOIN public.app_users AS app_user ON app_user.id = session.user_id
   WHERE p_token_hash ~ '^[0-9a-f]{64}$'
     AND session.token_hash = p_token_hash
     AND session.revoked_at IS NULL
     AND session.expires_at > clock_timestamp()
     AND session.recovery_confirmed_at IS NOT NULL
     AND app_user.status = 'active'
     AND app_user.recovery_confirmed_at IS NOT NULL
   LIMIT 1
$$;

CREATE FUNCTION public.revoke_user_session(p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.user_sessions
     SET revoked_at = clock_timestamp()
   WHERE token_hash = p_token_hash
     AND revoked_at IS NULL
     AND expires_at > clock_timestamp();
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.begin_idempotent_request(p_scope text, p_actor_scope_hash text, p_idempotency_key text, p_request_hash text)
RETURNS TABLE (state text, response jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_now timestamptz := clock_timestamp(); v_affected integer;
BEGIN
  IF p_scope = '' OR p_actor_scope_hash !~ '^[0-9a-f]{64}$' OR p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid idempotency input' USING ERRCODE = '22023';
  END IF;
  LOOP
    v_now := clock_timestamp();
    INSERT INTO public.idempotency_records (scope, actor_scope_hash, idempotency_key, request_hash, status, response, expires_at)
    VALUES (p_scope, p_actor_scope_hash, p_idempotency_key, p_request_hash, 'processing', NULL, v_now + interval '5 minutes')
    ON CONFLICT(scope,actor_scope_hash,idempotency_key) DO UPDATE SET
      request_hash = EXCLUDED.request_hash, status = 'processing', response = NULL, expires_at = EXCLUDED.expires_at
    WHERE idempotency_records.expires_at <= v_now;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 1 THEN state := 'acquired'; response := NULL; RETURN NEXT; RETURN; END IF;

    v_now := clock_timestamp();
    SELECT CASE WHEN request_hash <> p_request_hash THEN 'request_hash_conflict'
                WHEN status = 'completed' THEN 'completed'
                ELSE 'in_progress' END,
           idempotency_records.response
      INTO state, response
      FROM public.idempotency_records
     WHERE scope = p_scope AND actor_scope_hash = p_actor_scope_hash AND idempotency_key = p_idempotency_key
       AND expires_at > v_now
     FOR NO KEY UPDATE;
    IF FOUND THEN RETURN NEXT; RETURN; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION public.complete_idempotent_request(p_scope text, p_actor_scope_hash text, p_idempotency_key text, p_request_hash text, p_response jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_affected integer;
BEGIN
  IF p_response IS NULL THEN RAISE EXCEPTION 'idempotency response is required' USING ERRCODE = '22023'; END IF;
  UPDATE public.idempotency_records
     SET status = 'completed', response = p_response, expires_at = clock_timestamp() + interval '24 hours'
   WHERE scope = p_scope AND actor_scope_hash = p_actor_scope_hash AND idempotency_key = p_idempotency_key
     AND request_hash = p_request_hash AND status = 'processing';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected = 1;
END;
$$;

CREATE FUNCTION public.fail_idempotent_request(p_scope text, p_actor_scope_hash text, p_idempotency_key text, p_request_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_affected integer;
BEGIN
  DELETE FROM public.idempotency_records
   WHERE scope = p_scope AND actor_scope_hash = p_actor_scope_hash AND idempotency_key = p_idempotency_key
     AND request_hash = p_request_hash AND status = 'processing';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected = 1;
END;
$$;

CREATE FUNCTION public.consume_rate_limit_bucket(
  p_subject_hash text, p_bucket text, p_window_seconds integer, p_limit integer, p_now timestamptz
) RETURNS TABLE (accepted boolean, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_window_started_at timestamptz; v_expires_at timestamptz; v_hit_count integer;
BEGIN
  IF p_subject_hash = '' OR p_bucket = '' OR p_window_seconds < 1 OR p_limit < 1 THEN RAISE EXCEPTION 'invalid rate limit input' USING ERRCODE = '22023'; END IF;
  v_window_started_at := to_timestamp(floor(extract(epoch FROM p_now) / p_window_seconds) * p_window_seconds);
  INSERT INTO public.rate_limit_buckets AS current_bucket (subject_hash, bucket, window_started_at, expires_at, hit_count)
  VALUES (p_subject_hash, p_bucket, v_window_started_at, v_window_started_at + (p_window_seconds * interval '1 second'), 1)
  ON CONFLICT (subject_hash, bucket, window_started_at) DO UPDATE SET hit_count = current_bucket.hit_count + 1, updated_at = clock_timestamp()
  RETURNING hit_count, expires_at INTO v_hit_count, v_expires_at;
  accepted := v_hit_count <= p_limit;
  retry_after_seconds := CASE WHEN accepted THEN 0 ELSE GREATEST(1, CEIL(EXTRACT(epoch FROM v_expires_at - p_now))::integer) END;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION public.backend_v2_enforce_comment_reply_depth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_parent_work_id uuid;
  v_parent_parent_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.work_id IS DISTINCT FROM OLD.work_id) THEN
    RAISE EXCEPTION 'comment parent and work links are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT work_id, parent_id
      INTO v_parent_work_id, v_parent_parent_id
      FROM public.comments
     WHERE id = NEW.parent_id
     FOR KEY SHARE;
    IF NOT FOUND OR v_parent_work_id <> NEW.work_id OR v_parent_parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'comment parent must be a top-level comment on the same work' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.answer_registration_challenge(
  p_challenge_id uuid,
  p_is_correct boolean,
  p_score_delta integer,
  p_passing_score integer,
  p_ticket_token_hash text,
  p_ticket_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_challenge public.registration_challenges%ROWTYPE;
  v_attempt_no integer;
  v_next_score integer;
  v_ticket_id uuid;
BEGIN
  IF p_score_delta < 0 OR p_passing_score < 1 OR p_ticket_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'invalid challenge scoring or ticket expiry' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_challenge
    FROM public.registration_challenges
   WHERE id = p_challenge_id
     AND status = 'pending'
     AND expires_at > clock_timestamp()
   FOR UPDATE;
  IF NOT FOUND OR v_challenge.attempt_count >= v_challenge.max_attempts THEN
    RAISE EXCEPTION 'challenge is invalid, expired, or exhausted' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM unnest(v_challenge.question_ids, v_challenge.question_versions) AS selected(question_id, question_version)
      LEFT JOIN public.question_bank AS question ON question.id = selected.question_id
     WHERE question.id IS NULL OR question.version <> selected.question_version
  ) THEN
    RAISE EXCEPTION 'challenge question version is no longer valid' USING ERRCODE = '23514';
  END IF;

  v_attempt_no := v_challenge.attempt_count + 1;
  v_next_score := v_challenge.score + CASE WHEN p_is_correct THEN p_score_delta ELSE 0 END;
  INSERT INTO public.registration_attempts (challenge_id, attempt_no, result)
  VALUES (p_challenge_id, v_attempt_no,
    CASE WHEN p_is_correct THEN 'correct' ELSE 'incorrect' END);

  IF p_is_correct AND v_next_score >= p_passing_score THEN
    UPDATE public.registration_challenges
       SET attempt_count = v_attempt_no, score = v_next_score, status = 'passed'
     WHERE id = p_challenge_id;
    INSERT INTO public.registration_tickets (challenge_id, token_hash, expires_at)
    VALUES (p_challenge_id, p_ticket_token_hash, p_ticket_expires_at)
    RETURNING id INTO v_ticket_id;
    RETURN v_ticket_id;
  END IF;

  UPDATE public.registration_challenges
     SET attempt_count = v_attempt_no,
         score = v_next_score,
         status = CASE WHEN v_attempt_no >= v_challenge.max_attempts THEN 'failed' ELSE 'pending' END
   WHERE id = p_challenge_id;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.backend_v2_validate_submission_asset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_submission_owner uuid;
  v_upload_owner uuid;
  v_upload_status text;
BEGIN
  SELECT submission.user_id, upload_session.owner_id, upload_file.status
    INTO v_submission_owner, v_upload_owner, v_upload_status
    FROM public.submissions AS submission
    JOIN public.upload_files AS upload_file ON upload_file.id = NEW.upload_file_id
    JOIN public.upload_sessions AS upload_session ON upload_session.id = upload_file.session_id
   WHERE submission.id = NEW.submission_id;
  IF NOT FOUND OR v_submission_owner <> v_upload_owner
     OR v_upload_status NOT IN ('verified', 'bound') THEN
    RAISE EXCEPTION 'submission assets must be verified files owned by the submitter' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.submission_assets
     WHERE upload_file_id = NEW.upload_file_id AND submission_id <> NEW.submission_id
  ) THEN
    RAISE EXCEPTION 'an upload file may belong to only one submission' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

-- Cheap read-only admission check. The caller still has to consume the ticket
-- atomically because this result can become stale immediately after it returns.
CREATE FUNCTION public.validate_registration_ticket(p_ticket_token_hash text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.registration_tickets AS ticket
      JOIN public.registration_challenges AS challenge
        ON challenge.id = ticket.challenge_id
     WHERE p_ticket_token_hash ~ '^[0-9a-f]{64}$'
       AND ticket.token_hash = p_ticket_token_hash
       AND ticket.used_at IS NULL
       AND ticket.expires_at > clock_timestamp()
       AND challenge.status = 'passed'
  )
$$;

-- Atomic ticket consumption: a row lock/update makes concurrent replays fail,
-- while the user, challenge state, and HttpOnly-cookie token hash are created
-- in the same transaction.
CREATE FUNCTION public.consume_registration_ticket(
  p_ticket_token_hash text,
  p_username text,
  p_password_hash text,
  p_session_token_hash text,
  p_session_expires_at timestamptz,
  p_recovery_code_hash text,
  p_ip_hash text DEFAULT NULL
) RETURNS TABLE (user_id uuid, session_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_challenge_id uuid;
  v_user_id uuid;
  v_session_id uuid;
  v_window_started_at timestamptz;
  v_registration_count integer;
BEGIN
  IF p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'registration IP hash is required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.registration_tickets AS ticket
     SET used_at = clock_timestamp()
    FROM public.registration_challenges AS challenge
   WHERE ticket.token_hash = p_ticket_token_hash
     AND ticket.used_at IS NULL
     AND ticket.expires_at > clock_timestamp()
     AND challenge.id = ticket.challenge_id
     AND challenge.status = 'passed'
   RETURNING ticket.challenge_id INTO v_challenge_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration ticket is invalid, expired, or already used' USING ERRCODE = '23514';
  END IF;

  v_window_started_at := date_trunc('hour', clock_timestamp());
  INSERT INTO public.rate_limit_buckets AS current_bucket
    (subject_hash, bucket, window_started_at, expires_at, hit_count)
  VALUES (p_ip_hash, 'registration-success', v_window_started_at, v_window_started_at + interval '1 hour', 1)
  ON CONFLICT (subject_hash, bucket, window_started_at) DO UPDATE
    SET hit_count = current_bucket.hit_count + 1, updated_at = clock_timestamp()
  RETURNING hit_count INTO v_registration_count;
  IF v_registration_count > 3 THEN
    RAISE EXCEPTION 'registration_success_rate_limited' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.app_users (username, password_hash)
  VALUES (p_username, p_password_hash)
  RETURNING id INTO v_user_id;
  INSERT INTO public.recovery_codes (user_id, code_hash)
  VALUES (v_user_id, p_recovery_code_hash);
  UPDATE public.registration_challenges SET status = 'consumed' WHERE id = v_challenge_id;
  INSERT INTO public.user_sessions (user_id, token_hash, expires_at, ip_hash, recovery_confirmed_at)
  VALUES (v_user_id, p_session_token_hash, p_session_expires_at, p_ip_hash, NULL)
  RETURNING id INTO v_session_id;
  RETURN QUERY SELECT v_user_id, v_session_id;
END;
$$;

CREATE FUNCTION public.create_login_session(
  p_user_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_ip_hash text,
  p_current_token_hash text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  IF p_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'login session expiry must be in the future' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.app_users AS login_user
   WHERE login_user.id = p_user_id
     AND login_user.status = 'active'
     AND login_user.recovery_confirmed_at IS NOT NULL
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'login user is unavailable' USING ERRCODE = '23514';
  END IF;
  IF p_current_token_hash IS NOT NULL THEN
    IF p_current_token_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'invalid current session token hash' USING ERRCODE = '22023';
    END IF;
    UPDATE public.user_sessions
       SET revoked_at = clock_timestamp()
     WHERE token_hash = p_current_token_hash
       AND revoked_at IS NULL;
  END IF;
  INSERT INTO public.user_sessions (user_id, token_hash, expires_at, ip_hash, recovery_confirmed_at)
  VALUES (p_user_id, p_token_hash, p_expires_at, p_ip_hash, clock_timestamp())
  RETURNING id INTO v_session_id;
  RETURN v_session_id;
END;
$$;

CREATE FUNCTION public.rotate_user_session(
  p_current_token_hash text,
  p_new_token_hash text,
  p_new_expires_at timestamptz,
  p_ip_hash text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid;
  v_session_id uuid;
BEGIN
  UPDATE public.user_sessions
     SET revoked_at = clock_timestamp()
   WHERE token_hash = p_current_token_hash
     AND revoked_at IS NULL
     AND expires_at > clock_timestamp()
   RETURNING user_id INTO v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session is invalid, expired, or already rotated' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.user_sessions (user_id, token_hash, expires_at, ip_hash, recovery_confirmed_at)
  VALUES (v_user_id, p_new_token_hash, p_new_expires_at, p_ip_hash, clock_timestamp())
  RETURNING id INTO v_session_id;
  RETURN v_session_id;
END;
$$;

CREATE FUNCTION public.consume_recovery_code(
  p_code_hash text,
  p_new_password_hash text,
  p_new_recovery_code_hash text,
  p_session_token_hash text,
  p_session_expires_at timestamptz,
  p_ip_hash text DEFAULT NULL
) RETURNS TABLE (user_id uuid, session_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid;
  v_session_id uuid;
BEGIN
  UPDATE public.recovery_codes
     SET used_at = clock_timestamp()
   WHERE code_hash = p_code_hash AND used_at IS NULL
   RETURNING recovery_codes.user_id INTO v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recovery code is invalid or already used' USING ERRCODE = '23514';
  END IF;
  UPDATE public.app_users
     SET password_hash = p_new_password_hash,
         recovery_confirmed_at = NULL
   WHERE id = v_user_id;
  UPDATE public.user_sessions SET revoked_at = clock_timestamp()
   WHERE user_id = v_user_id AND revoked_at IS NULL;
  INSERT INTO public.recovery_codes (user_id, code_hash)
  VALUES (v_user_id, p_new_recovery_code_hash);
  INSERT INTO public.user_sessions (user_id, token_hash, expires_at, ip_hash, recovery_confirmed_at)
  VALUES (v_user_id, p_session_token_hash, p_session_expires_at, p_ip_hash, NULL)
  RETURNING id INTO v_session_id;
  RETURN QUERY SELECT v_user_id, v_session_id;
END;
$$;

CREATE FUNCTION public.confirm_recovery_session(
  p_session_token_hash text,
  p_recovery_code_hash text
) RETURNS TABLE (
  user_id uuid,
  username text,
  role text,
  status text,
  policy_version text,
  accepted_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  UPDATE public.user_sessions AS session
     SET recovery_confirmed_at = v_now
    FROM public.recovery_codes AS recovery,
         public.app_users AS account
   WHERE session.token_hash = p_session_token_hash
     AND session.revoked_at IS NULL
     AND session.expires_at > clock_timestamp()
     AND session.recovery_confirmed_at IS NULL
     AND account.id = session.user_id
     AND account.status = 'active'
     AND account.recovery_confirmed_at IS NULL
     AND recovery.user_id = session.user_id
     AND recovery.code_hash = p_recovery_code_hash
     AND recovery.used_at IS NULL
  RETURNING session.user_id INTO v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recovery confirmation is invalid or already completed' USING ERRCODE = '23514';
  END IF;
  UPDATE public.app_users
     SET recovery_confirmed_at = v_now
   WHERE id = v_user_id
     AND recovery_confirmed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recovery confirmation is invalid or already completed' USING ERRCODE = '23514';
  END IF;
  RETURN QUERY
  SELECT app_user.id, app_user.username, app_user.role, app_user.status,
         consent.policy_version, consent.accepted_at
    FROM public.app_users AS app_user
    LEFT JOIN LATERAL (
      SELECT age_consent.policy_version, age_consent.accepted_at
        FROM public.age_consents AS age_consent
       WHERE age_consent.user_id = app_user.id
         AND age_consent.revoked_at IS NULL
       ORDER BY age_consent.accepted_at DESC
       LIMIT 1
    ) AS consent ON true
   WHERE app_user.id = v_user_id
     AND app_user.status = 'active';
END;
$$;

CREATE FUNCTION public.promote_app_user(
  p_actor_id uuid,
  p_target_id uuid,
  p_reauthenticated boolean,
  p_request_id text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.app_users%ROWTYPE;
  v_target public.app_users%ROWTYPE;
BEGIN
  IF NOT p_reauthenticated OR length(btrim(p_request_id)) = 0 THEN
    RAISE EXCEPTION 'admin promotion requires reauthentication and request id' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_actor FROM public.app_users
   WHERE id = p_actor_id AND status = 'active' AND role = 'admin'
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'promotion actor is not an active admin' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_target FROM public.app_users
   WHERE id = p_target_id AND status = 'active'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'promotion target is missing or inactive' USING ERRCODE = '23514';
  END IF;
  UPDATE public.app_users SET role = 'admin' WHERE id = p_target_id;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, summary, request_id)
  VALUES (p_actor_id, 'promote_admin', 'user', p_target_id,
          jsonb_build_object('role', 'admin'), p_request_id);
  RETURN true;
END;
$$;

CREATE FUNCTION public.set_work_like(p_user_id uuid, p_work_id uuid, p_liked boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_liked THEN
    INSERT INTO public.work_likes (user_id, work_id) VALUES (p_user_id, p_work_id)
    ON CONFLICT (user_id, work_id) DO NOTHING;
  ELSE
    DELETE FROM public.work_likes WHERE user_id = p_user_id AND work_id = p_work_id;
  END IF;
  RETURN p_liked;
END;
$$;

CREATE FUNCTION public.set_favorite(p_user_id uuid, p_work_id uuid, p_favorited boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_favorited THEN
    INSERT INTO public.favorites (user_id, work_id) VALUES (p_user_id, p_work_id)
    ON CONFLICT (user_id, work_id) DO NOTHING;
  ELSE
    DELETE FROM public.favorites WHERE user_id = p_user_id AND work_id = p_work_id;
  END IF;
  RETURN p_favorited;
END;
$$;

CREATE FUNCTION public.sync_reading_progress(
  p_user_id uuid,
  p_work_id uuid,
  p_position bigint,
  p_percent numeric,
  p_client_version bigint,
  p_client_updated_at timestamptz
) RETURNS public.reading_progress
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_progress public.reading_progress;
BEGIN
  INSERT INTO public.reading_progress AS current_progress
    (user_id, work_id, position, percent, client_version, client_updated_at)
  VALUES (p_user_id, p_work_id, p_position, p_percent, p_client_version, p_client_updated_at)
  ON CONFLICT (user_id, work_id) DO UPDATE
    SET position = EXCLUDED.position,
        percent = EXCLUDED.percent,
        client_version = EXCLUDED.client_version,
        client_updated_at = EXCLUDED.client_updated_at,
        server_version = current_progress.server_version + 1,
        updated_at = clock_timestamp()
  WHERE EXCLUDED.client_version > current_progress.client_version
     OR (EXCLUDED.client_version = current_progress.client_version
         AND EXCLUDED.client_updated_at >= current_progress.client_updated_at)
  RETURNING current_progress.* INTO v_progress;
  IF NOT FOUND THEN
    SELECT * INTO v_progress FROM public.reading_progress
      WHERE user_id = p_user_id AND work_id = p_work_id;
  END IF;
  RETURN v_progress;
END;
$$;

-- Do not grant direct application access here: deployments use a separately
-- provisioned backend role.  The migration intentionally assumes no role
-- names and leaves every v2 table with RLS enabled and PUBLIC revoked.
REVOKE ALL ON TABLE public.app_users, public.user_sessions, public.question_bank,
  public.registration_challenges, public.registration_attempts, public.registration_tickets,
  public.recovery_codes, public.age_consents, public.works, public.work_assets, public.tags,
  public.work_tags, public.work_versions, public.work_likes, public.favorites, public.comments,
  public.reading_progress, public.reports, public.upload_sessions, public.upload_files,
  public.submissions, public.submission_assets, public.snapshot_jobs, public.snapshot_versions,
  public.moderation_actions, public.audit_logs, public.site_settings, public.blocked_subjects,
  public.rate_limit_buckets, public.idempotency_records FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backend_v2_set_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backend_v2_enforce_comment_reply_depth() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backend_v2_validate_submission_asset() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.answer_registration_challenge(uuid, boolean, integer, integer, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_registration_ticket(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_registration_ticket(text, text, text, text, timestamptz, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_login_session(uuid, text, timestamptz, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rotate_user_session(text, text, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_recovery_code(text, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_recovery_session(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_app_user(uuid, uuid, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_work_like(uuid, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_favorite(uuid, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_reading_progress(uuid, uuid, bigint, numeric, bigint, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_rate_limit_bucket(text, text, integer, integer, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_user_session(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_user_session(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.begin_idempotent_request(text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_idempotent_request(text,text,text,text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fail_idempotent_request(text,text,text,text) FROM PUBLIC;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.age_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.works ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshot_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshot_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER app_users_set_updated_at BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER user_sessions_set_updated_at BEFORE UPDATE ON public.user_sessions FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER question_bank_set_updated_at BEFORE UPDATE ON public.question_bank FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER registration_challenges_set_updated_at BEFORE UPDATE ON public.registration_challenges FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER age_consents_set_updated_at BEFORE UPDATE ON public.age_consents FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER works_set_updated_at BEFORE UPDATE ON public.works FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER work_assets_set_updated_at BEFORE UPDATE ON public.work_assets FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER tags_set_updated_at BEFORE UPDATE ON public.tags FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER comments_set_updated_at BEFORE UPDATE ON public.comments FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER comments_enforce_reply_depth BEFORE INSERT OR UPDATE OF parent_id, work_id ON public.comments FOR EACH ROW EXECUTE FUNCTION public.backend_v2_enforce_comment_reply_depth();
CREATE TRIGGER reading_progress_set_updated_at BEFORE UPDATE ON public.reading_progress FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER reports_set_updated_at BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER upload_sessions_set_updated_at BEFORE UPDATE ON public.upload_sessions FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER upload_files_set_updated_at BEFORE UPDATE ON public.upload_files FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER submissions_set_updated_at BEFORE UPDATE ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER submission_assets_validate BEFORE INSERT OR UPDATE ON public.submission_assets FOR EACH ROW EXECUTE FUNCTION public.backend_v2_validate_submission_asset();
CREATE TRIGGER snapshot_jobs_set_updated_at BEFORE UPDATE ON public.snapshot_jobs FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER site_settings_set_updated_at BEFORE UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();
CREATE TRIGGER rate_limit_buckets_set_updated_at BEFORE UPDATE ON public.rate_limit_buckets FOR EACH ROW EXECUTE FUNCTION public.backend_v2_set_updated_at();

COMMIT;
