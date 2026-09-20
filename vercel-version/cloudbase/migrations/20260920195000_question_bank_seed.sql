-- ============================================================================
-- 题库种子数据（用户定稿 · 2026-09-20 18:27，答案序列 C B D C D）
--
-- 答案哈希 = HMAC-SHA256(AUTH_PEPPER, "question-answer\0" + 归一化答案) 的 hex。
-- 归一化规则 = trim_lowercase（去首尾空白 + 小写）。
-- 本文件的哈希是用当前 .env 里的 AUTH_PEPPER 计算的；换 pepper 需重算。
--
-- 正确答案（供人工核对，勿入库明文）：
--   1. 格斗、智慧（C）
--   2. Moppel; Engelchen（B）
--   3. 126话；自尊（D）
--   4. 相変わらず巨人とは片想いのまま…（C）
--   5. 焼きそばパン（D）
-- ============================================================================

INSERT INTO public.question_bank
  (prompt, options, accepted_answer_hashes, normalization_rule, status, version, sampling_weight)
VALUES
  ('公式书上，利威尔、韩吉两人分别什么属性（格斗/行动/脑力/协调/…）是 11？',
   '["格斗、脑力","洁癖、脑力","格斗、智慧","洁癖、智慧"]',
   ARRAY['3a3c8c102660e4d041ea9fc16c049b7eb68a8f7df123ad9daf5c8e001d751732'],
   'trim_lowercase', 'active', 1, 1),

  ('漫画王政篇中，利威尔、韩吉两人的接头外号分别是？',
   '["Titan killer; Glasses","Moppel; Engelchen","Black tea; Glasses","Baby face; Little angel"]',
   ARRAY['7ac6323389ae7a564995a5b3b6224da565bc8aaf3628406077851b3909b5038f'],
   'trim_lowercase', 'active', 1, 1),

  ('「ifkk」在漫画中是第几话？章节名「矜持」正确的中文翻译是？',
   '["115话；支撑","115话；角色","126话；火种","126话；自尊"]',
   ARRAY['5437583371cd5d3b6176820a23a23c2ced08b1577d6fb72f177b341780afe12b'],
   'trim_lowercase', 'active', 1, 1),

  ('「akkk」是什么的缩写？',
   '["分からないものがあれば…","いっそう二人で…","相変わらず巨人とは片想いのまま…","じゃあな、ハンジ。見ててくれ。"]',
   ARRAY['8b9ec9c8ba7ed96f05dbfc3304ef8f6ae6019e38c476db39b0c60c3e963a1789'],
   'trim_lowercase', 'active', 1, 1),

  ('巨人中学校里，韩吉找利威尔对试卷分数谁更高，用什么做赌注？',
   '["紅茶","巨人のエサ","さっちゃんイカ","焼きそばパン"]',
   ARRAY['e79037f8de08c0cc4e1961dbcbae57f211f36bbc23e889e2d9ca80d62f82419e'],
   'trim_lowercase', 'active', 1, 1)
ON CONFLICT DO NOTHING;
