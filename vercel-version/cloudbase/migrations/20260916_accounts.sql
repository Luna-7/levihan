CREATE TABLE IF NOT EXISTS public.users (
  uid text PRIMARY KEY,
  nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 2 AND 20),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'banned')),
  invited_by text,
  inviter_nickname text,
  used_invite_code text UNIQUE,
  invite_quota integer NOT NULL DEFAULT 2 CHECK (invite_quota >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invite_codes (
  code text PRIMARY KEY,
  creator_uid text NOT NULL,
  creator_nickname text NOT NULL,
  status text NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'used', 'expired', 'revoked')),
  used_by_uid text,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS invite_codes_creator_created_idx
  ON public.invite_codes (creator_uid, created_at DESC);

CREATE OR REPLACE FUNCTION public.claim_registration_invite(p_uid text, p_nickname text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE key_row public.invite_codes%ROWTYPE;
DECLARE profile public.users%ROWTYPE;
BEGIN
  SELECT * INTO profile FROM public.users WHERE uid = p_uid;
  IF FOUND THEN RETURN to_jsonb(profile); END IF;
  IF char_length(trim(p_nickname)) < 2 OR char_length(trim(p_nickname)) > 20 THEN
    RAISE EXCEPTION 'INVALID_NICKNAME';
  END IF;
  SELECT * INTO key_row FROM public.invite_codes
    WHERE code = upper(trim(p_code)) FOR UPDATE;
  IF NOT FOUND OR key_row.status <> 'unused' OR key_row.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITE_UNAVAILABLE';
  END IF;
  UPDATE public.invite_codes SET status = 'used', used_by_uid = p_uid, used_at = now()
    WHERE code = key_row.code;
  INSERT INTO public.users (uid, nickname, role, invited_by, inviter_nickname, used_invite_code, invite_quota)
    VALUES (p_uid, trim(p_nickname), 'user', key_row.creator_uid, key_row.creator_nickname, key_row.code, 2)
    RETURNING * INTO profile;
  RETURN to_jsonb(profile);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.generate_invite_for_user(p_uid text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE member public.users%ROWTYPE;
DECLARE new_code text;
DECLARE created public.invite_codes%ROWTYPE;
BEGIN
  SELECT * INTO member FROM public.users WHERE uid = p_uid FOR UPDATE;
  IF NOT FOUND OR member.role = 'banned' THEN RAISE EXCEPTION 'USER_NOT_ALLOWED'; END IF;
  IF member.invite_quota < 1 THEN RAISE EXCEPTION 'NO_INVITE_QUOTA'; END IF;
  LOOP
    new_code := 'LH-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.invite_codes WHERE code = new_code);
  END LOOP;
  UPDATE public.users SET invite_quota = invite_quota - 1 WHERE uid = p_uid;
  INSERT INTO public.invite_codes (code, creator_uid, creator_nickname, expires_at)
    VALUES (new_code, member.uid, member.nickname, now() + interval '90 days')
    RETURNING * INTO created;
  RETURN to_jsonb(created);
END;
$fn$;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.users, public.invite_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.users, public.invite_codes TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_registration_invite(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_invite_for_user(text) TO service_role;

INSERT INTO public.invite_codes
  (code, creator_uid, creator_nickname, status, expires_at)
VALUES
  ('LH-ADMIN-90D', 'admin-bootstrap', '管理员', 'unused', now() + interval '90 days')
ON CONFLICT (code) DO UPDATE SET
  creator_uid = EXCLUDED.creator_uid,
  creator_nickname = EXCLUDED.creator_nickname,
  status = 'unused',
  used_by_uid = NULL,
  used_at = NULL,
  created_at = now(),
  expires_at = now() + interval '90 days';
