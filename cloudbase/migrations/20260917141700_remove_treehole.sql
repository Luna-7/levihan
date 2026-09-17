-- 树洞功能全量下线（2026-09-17）：
-- 1) 清空 submission_inbox 中的历史树洞投稿（5 条，功能删除后不再有消费方）
-- 2) type 约束收窄回 ('novel','contact')
DELETE FROM public.submission_inbox WHERE type = 'treehole';
ALTER TABLE public.submission_inbox DROP CONSTRAINT IF EXISTS submission_inbox_type_check;
ALTER TABLE public.submission_inbox
  ADD CONSTRAINT submission_inbox_type_check
  CHECK (type IN ('novel', 'contact'));
