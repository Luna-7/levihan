# LeviHan CloudBase 接入

可部署源码已统一收拢到 `vercel-version/`。CloudBase v2 的唯一生产部署清单是
`vercel-version/cloudbase/cloudbaserc.json`，只包含模块化 `app-api`、快照 worker
和上传清理 worker。

注册采用答题、用户名密码和一次性恢复码，不使用邮箱或邀请码。仓库中保留的
`registerWithPassword`、`loginWithPassword`、旧邀请函数及根目录 `cloudfunctions/`
仅用于审计远端历史兼容实现，未列入生产部署清单，不得单独部署形成旁路。

部署、环境变量、数据库迁移、COS 双桶和回滚步骤见
[`vercel-version/docs/operations/backend-v2-runbook.md`](vercel-version/docs/operations/backend-v2-runbook.md)。
