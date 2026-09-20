-- ============================================================================
-- 题库种子数据（阶段 2 · auth 云函数配套）
--
-- 答案哈希 = HMAC-SHA256(AUTH_PEPPER, "question-answer\0" + 归一化答案) 的 hex。
-- 归一化规则 = trim_lowercase（去首尾空白 + 小写）。
-- 本文件的哈希是用当前 .env 里的 AUTH_PEPPER 计算的；换 pepper 需重算。
--
-- 答案（供人工核对，勿入库明文）：
--   1. 自由之翼
--   2. 兵长
--   3. 调查兵团第 14 任团长
--   4. 利威尔 × 韩吉
--   5. 利韩
-- ============================================================================

INSERT INTO public.question_bank
  (prompt, options, accepted_answer_hashes, normalization_rule, status, version, sampling_weight)
VALUES
  ('《进击的巨人》中，利威尔兵长所属的调查兵团，其自由之翼徽章代表什么？',
   '["自由之翼","驻屯兵","宪兵团","训练兵团"]',
   ARRAY['17aaf3903f3f4fc62ee4be97542f6aed3eeea50dc9cb1808496c5cb3881b0acb'],
   'trim_lowercase', 'active', 1, 1),

  ('利威尔兵长的人类最强称号，常被粉丝简称为？',
   '["兵长","团长","教官","队长"]',
   ARRAY['bc0f449eba584b4feaf05a83825e67e7bfa280e980a2df1330cfc7e8fbba69df'],
   'trim_lowercase', 'active', 1, 1),

  ('韩吉·佐耶在故事中的主要身份是？',
   '["调查兵团第 14 任团长","驻屯兵团团长","宪兵团团长","马莱战士"]',
   ARRAY['dd69912930c9aea8e0d3a07e07269e6bc2f337cf5aa8f3cbcfb769d8dad52a09'],
   'trim_lowercase', 'active', 1, 1),

  ('本网站「利韩土豆仓」的主角 CP 是？',
   '["利威尔 × 韩吉","艾伦 × 三笠","阿尔敏 × 阿尼","莱纳 × 贝尔托特"]',
   ARRAY['b7e598091817537d45e44df4544bf9f150f607883a791079203cfddf76b9d064'],
   'trim_lowercase', 'active', 1, 1),

  ('利威尔与韩吉的同人 CP 通常被称作？',
   '["利韩","艾利","利艾","团兵"]',
   ARRAY['bfa6b434a99c9cb0851bbceb184b130136e11f5a705d2df69239c095bf54ebcc'],
   'trim_lowercase', 'active', 1, 1)
ON CONFLICT DO NOTHING;
