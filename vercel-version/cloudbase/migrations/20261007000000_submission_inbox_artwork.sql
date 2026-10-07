-- 插画投稿使用 artwork 类型进入审核收件箱。
-- 下线 treehole 后旧约束收窄为 novel/contact，导致图片已落桶但收件箱插入失败。
ALTER TABLE public.submission_inbox DROP CONSTRAINT IF EXISTS submission_inbox_type_check;
ALTER TABLE public.submission_inbox
  ADD CONSTRAINT submission_inbox_type_check
  CHECK (type IN ('novel', 'contact', 'artwork'));
