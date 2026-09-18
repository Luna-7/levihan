-- 私有云端收件箱：前端只调用已鉴权云函数，不能直接访问投稿和联系方式。
CREATE TABLE IF NOT EXISTS public.submission_inbox (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('novel', 'treehole')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submission_inbox_pending_created_idx
  ON public.submission_inbox (created_at DESC) WHERE status = 'pending';
ALTER TABLE public.submission_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.submission_inbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.submission_inbox TO service_role;
