💚💜 # Levi × Hans 💚💜

这里没什么特别的

就是喜欢利威尔和韩吉

所以放一些喜欢的东西

聊一点喜欢的话题

一起吃点粮

仅此而已

Only Levi × Hans.
Only for those who love them.

## Backend v2

项目正在迁移到“PostgreSQL 单一事实来源 + COS 双桶/短时签名 + CloudBase 模块化 API + React 管理后台”。账号采用答题注册、用户名密码和一次性恢复码，不依赖邮箱或邀请码；密码与恢复码同时丢失时账号无法找回。

- 技术与产品设计：[docs/superpowers/specs/2026-09-17-technical-backend-redesign.md](docs/superpowers/specs/2026-09-17-technical-backend-redesign.md)
- 部署、迁移、备份、切流与回滚：[docs/operations/backend-v2-runbook.md](docs/operations/backend-v2-runbook.md)
- 默认安全预检：`npm run migrate:backend-v2 -- --json`
- 数据对账：`npm run check:backend-v2 -- --input=<redacted-check-input.json> --json`
- R18 删除清单：`npm run generate:r18-cutover-manifest -- ...`
- COS 配置回读：`npm run verify:cos-backend-v2 -- ...`
- CloudBase 显式环境部署：`npm run deploy:cloudbase-v2 -- ...`

迁移命令默认只读 dry-run。生产写入、COS 公共源删除和域名切流均是分离的人工步骤；Git push 不会自动执行这些操作。
正式迁移使用仓库内 `scripts/adapters/backend-v2-cloudbase.mjs`，并在迁移窗口临时应用独立 migration-role grants；adapter 会核对真实数据库登录、schema 和环境，不复用应用运行角色的表 DML。Vercel 通过仓库内同源 `/api/v1` 代理连接精确配置的 CloudBase HTTPS gateway。旧论坛/排行榜在切流期冻结为只读，旧 `admin-upload` 与排行榜函数不再位于 CloudBase 部署清单。

资源外链：
<img width="805" height="427" alt="image" src="https://github.com/user-attachments/assets/12a29b3d-784b-48ef-88c5-85913a5f2cdc" />

土豆粮仓：
<img width="816" height="622" alt="image" src="https://github.com/user-attachments/assets/6eb7bbc9-dfc7-40cc-bc7f-7252bcba9974" />


塔塔开（游戏专区）：
<img width="288" height="534" alt="image" src="https://github.com/user-attachments/assets/305fb91e-4ef0-4633-b18a-9fab0670fcd3" />  <img width="282" height="528" alt="image" src="https://github.com/user-attachments/assets/d404f5de-3c73-4cb4-8e19-f2ce72b1243e" />
