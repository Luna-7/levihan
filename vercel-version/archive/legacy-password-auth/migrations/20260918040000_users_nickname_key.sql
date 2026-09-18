-- 昵称唯一键显式化 + 清理上一版不可达的 rpc 函数。
--
-- 背景：node-sdk 的 app.rdb() 客户端只有 from()/select()/insert()/update()，
-- 没有 rpc()（实测 TypeError: db.rpc is not a function），所以 20260918030000 里的
-- register_with_password / rename_user / find_login_credential 永远调不到，这里直接删掉，
-- 改由云函数用普通的表读写完成，唯一性交给数据库索引兜底。
--
-- 同时把「大小写不敏感的昵称」从函数索引改成生成列：查询侧可以直接
--   select ... .eq('nickname_key', 'han')
-- 命中唯一索引，不必依赖 ilike（昵称里的 % / _ 会被当通配符）。

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS nickname_key text
  GENERATED ALWAYS AS (lower(btrim(nickname))) STORED;

DROP INDEX IF EXISTS public.users_nickname_lower_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_key_key ON public.users (nickname_key);

DROP FUNCTION IF EXISTS public.find_login_credential(text);
DROP FUNCTION IF EXISTS public.rename_user(text, text);
DROP FUNCTION IF EXISTS public.register_with_password(text, text, text);
