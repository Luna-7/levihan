# CloudBase backend v2

本目录的生产事实源是：

- `cloudbaserc.json`：唯一部署清单，仅部署 `app-api`、`snapshot-worker`、`upload-cleanup-worker`。
- `functions/app-api/`：模块化 API、后台任务与受控 PostgreSQL RPC adapter。
- `migrations/`：PostgreSQL v2 forward、runtime access 和 rollback 迁移。

账号采用答题注册、用户名密码和一次性恢复码；不使用邮箱、邀请码或静态管理员口令。
浏览器只经同源 `/api/v1` 代理访问 `app-api`，不会持有数据库或 COS 密钥。

## 历史兼容源码

远端旧版 nickname/password custom-login 函数及其两份 SQL 已移至
`../archive/legacy-password-auth/`，只为审计和遗留数据解释保留，永不进入本目录的函数根
或 v2 迁移序列。不得把它们部署为匿名注册/登录入口，否则会绕过答题注册、v2 session、
CSRF、频控和恢复码策略。需要迁移旧账号时，只使用 v2 的 `#/migrate-account` 三阶段流程。

完整部署、迁移、备份、COS、Vercel 和回滚流程见
[`../docs/operations/backend-v2-runbook.md`](../docs/operations/backend-v2-runbook.md)。
