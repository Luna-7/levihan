-- ============================================================================
-- 账号体系重构 · 阶段 1：自建会话 auth 建表（精简版，无 RPC）
--
-- 背景：后端 node-sdk 的 rdb() 只有 from/select/insert/update，无 rpc()，
-- 所以不建 SECURITY DEFINER RPC 函数，所有业务逻辑在云函数 JS 里用表操作实现。
--
-- 相对 codex 原版的改动：
--   1. 裁掉 RPC 函数（answer_registration_challenge 等 11 个全去掉）
--   2. 裁掉 registration_attempts（答题尝试并入 challenge 表的 attempt_count）
--   3. 裁掉 age_consents（年龄确认暂缓）
--   4. app_users.username 支持中文昵称（2-20 字）
--   5. 保留 rate_limit_buckets（24h 冷却 + 注册限流共用）
--
-- 设计：旧的 public.users 表不动（老用户放弃、重注册到 app_users）。
-- 所有表 RLS 开启 + 撤销 PUBLIC，运行时用 service_role（CLOUDBASE_APIKEY）访问。
-- ============================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. 用户表（支持中文昵称，密码 argon2 散列）
-- ---------------------------------------------------------------------------
CREATE TABLE public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL CHECK (
    username = btrim(username)
    AND char_length(username) BETWEEN 2 AND 20
    AND username !~ '[[:cntrl:]]'
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

-- ---------------------------------------------------------------------------
-- 2. 会话表（不透明 token 只存 SHA-256 哈希）
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. 题库（答案存 HMAC-SHA256(pepper, "question-answer\0"+归一化答案) 哈希）
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. 注册答题挑战（attempt_count 内联，答错 3 次置 failed；24h 冷却靠查询判定）
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. 注册票据（答对题后的一次性注册凭证）
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 6. 账号恢复码（找回密码）
-- ---------------------------------------------------------------------------
CREATE TABLE public.recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code_hash)
);
CREATE INDEX recovery_codes_user_active_idx ON public.recovery_codes (user_id, created_at DESC) WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------
-- 7. 限流桶（24h 答题冷却 + 注册限流共用）
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 权限：撤销 PUBLIC，开启 RLS（运行时用 service_role 访问）
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.app_users, public.user_sessions, public.question_bank,
  public.registration_challenges, public.registration_tickets, public.recovery_codes,
  public.rate_limit_buckets FROM PUBLIC;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

COMMIT;
