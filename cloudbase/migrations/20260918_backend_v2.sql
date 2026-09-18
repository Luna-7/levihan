-- Backend v2 is additive.  In particular, the legacy public.users table is
-- deliberately untouched: all v2 identity foreign keys target app_users.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION public.backend_v2_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
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
    AND username ~ '^[A-Za-z0-9_]{3,32}$'
  ),
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
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

CREATE FUNCTION public.backend_v2_enforce_comment_reply_depth()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_work_id uuid;
  v_parent_parent_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.work_id IS DISTINCT FROM OLD.work_id)
     AND EXISTS (SELECT 1 FROM public.comments AS child_comment WHERE child_comment.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'a comment with replies cannot be reparented or moved' USING ERRCODE = '23514';
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

-- Atomic ticket consumption: a row lock/update makes concurrent replays fail,
-- while the user, challenge state, and HttpOnly-cookie token hash are created
-- in the same transaction.
CREATE FUNCTION public.consume_registration_ticket(
  p_ticket_token_hash text,
  p_username text,
  p_password_hash text,
  p_session_token_hash text,
  p_session_expires_at timestamptz,
  p_ip_hash text DEFAULT NULL
) RETURNS TABLE (user_id uuid, session_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  v_challenge_id uuid;
  v_user_id uuid;
  v_session_id uuid;
BEGIN
  UPDATE public.registration_tickets AS ticket
     SET used_at = clock_timestamp()
    FROM public.registration_challenges AS challenge
   WHERE ticket.token_hash = p_ticket_token_hash
     AND ticket.used_at IS NULL
     AND ticket.expires_at > clock_timestamp()
     AND challenge.id = ticket.challenge_id
     AND challenge.status = 'passed'
     AND challenge.expires_at > clock_timestamp()
   RETURNING ticket.challenge_id INTO v_challenge_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration ticket is invalid, expired, or already used' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.app_users (username, password_hash)
  VALUES (p_username, p_password_hash)
  RETURNING id INTO v_user_id;
  UPDATE public.registration_challenges SET status = 'consumed' WHERE id = v_challenge_id;
  INSERT INTO public.user_sessions (user_id, token_hash, expires_at, ip_hash)
  VALUES (v_user_id, p_session_token_hash, p_session_expires_at, p_ip_hash)
  RETURNING id INTO v_session_id;
  RETURN QUERY SELECT v_user_id, v_session_id;
END;
$$;

CREATE FUNCTION public.rotate_user_session(
  p_current_token_hash text,
  p_new_token_hash text,
  p_new_expires_at timestamptz,
  p_ip_hash text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
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
  INSERT INTO public.user_sessions (user_id, token_hash, expires_at, ip_hash)
  VALUES (v_user_id, p_new_token_hash, p_new_expires_at, p_ip_hash)
  RETURNING id INTO v_session_id;
  RETURN v_session_id;
END;
$$;

CREATE FUNCTION public.consume_recovery_code(
  p_code_hash text,
  p_new_password_hash text,
  p_session_token_hash text,
  p_session_expires_at timestamptz,
  p_ip_hash text DEFAULT NULL
) RETURNS TABLE (user_id uuid, session_id uuid)
LANGUAGE plpgsql
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
  UPDATE public.app_users SET password_hash = p_new_password_hash WHERE id = v_user_id;
  UPDATE public.user_sessions SET revoked_at = clock_timestamp()
   WHERE user_id = v_user_id AND revoked_at IS NULL;
  INSERT INTO public.user_sessions (user_id, token_hash, expires_at, ip_hash)
  VALUES (v_user_id, p_session_token_hash, p_session_expires_at, p_ip_hash)
  RETURNING id INTO v_session_id;
  RETURN QUERY SELECT v_user_id, v_session_id;
END;
$$;

CREATE FUNCTION public.set_work_like(p_user_id uuid, p_work_id uuid, p_liked boolean)
RETURNS boolean
LANGUAGE plpgsql
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
  public.rate_limit_buckets FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backend_v2_set_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backend_v2_enforce_comment_reply_depth() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backend_v2_validate_submission_asset() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.answer_registration_challenge(uuid, boolean, integer, integer, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_registration_ticket(text, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rotate_user_session(text, text, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_recovery_code(text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_work_like(uuid, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_favorite(uuid, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_reading_progress(uuid, uuid, bigint, numeric, bigint, timestamptz) FROM PUBLIC;

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
