-- 兵团战功榜
-- 参与游戏：daxigua（利韩·合成大西皮，全难度）、hange（利韩·拯救韩吉，仅绝境难度）
-- 利了个韩（lihan）暂不开放战功记录，因此不在 CHECK 约束里，避免脏数据入库。

-- 原始战绩流水（每人每局的提交记录，用于限流与审计）
CREATE TABLE IF NOT EXISTS public.game_scores (
  id          bigserial PRIMARY KEY,
  uid         text NOT NULL,
  nickname    text NOT NULL,
  game_key    text NOT NULL CHECK (game_key IN ('daxigua', 'hange')),
  merit       integer NOT NULL CHECK (merit >= 0 AND merit <= 1000),
  raw_score   jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_scores_uid_game_created_idx
  ON public.game_scores (uid, game_key, created_at DESC);

-- 每人每游戏的最好成绩（榜单直接读这张表）
CREATE TABLE IF NOT EXISTS public.game_best (
  uid          text NOT NULL,
  game_key     text NOT NULL CHECK (game_key IN ('daxigua', 'hange')),
  merit        integer NOT NULL CHECK (merit >= 0 AND merit <= 1000),
  raw_score    jsonb NOT NULL,
  achieved_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uid, game_key)
);
CREATE INDEX IF NOT EXISTS game_best_game_merit_idx
  ON public.game_best (game_key, merit DESC);

ALTER TABLE public.game_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_best ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_scores FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.game_best FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.game_scores TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.game_best TO service_role;
