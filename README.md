# Codex Backend Refactor

本文件说明 `codex/backend-refactor` 分支的来源、版本时间和主要改动。它是该分支的变更记录，不替代项目运行与部署文档。

## 版本基线

- 分支：`codex/backend-refactor`
- 远端：`origin/codex/backend-refactor`
- 工作树：`levihan/.worktrees/backend-redesign`
- 基于分支：`main`
- 基线提交：`aa81019f3d873336225146e007e0d9e68a06668d`
- 基线时间：2026-09-18 15:54:51（Asia/Shanghai）
- 当前分支提交：`fb3b7fba2fe119e72fe38e0519c6c9759a9b7a3d`
- 当前提交时间：2026-09-19 00:57:55（Asia/Shanghai）

分支随后在 `0c24d60` 合并了当时的 `origin/main`，并在 `fb3b7fb` 完成静态资源整理。新增本 README 前工作区干净，分支提交历史与对应远端分支同步。

## 改动概览

### 1. Backend V2 模块化运行时

新增 CloudBase `app-api` 统一入口和 `/api/v1` HTTP 内核，将认证、访问控制、作品、上传、快照、互动、投稿和管理台拆分为独立模块。

主要目录：

```text
vercel-version/cloudbase/functions/app-api/
  src/modules/auth/
  src/modules/access/
  src/modules/works/
  src/modules/uploads/
  src/modules/snapshots/
  src/modules/interactions/
  src/modules/submissions/
  src/modules/admin-console/
```

### 2. 认证、会话和权限安全

- 邀请码注册迁移为答题注册流程。
- 完善登录、注册、找回和恢复流程，绑定恢复操作与账号。
- 使用会话 Cookie、CSRF 双提交校验和 HMAC 会话哈希。
- 增加来源校验、CORS、CSP、HSTS、`nosniff` 等安全响应头。
- 移除硬编码管理员凭据。
- 对敏感内容增加会话、资源和年龄确认约束，并支持访问 TTL。
- 完善 COS v5 签名校验，避免越权访问受限资源。

### 3. 数据库迁移和最小权限

- 新增 Backend V2 数据库结构和切换迁移。
- 增加内容发布、快照、访问控制、互动、投稿和管理台相关表。
- 增加 RLS、`PUBLIC` 权限撤销、运行时最小权限和受控 `SECURITY DEFINER` 函数。
- 为迁移、切流、回滚和运行时授权提供配套 SQL 与验证脚本。

迁移文件位于 `vercel-version/cloudbase/migrations/`。

### 4. 幂等性和并发控制

- 支持 `none`、`supported`、`required` 三种幂等策略。
- 幂等记录绑定 HTTP 方法、路径、参数、查询、用户身份和请求体哈希。
- 支持处理中租约、过期重获、失败释放和完成后的 replay。
- 只允许显式声明的安全字段进入 replay，禁止持久化 Cookie、Token、签名 URL、`Location` 等敏感信息。
- 登录、注册、恢复和签名访问等流程明确关闭幂等重放。

### 5. 内容发布与回滚

- 增加事务化内容发布流水线。
- 引入不可变内容快照、发布前检查和状态追踪。
- 支持发布失败回滚、清理重试和并发回滚保护。
- 增加内容交付一致性、快照一致性和清理语义验证。

### 6. 用户互动、投稿和管理台

- 增加用户互动与阅读进度同步。
- 增加投稿收件箱、审核、批准、拒绝和重复提交保护。
- 用类型化 React 管理台替换静态管理台。
- 增加管理台 API、模块、权限和验证测试。

### 7. 测试与验证

分支新增了 API 合约、Schema、认证、访问控制、上传、快照、互动、投稿、管理台、COS 签名、迁移和安全扫描等测试。

实现报告中记录的最终验证结果：

- `app-api` 测试：85 项通过
- 完整测试套件：121 项通过
- TypeScript 类型检查通过
- Backend schema verifier 通过
- Secret scan 通过
- `git diff --check` 通过

## 相关文档

- 技术设计：`vercel-version/docs/superpowers/specs/2026-09-17-technical-backend-redesign.md`
- 实施计划：`vercel-version/docs/superpowers/plans/2026-09-17-backend-redesign-implementation.md`
- 部署与迁移：`vercel-version/docs/operations/backend-v2-runbook.md`
- 安全轮换：`vercel-version/docs/operations/security-rotation.md`
- CloudBase 配置：`vercel-version/cloudbase/README.md`

## 当前限制

静态 SQL 语义、迁移验证和并发逻辑测试已覆盖；但当前工作树没有可用的 staging PostgreSQL 服务，因此真实数据库迁移应用、并发租约和生产切流仍需在部署环境中执行。

本分支不会因为 Git push 自动执行生产迁移、公共 COS 源删除或域名切流，这些操作仍需按照运行手册进行人工确认。
