# Backend Redesign Implementation Plan

> **Goal:** 将现有 Vercel + CloudBase + PostgreSQL + COS 项目重构为低成本、可维护、可扩展的模块化单体，交付仅答题注册、可靠会话、内容与素材管理、受限/R18 访问、互动、阅读进度、投稿和多管理员后台。
>
> **Architecture:** PostgreSQL 是业务事实源，COS 只保存文件和可重建的公开快照；统一的 CloudBase HTTP API 按领域拆分模块，前台和 React 管理端共用版本化契约。现有线上接口保留临时兼容适配器，数据库变更采用追加迁移和可回滚切换。
>
> **Tech Stack:** React 19, TypeScript 5.8, Vite 6, Vitest, CloudBase Node.js functions, PostgreSQL, COS/S3 SDK, Zod, Node crypto, Argon2id.
>
> **Spec:** `docs/superpowers/specs/2026-09-17-technical-backend-redesign.md`
>
> **Global constraints:** 用户量不超过 1k；优先复用现有云资源；不引入常驻服务器、队列或 Redis；多个管理员暂不区分权限；注册仅使用随机题库，不使用邮箱、手机号或邀请；用户接受遗失密码和恢复码后账号不可找回；R18 内容必须登录、声明成年并通过私有 COS 签名 URL 访问。

## Delivery order

每个阶段都必须遵循：先写失败测试，再写最小实现，再运行目标测试和全量验证，再提交。不得把数据库密钥、COS 密钥、管理员口令或签名密钥写入仓库。

### Task 1: 建立测试与共享契约基础

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `src/shared/contracts/api.ts`
- Create: `src/shared/contracts/schemas.ts`
- Create: `src/shared/contracts/schemas.test.ts`
- Create: `src/shared/api/errors.ts`

**Steps:**
1. 为注册挑战、注册、登录、恢复码、作品摘要、评论、阅读进度、投稿和管理操作定义输入输出类型及 Zod schema。
2. 先写 schema 的成功、缺字段、越界和未知字段测试，执行 `npm test -- schemas.test.ts` 并确认失败。
3. 添加 Vitest/Zod 和测试脚本，实现最小 schema，确认目标测试通过。
4. 运行 `npm run lint && npm test -- --run`。
5. Commit: `test: add shared API contracts and validation harness`。

### Task 2: 添加 PostgreSQL v2 追加迁移

**Files:**
- Create: `cloudbase/migrations/20260918_backend_v2.sql`
- Create: `cloudbase/migrations/20260918_backend_v2_rollback.sql`
- Create: `cloudbase/migrations/README.md`
- Create: `scripts/verify-backend-schema.mjs`
- Create: `scripts/verify-backend-schema.test.ts`
- Modify: `package.json`

**Steps:**
1. 先写静态迁移验证测试，要求 migration 包含约束、索引、更新时间触发器和 RLS/最小权限说明，确认测试失败。
2. 新建追加式表：`app_users`、`user_sessions`、`registration_questions`、`registration_challenges`、`registration_attempts`、`account_recovery_codes`、`age_consents`、`works`、`work_assets`、`tags`、`work_tags`、`likes`、`favorites`、`comments`、`reading_progress`、`submissions`、`submission_assets`、`upload_tickets`、`snapshot_versions`、`reports`、`audit_logs`、`rate_limit_buckets`。
3. 使用 UUID 主键、明确外键删除策略、唯一约束、状态 CHECK、常用查询复合索引；交互计数先查询计算，不新增缓存系统。
4. 添加原子消费注册挑战、轮换会话、消费恢复码、幂等点赞/收藏/进度 upsert 的 SQL 函数。
5. 回滚文件只移除本迁移新对象，不碰旧表；README 记录备份、预演、执行和校验顺序。
6. 运行 schema 验证测试并提交：`feat: add backend v2 database schema`。

### Task 2A: 立即清除仓库中的明文管理凭据

**Files:**
- Modify: `.workbuddy/tests/test-admin-channel.py`
- Modify: `.workbuddy/tests/test-admin-ui.cjs`
- Modify: `.workbuddy/tests/shots-admin.cjs`
- Modify: `.env.example`
- Modify: `docs/operations/backend-v2-runbook.md` if it already exists, otherwise create `docs/operations/security-rotation.md`
- Create: `scripts/verify-no-secrets.mjs`
- Create: `scripts/verify-no-secrets.test.ts`
- Modify: `package.json`

**Steps:**
1. 先写扫描测试并确认它能发现当前硬编码管理员口令；扫描工作树时排除 `.git`、依赖、构建产物和明确的假值样例。
2. 三个远程/截图脚本改为读取 `ADMIN_TEST_PASSWORD`；缺失时远程测试清晰跳过，交互截图脚本清晰失败，不再提供默认口令。
3. 文档要求立即轮换旧管理员口令、撤销现有 token，并说明删除当前文件不能清理 Git 历史；是否重写公开历史必须单独评估并协调所有协作者。
4. 添加 `verify:secrets` 脚本并运行测试、扫描和 lint。
5. 提交：`security: remove hardcoded admin credential`。

### Task 3: 构建统一 API 内核

**Files:**
- Create: `cloudbase/functions/app-api/package.json`
- Create: `cloudbase/functions/app-api/index.js`
- Create: `cloudbase/functions/app-api/src/config.js`
- Create: `cloudbase/functions/app-api/src/http.js`
- Create: `cloudbase/functions/app-api/src/router.js`
- Create: `cloudbase/functions/app-api/src/errors.js`
- Create: `cloudbase/functions/app-api/src/security.js`
- Create: `cloudbase/functions/app-api/src/repositories/db.js`
- Create: `cloudbase/functions/app-api/test/http.test.js`
- Create: `cloudbase/functions/app-api/test/security.test.js`

**Steps:**
1. 先覆盖请求解析、JSON 响应、请求 ID、CORS allowlist、安全响应头、cookie、CSRF 双提交校验、统一错误映射和隐藏内部错误的测试。
2. 实现 `/api/v1` 路由器及中间件链；只从环境变量读取数据库、COS、会话和 CORS 配置，启动时校验缺失配置。
3. 限流通过 PostgreSQL 时间桶完成；对注册挑战、注册、登录、评论、投稿和签名 URL 设置不同阈值。
4. 日志只记录请求 ID、路由、耗时、状态、用户/管理员 ID 哈希，不记录密码、答案、token、cookie 或正文。
5. 运行函数测试并提交：`feat: add modular API runtime`。

### Task 4: 实现仅答题账号体系

**Files:**
- Create: `cloudbase/functions/app-api/src/modules/auth/service.js`
- Create: `cloudbase/functions/app-api/src/modules/auth/routes.js`
- Create: `cloudbase/functions/app-api/src/modules/auth/repository.js`
- Create: `cloudbase/functions/app-api/src/modules/auth/passwords.js`
- Create: `cloudbase/functions/app-api/src/modules/auth/session.js`
- Create: `cloudbase/functions/app-api/test/auth.test.js`
- Create: `src/features/auth/api.ts`
- Rewrite: `src/components/UserEntry.tsx`
- Create: `src/features/auth/UserEntry.test.tsx`

**Steps:**
1. 测试挑战只返回题目和 challenge ID、不泄露答案；挑战一次性、短时有效、按题库随机抽题；错误答案和滥用会被限流。
2. 测试用户名规范化与唯一性、Argon2id 密码哈希、恢复码只保存哈希、注册成功仅展示一次恢复码。
3. 测试登录、登出、`/me`、会话轮换、CSRF、恢复码重置密码并撤销旧会话。
4. 实现 `POST /auth/quiz-challenges`、`POST /auth/register`、`POST /auth/login`、`POST /auth/logout`、`GET /auth/me`、`POST /auth/recover`。
5. 重写前台入口为“答题 → 用户名/密码 → 保存恢复码”，删除手机号、短信、邀请码交互和文案。
6. 保留旧 `users`/邀请表只读迁移能力，但任何新注册不得调用旧邀请函数。
7. 运行前后端目标测试并提交：`feat: replace invite auth with quiz registration`。

### Task 5: 实现作品、上传、发布和快照

**Files:**
- Create: `cloudbase/functions/app-api/src/modules/works/routes.js`
- Create: `cloudbase/functions/app-api/src/modules/works/service.js`
- Create: `cloudbase/functions/app-api/src/modules/works/repository.js`
- Create: `cloudbase/functions/app-api/src/modules/uploads/routes.js`
- Create: `cloudbase/functions/app-api/src/modules/uploads/service.js`
- Create: `cloudbase/functions/app-api/src/modules/snapshots/service.js`
- Create: `cloudbase/functions/app-api/test/works.test.js`
- Create: `cloudbase/functions/app-api/test/uploads.test.js`
- Create: `cloudbase/functions/app-api/test/snapshots.test.js`
- Create: `src/features/works/api.ts`

**Steps:**
1. 测试草稿、审核、发布、下线状态机，确保非法跃迁失败且所有管理变更写审计日志。
2. 测试上传票据只允许白名单 MIME、扩展名、大小、对象前缀和短有效期；客户端直传 COS staging，API 不接受 Base64 大文件。
3. 测试完成上传时校验对象元数据并绑定 `work_assets`；发布前要求素材已完成。
4. 测试快照稳定排序、schema version、内容 hash、版本留存；生成临时对象后原子切换 current 指针，失败不覆盖旧快照。
5. 实现公开作品读接口、管理员 CRUD、上传票据、发布/下线和快照重建接口。
6. 提交：`feat: add transactional content publishing pipeline`。

### Task 6: 实现 R18 和受限内容访问

**Files:**
- Create: `cloudbase/functions/app-api/src/modules/access/routes.js`
- Create: `cloudbase/functions/app-api/src/modules/access/service.js`
- Create: `cloudbase/functions/app-api/src/modules/access/policy.js`
- Create: `cloudbase/functions/app-api/test/access.test.js`
- Create: `src/features/access/AgeGate.tsx`
- Create: `src/features/access/api.ts`

**Steps:**
1. 用表驱动测试覆盖公开、登录可见、R18、管理员、下线作品的访问矩阵。
2. R18 首次访问要求登录并记录“已满 18 岁”的版本化同意；未同意不得获得私有素材 URL。
3. 私有 COS 对象仅返回分钟级签名 URL，响应禁止缓存；数据库和公开快照永不存永久私有 URL。
4. 明确该年龄门只降低误触风险，不替代实名年龄核验或当地法律合规。
5. 提交：`feat: enforce restricted and adult content access`。

### Task 7: 实现互动、跨设备进度和举报

**Files:**
- Create: `cloudbase/functions/app-api/src/modules/interactions/routes.js`
- Create: `cloudbase/functions/app-api/src/modules/interactions/service.js`
- Create: `cloudbase/functions/app-api/src/modules/interactions/repository.js`
- Create: `cloudbase/functions/app-api/test/interactions.test.js`
- Create: `src/features/interactions/api.ts`
- Modify: `src/components/MangaCommentSection.tsx`
- Create: `src/hooks/useReadingProgress.ts`

**Steps:**
1. 测试点赞/收藏幂等切换和唯一约束，评论字符/频率限制，删除软删除，计数不包含隐藏内容。
2. 新账号、命中风险词或频率异常的评论进入 pending；其他低风险评论自动发布，管理员可隐藏/恢复。
3. 测试阅读进度按 `(user_id, work_id)` upsert，服务端时间和客户端版本防止旧设备覆盖较新进度。
4. 实现举报接口和去重；把现有漫画评论切换到统一 API，同时保留论坛/排行榜功能。
5. 提交：`feat: add user interactions and synced progress`。

### Task 8: 实现投稿闭环

**Files:**
- Create: `cloudbase/functions/app-api/src/modules/submissions/routes.js`
- Create: `cloudbase/functions/app-api/src/modules/submissions/service.js`
- Create: `cloudbase/functions/app-api/src/modules/submissions/repository.js`
- Create: `cloudbase/functions/app-api/test/submissions.test.js`
- Create: `src/features/submissions/SubmissionForm.tsx`
- Create: `src/features/submissions/api.ts`
- Modify: `src/App.tsx`

**Steps:**
1. 测试登录限制、每日配额、草稿/提交/审核/接受/拒绝/撤回状态机，以及素材归属检查。
2. 投稿素材复用私有 staging 直传；接受投稿时在同一事务内创建作品草稿和审计事件，不自动公开。
3. 前台增加投稿表单、上传进度、状态列表和失败重试提示。
4. 提交：`feat: add moderated submission workflow`。

### Task 9: 重建 React 管理后台

**Files:**
- Create: `src/admin/main.tsx`
- Create: `src/admin/AdminApp.tsx`
- Create: `src/admin/api/client.ts`
- Create: `src/admin/routes.tsx`
- Create: `src/admin/features/dashboard/*`
- Create: `src/admin/features/works/*`
- Create: `src/admin/features/submissions/*`
- Create: `src/admin/features/comments/*`
- Create: `src/admin/features/users/*`
- Create: `src/admin/features/questions/*`
- Create: `src/admin/features/audit/*`
- Create: `admin.html`
- Modify: `vite.config.ts`
- Deprecate: `public/admin/index.html`
- Create: `src/admin/AdminApp.test.tsx`

**Steps:**
1. 先测试未登录跳转、管理员守卫、列表分页/筛选、表单错误、乐观更新回滚和危险操作二次确认。
2. 提供仪表盘、作品/章节/素材、投稿、评论/举报、用户、题库、快照和审计日志模块。
3. 管理员均为相同权限；鉴权来自服务端会话和数据库角色，不再使用静态管理口令。
4. 所有变更通过统一 `/api/v1/admin/*`，禁止浏览器直接拿数据库或 COS 密钥。
5. 旧静态后台保留一个版本的只读跳转，然后删除其写接口依赖。
6. 提交：`feat: replace static admin with typed React console`。

### Task 10: 数据迁移与兼容收口

**Files:**
- Create: `scripts/migrate-backend-v2.mjs`
- Create: `scripts/migrate-backend-v2.test.ts`
- Create: `scripts/check-backend-v2.mjs`
- Create: `cloudbase/functions/app-api/src/compat/legacy-users.js`
- Modify: `README.md`
- Create: `docs/operations/backend-v2-runbook.md`
- Modify/Delete after cutover: `cloudbase/functions/consumeInviteCode/*`
- Modify/Delete after cutover: `cloudbase/functions/generateInviteCode/*`
- Modify/Delete after cutover: `cloudbase/functions/validateRegistrationInvite/*`
- Modify/Delete after cutover: `cloudbase/functions/verifyInviteCode/*`

**Steps:**
1. 迁移器默认 dry-run，输出数量和冲突，不打印个人数据；正式模式要求显式确认环境和备份标记。
2. 现有可识别账号迁到 `app_users` 的 legacy 状态；由于旧 CloudBase 身份无法导出密码，不伪造密码，要求通过一次性受控迁移流程设置新凭据。
3. 数据校验脚本比较作品、素材、评论、用户和发布快照数量，并检查孤儿外键和重复键。
4. README/运维手册记录环境变量、部署顺序、回滚、备份恢复、密钥轮换、COS CORS/生命周期和告警阈值。
5. 切流验证完成后停止邀请相关入口；保留数据库旧表直至至少一次备份保留周期结束。
6. 提交：`chore: add backend v2 migration and operations runbook`。

### Task 11: 全量验证、安全审计和推送

**Files:**
- Modify as required by findings only.

**Steps:**
1. 执行 `npm ci`、`npm run lint`、`npm test -- --run`、`npm run verify:schema`、`npm run verify:levels`、`npm run build`。
2. 执行函数测试、依赖漏洞检查和仓库敏感信息扫描；确认构建产物不含管理员口令、数据库密钥、COS secret 或测试 token。
3. 人工核对注册、登录、恢复、登出、成年确认、受限阅读、点赞、收藏、评论、进度、投稿、管理发布和快照回滚主路径。
4. 检查 `git diff origin/main...HEAD`、工作区清洁度和提交历史；只修复本次重构引入的问题。
5. 推送 `codex/backend-redesign` 到 `origin`，不合并主分支；输出远端分支和验证结果。

## Release checkpoints

- **Checkpoint A — foundation:** Tasks 1–4 完成，账号系统可以在测试环境独立运行。
- **Checkpoint B — content:** Tasks 5–6 完成，内容发布和受限素材闭环可用。
- **Checkpoint C — community:** Tasks 7–9 完成，用户和管理员主要业务闭环可用。
- **Checkpoint D — cutover:** Tasks 10–11 完成，迁移、回滚、验证和推送齐全。

任何 checkpoint 未通过，都不得删除旧数据或把流量切到 v2。生产数据库迁移、CloudBase 部署、COS 策略变更和域名切流不由本地 git push 自动执行，必须按 runbook 单独操作。
