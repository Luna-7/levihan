-- 收件箱支持「联络来信」：DispatchHub 呈递函（战术研讨 / 投递自作 / 商业定制等）
-- 原约束只允许 ('novel','treehole')，此处放宽加入 'contact'
ALTER TABLE public.submission_inbox DROP CONSTRAINT IF EXISTS submission_inbox_type_check;
ALTER TABLE public.submission_inbox
  ADD CONSTRAINT submission_inbox_type_check
  CHECK (type IN ('novel', 'treehole', 'contact'));
