-- 昵称 + 密码登录：users 补齐凭证列，并提供注册 / 改昵称 / 取凭证的服务端函数。
-- 背景：短信验证码登录 + 粮仓钥匙邀请制已下线，改为「昵称 + 密码」开放注册。
-- 口令散列在云函数里用 Node crypto scrypt 生成，数据库只存散列，不存明文、不做二次加密。

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.users.password_hash IS
  'scrypt 口令散列，格式 scrypt$<salt-hex>$<hash-hex>；为空表示该账号尚未设置口令';

-- 昵称是登录标识，必须唯一且大小写不敏感（避免「Han」和「han」互撞）
CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_lower_key
  ON public.users (lower(nickname));

-- 开放注册：不再校验粮仓钥匙。uid 由云函数生成，不使用客户端可控的值。
CREATE OR REPLACE FUNCTION public.register_with_password(
  p_uid text,
  p_nickname text,
  p_password_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE profile public.users%ROWTYPE;
BEGIN
  IF p_uid IS NULL OR char_length(p_uid) < 6 THEN RAISE EXCEPTION 'INVALID_UID'; END IF;
  IF p_nickname IS NULL OR char_length(trim(p_nickname)) NOT BETWEEN 2 AND 20 THEN
    RAISE EXCEPTION 'INVALID_NICKNAME';
  END IF;
  IF p_password_hash IS NULL OR char_length(p_password_hash) < 16 THEN
    RAISE EXCEPTION 'INVALID_PASSWORD';
  END IF;

  -- 幂等：同一 uid 重复调用直接返回既有档案，不覆盖口令
  SELECT * INTO profile FROM public.users WHERE uid = p_uid;
  IF FOUND THEN RETURN to_jsonb(profile); END IF;

  BEGIN
    INSERT INTO public.users (uid, nickname, role, password_hash, invite_quota)
      VALUES (p_uid, trim(p_nickname), 'user', p_password_hash, 0)
      RETURNING * INTO profile;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'NICKNAME_TAKEN';
  END;

  RETURN to_jsonb(profile);
END;
$fn$;

-- 改昵称：同样保证唯一，冲突时抛 NICKNAME_TAKEN
CREATE OR REPLACE FUNCTION public.rename_user(p_uid text, p_nickname text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE profile public.users%ROWTYPE;
BEGIN
  IF p_nickname IS NULL OR char_length(trim(p_nickname)) NOT BETWEEN 2 AND 20 THEN
    RAISE EXCEPTION 'INVALID_NICKNAME';
  END IF;

  BEGIN
    UPDATE public.users SET nickname = trim(p_nickname), updated_at = now()
      WHERE uid = p_uid
      RETURNING * INTO profile;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'NICKNAME_TAKEN';
  END;

  IF profile.uid IS NULL THEN RAISE EXCEPTION 'PROFILE_REQUIRED'; END IF;
  RETURN to_jsonb(profile);
END;
$fn$;

-- 登录凭证查找：只回传校验所需字段，避免整行外泄
CREATE OR REPLACE FUNCTION public.find_login_credential(p_nickname text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
  SELECT jsonb_build_object(
    'uid', u.uid,
    'nickname', u.nickname,
    'role', u.role,
    'password_hash', u.password_hash
  )
  FROM public.users u
  WHERE lower(u.nickname) = lower(trim(p_nickname))
  LIMIT 1;
$fn$;

GRANT EXECUTE ON FUNCTION public.register_with_password(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rename_user(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.find_login_credential(text) TO service_role;
