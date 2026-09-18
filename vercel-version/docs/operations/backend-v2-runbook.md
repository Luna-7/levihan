# Backend v2 运维、迁移与切流手册

## 1. 目标和边界

本手册适用于不超过 1,000 名注册用户的利韩土豆仓。目标架构是一个 CloudBase API 部署单元、一个 PostgreSQL 数据库、COS 公共桶与私有桶，以及 Vercel 前台/管理台。PostgreSQL 是业务事实来源；COS 只保存对象与不可变公开快照。

不引入 Redis、消息队列、微服务或外部年龄验证。R18 年龄声明只是用户自我声明，不是实名年龄核验，也不替代所在地法律、平台条款、版权授权和内容治理义务。

## 2. 环境和密钥

生产和非生产必须分别配置，禁止把值提交到 Git：

| 变量 | 用途 |
|---|---|
| `CLOUDBASE_APIKEY` | CloudBase 服务端访问 |
| `DATABASE_SCHEMA` | PostgreSQL schema/database 选择 |
| `COS_PUBLIC_BUCKET` | 公共素材和不可变快照 |
| `COS_PRIVATE_BUCKET` | R18、投稿和 staging 对象 |
| `COS_REGION` | COS region |
| `API_ALLOWED_ORIGINS` | 精确 Origin 白名单 |
| `SESSION_HASH_PEPPER` | session HMAC 域密钥，至少 32 字符 |
| `AUTH_HASH_PEPPER` | 注册票据与普通恢复码 HMAC 域密钥 |
| `MIGRATION_HASH_PEPPER` | adapter 与 API 共同使用的 legacy ID、对象 key、迁移凭据域密钥；两端必须是同一个至少 32 字符的值 |
| `RATE_LIMIT_PEPPER` | IP/主体限流哈希 |
| `SESSION_COOKIE_DOMAIN` | 生产 Cookie domain |
| `SESSION_COOKIE_NAME` / `CSRF_COOKIE_NAME` / `MIGRATION_COOKIE_NAME` | 普通会话、CSRF 与短期迁移 claim Cookie 名称 |
| `SNAPSHOT_SYSTEM_ACTOR_ID` | worker 系统账号 UUID |
| `LEGACY_MIGRATION_ENABLED` | 仅迁移窗口设为 `true`，切流后立即 `false` |
| `CLOUDBASE_ENV_ID` / `CLOUDBASE_APIKEY` / `COS_SECRET_ID` / `COS_SECRET_KEY` | 迁移专用 CloudBase 身份与最小 COS 权限；不得复用控制台管理员身份 |
| `MIGRATION_EXPECTED_DB_ROLE` | 专用数据库登录角色；必须与数据库 context 和 `session_user` 同时一致 |
| `MIGRATION_CREDENTIAL_PUBLIC_KEY` | 迁移凭据离线交付用 RSA 公钥；数据库只保存密文与域哈希 |
| `LEGACY_SOURCE_MANIFEST` / `MIGRATION_RUN_ID` / `MIGRATION_TARGET_ENVIRONMENT` | 受控 JSON/COS 清单路径、checker 对账 run UUID，以及必须与 CLI `nonprod|prod` 完全一致的目标环境护栏 |
| `CLOUDBASE_API_BASE_URL` | Vercel serverless 同源代理的精确 HTTPS CloudBase `/api/v1` gateway；不得指向前台自身 |
| `API_PROXY_HMAC_SECRET` | Vercel 与 app-api 共享的代理 IP HMAC 密钥，至少 32 字符；与其他 pepper 分离 |
| `CLOUDBASE_PROD_ENV_ID` / `CLOUDBASE_NONPROD_ENV_ID` | 部署脚本的受控环境映射；不能由 CLI 的 `environment` 标签替代 |

数据库部署角色、运行角色、迁移角色分离。运行角色只执行已授权 RPC，不持有迁移表 DML。COS SecretId/SecretKey 只存在 CloudBase secret 管理中；浏览器只得到精确 key、类型、大小和短 TTL 的上传表单或签名 URL。

轮换顺序：创建新 secret → 部署非生产并 smoke → 部署生产 → 撤销旧 secret → 检查 401/403/5xx 和审计。轮换 pepper 会使旧 session/票据失效，必须安排维护窗口并明确通知。

## 3. 发布顺序

1. 记录当前 Git SHA、数据库版本、快照版本和 COS 清单版本。
2. 创建 PostgreSQL 逻辑备份并验证可读取；记录非敏感 `backup-id`。
3. 在非生产依次应用基础、内容、访问、互动、投稿、后台和 cutover 增量迁移及 runtime grants；迁移窗口单独应用 `20260918_backend_v2_cutover_migration_access.sql`，完成后立即执行其 rollback 撤权。
4. 通过显式 env-id 的部署门部署 CloudBase，禁止直接依赖 `cloudbaserc.json` 的默认环境：

```sh
npm run deploy:cloudbase-v2 -- --apply=DEPLOY_BACKEND_V2 --environment=nonprod --env-id="$CLOUDBASE_NONPROD_ENV_ID"
# 生产额外加 --prod-confirm=PRODUCTION_CLOUDBASE_DEPLOY
```

脚本不信任 `--environment` 自报标签，而是用 `CLOUDBASE_PROD_ENV_ID/CLOUDBASE_NONPROD_ENV_ID` 判定真实目标；未知或错配 ID 拒绝，生产 ID 必须二次确认。部署前会逐项检查 `cloudbaserc.json` 所需本地绑定非空、pepper/HMAC 最小长度、UUID/整数/布尔安全值，并强制 `TRUST_PROXY_HEADERS=true`、`CSRF_REQUIRED=true`。`SESSION_COOKIE_DOMAIN` 是唯一可选绑定：留空表示 host-only，回读时允许该键缺失或值为空；显式配置时必须原值回读。脚本先用 `tcb fn list --env-id ... --json` 枚举目标环境；只允许 v2 的 `app-api`、`snapshot-worker`、`upload-cleanup-worker`（部署前可缺少其中部分），发现旧邀请、nickname/password、admin-upload、评论/排行榜写函数或任何未知函数即停止，绝不自动删除。先在控制台停用其 HTTP/timer 触发器，再人工执行脚本错误中列出的 `tcb fn delete <name> --env-id <id> --yes`，复查清单后重跑。脚本随后在 `cloudbase/` cwd 使用官方 `tcb fn deploy --force --yes` 与 `tcb fn detail --env-id`，逐个按结构化字段精确检查 HTTP 类型、gateway/handler、触发器精确集合、env key 精确集合，以及回读的 `TRUST_PROXY_HEADERS=true`；最后再次枚举并要求远端函数集合与三个 v2 函数完全相等。缺少、多出或值错误都失败。无法解析为结构化输出时一律失败，不用任意文本包含关系放行。输出仅在进程内校验，不回显可能包含的配置值。旧 custom-login 源码和 SQL 仅在 `archive/legacy-password-auth/`，永不部署或进入 v2 迁移序列。
5. 部署 Vercel Preview，执行第 12 节 smoke。
6. 运行默认 dry-run 和对账器；Critical 必须为 0。
7. 生产人工审批后重复数据库迁移、API、worker、Vercel 发布。
8. 保持旧 JSON 只读回退窗口；确认 v2 快照、登录和后台后再切流。

Git push 不执行数据库变更、COS 删除或域名切流。

## 4. 数据库应用与回滚

迁移文件按以下精确顺序应用，每个文件必须完整成功：`20260918_backend_v2.sql` → `content_pipeline.sql` → `content_access.sql` → `interactions.sql` → `submissions.sql` → `admin_console.sql` → `backend_v2_cutover.sql`，每项紧接对应 `*_runtime_access.sql`。不要从 SQL 文件中复制部分语句。运行权限示例：

```sh
psql "$DATABASE_URL" --set=backend_role=levihan_runtime --file cloudbase/migrations/20260918_backend_v2_cutover_runtime_access.sql
```

迁移窗口使用由 CloudBase RDB binding 映射到专用 PostgreSQL 登录 `levihan_migration` 的独立服务身份。该登录必须 `LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`、不得是任何角色成员、不得拥有 `public` schema 中的表/分区/序列/函数，也不得直接持有任一业务或迁移表的 INSERT/UPDATE/DELETE/TRUNCATE 或任一序列的 USAGE/UPDATE。先由部署角色配置数据库认可的环境/登录，再启动 adapter；adapter 首个调用会比较参数、持久 context 与实际 `session_user`，并在数据库内遍历 `public` 对象复核角色属性、membership、ownership 和权限，高权角色或错环境都会失败：

```sh
psql "$DATABASE_URL" --set=environment=nonprod --set=migration_role=levihan_migration --file cloudbase/migrations/20260918_backend_v2_cutover_migration_access.sql
```

迁移完成后先执行 `backend_v2_cutover_migration_access_rollback.sql` 撤 migration RPC，再按逆序撤 cutover runtime → admin → submissions → interactions → content access → content pipeline → base runtime grant；只有数据 fence 为空时才按同一逆序运行结构 rollback。CloudBase 专用 API key 的 RDB binding 必须固定到该登录，adapter 同时要求 `CLOUDBASE_APIKEY`、`DATABASE_SCHEMA` 与 `MIGRATION_EXPECTED_DB_ROLE`，不能通过浏览器或普通 app-api 触发迁移。

回滚先撤 runtime grant，再运行对应 rollback。cutover rollback 带数据 fence：只要存在 identity mapping、迁移凭据、迁移 run/checkpoint 或 `migration_required` 用户就拒绝回滚。基础 rollback 也会先以 `ACCESS EXCLUSIVE` 锁定全部 v2 核心/SSOT/会话/恢复/内容/互动/投稿/审计表；任一表非空即以 `rollback_requires_backend_v2_backup_restore` 停止，必须先完成可验证的备份恢复演练或选择前滚修复，不得删 fence、漏锁表或强制 DROP 绕过。

普通成员会话有效期由数据库固定为 30 天，管理员会话固定为 8 小时；API 请求体不得提供或覆盖 expiry。成员提升为管理员会撤销其既有成员会话，重新登录后才获得 8 小时管理员会话。提升操作要求当前管理员再次提交自己的密码，后端 Argon2 校验后只给当前具体 session 写入 5 分钟、单次 nonce，再由数据库 RPC 校验并消费；不得使用浏览器 boolean 代替重新认证。

注册、恢复和 legacy 安装产生的恢复码只在 React 内存中显示一次，不写入 localStorage/sessionStorage。恢复码尚未确认且页面刷新/丢失时，保留的未确认 HttpOnly session 可通过 `/api/v1/auth/recovery-regenerate` 提交当前密码重新认证：数据库原子作废旧码、写入新码并审计。已确认账号不能使用该入口，必须走正常恢复或后续受控轮换流程。

后台 `/api/v1/admin/settings` 只允许公告、成人内容策略版本和已列出的功能开关，使用 version CAS 并审计；`/api/v1/admin/health` 仅返回数据库、快照、迁移、任务与 COS 公私桶可用性/CORS 配置的安全状态，不返回桶名、凭据、token 或对象 key。

应用前后运行：

```sh
npm run verify:backend-schema
npm test -- --run
```

## 5. 备份与恢复演练

生产 apply 前必须同时具备：

- PostgreSQL 平台快照和加密逻辑导出；
- 公共/私有 COS 对象清单（key 只保存在受控清单，不写日志）；
- 关键 COS 前缀版本保护或单独复制；
- `backup-id`、Git SHA、数据库迁移版本、快照版本的变更单记录。

每季度恢复到隔离环境：恢复数据库 → 使用只读凭据加载 COS 清单 → 随机核对 size/checksum/magic → 重建公开快照 → 执行 checker 和核心 smoke。记录恢复点目标、实际耗时和差异；演练环境不得向生产域名发 Cookie。

## 6. 迁移器

### 6.1 Dry-run

零配置 dry-run 读取仓库中的 legacy archive，只输出聚合数量和冲突类型：

```sh
npm run migrate:backend-v2 -- --json
```

可用 `--source-manifest=<path>` 读取受控导出。输出不会包含用户名、评论正文、题库答案、token、checksum 或 object key。

### 6.2 Apply 确认门

正式运行必须传入部署专用 adapter。非生产示例：

```sh
npm run migrate:backend-v2 -- \
  --apply --environment=nonprod \
  --backup-id=backup-20260918 \
  --ack=MIGRATE_BACKEND_V2 \
  --adapter=/absolute/path/to/repository/scripts/adapters/backend-v2-cloudbase.mjs
```

生产还必须追加：

```text
--prod-confirm=PRODUCTION_BACKEND_V2_CUTOVER
```

仓库提供可部署的 `scripts/adapters/backend-v2-cloudbase.mjs`；它从环境 secret 初始化 CloudBase/RDB/COS，源数据库仅只读，目标数据库只能执行 migration role 获准的 RPC，连接/COS 操作均有超时。adapter 导出 `createMigrationAdapter()`，并实现：

- `readSource()`：读取 CloudBase/JSON/COS 清单，返回 users、works、assets、comments、forumPosts、leaderboardEntries；
- `acquireLock()` / `releaseLock()`：数据库 session advisory lock，保证单实例；
- `beginRun()`：以规范化 source digest + batch-plan digest 创建或恢复 run；任何 source、顺序或 batch size 变化均拒绝沿用 checkpoint；
- `applyBatch(batch)`：受控 RPC 在一个数据库事务完成 upsert、审计和 checkpoint，提交后返回 `{checkpoint: batch.key}`；用户批次同时创建最长 14 天的一次性凭据，明文仅在进程内生成，RSA 密文与哈希随批次原子保存，返回 `{credentialsIssued: batch.items.length}`；
- `copyToPrivate()` / `verifyPrivateObject()`：R18 公共对象复制到私有桶后复核 size、checksum、MIME 和 magic。

adapter 不得记录原始行或对象 key。失败时迁移器释放 durable lease，checkpoint 以前的批次不重放；当前批次由事务整体回滚。不同 payload 不得共用 checkpoint。restricted publish 是所有 assets 批次之后的独立 finalize 批次，RPC 再次校验数据库内私有 active 集合。

### 6.3 数据映射

- 账号：保存 legacy ID 的域哈希映射，`credential_state=migration_required`，不伪造或导入无法导出的密码。
- 迁移凭据：由受控 adapter 生成高熵明文并仅通过受控离线渠道交付；数据库只保存域哈希，短期、单次、限尝试。日志和报告不得出现明文。
- 用户先向 `/api/v1/auth/legacy-credentials/session` 提交一次性迁移凭据并得到 10 分钟 HttpOnly claim cookie；再以 CSRF 调用 `/prepare`，客户端在账号变更前取得并确认保存恢复码和短期 prepare nonce；最后调用安装接口提交新密码、恢复码和 nonce。数据库只保存恢复码/nonce 哈希。安装提交后即使 HTTP 响应丢失，用户仍持有密码和恢复码，可走恢复流程，不会永久锁死。三个入口都受限流，切流后以 `LEGACY_MIGRATION_ENABLED=false` 关闭。
- 用户可从登录框进入 `#/migrate-account` 完成上述三阶段。恢复码与 prepare nonce 仅保存在 React 组件内存；必须勾选“已安全保存”才能安装。安装响应不确定时页面保留恢复码并切换到普通恢复 API，不重复消费迁移凭据。

迁移 apply 的安全摘要会输出非敏感 `runId`。离线交付的可执行流程如下；私钥只能在隔离工作站生成和保存，不能进入 CloudBase、数据库、Git 或普通日志：

```sh
umask 077
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /secure/migration-private.pem
openssl pkey -in /secure/migration-private.pem -pubout -out /secure/migration-public.pem
export MIGRATION_CREDENTIAL_PUBLIC_KEY="$(cat /secure/migration-public.pem)"
npm run export:backend-v2-credentials -- --mode=export --run-id=<runId> --adapter=/absolute/path/scripts/adapters/backend-v2-cloudbase.mjs --output=/secure/encrypted.json --ack=EXPORT_ENCRYPTED_MIGRATION_CREDENTIALS
# 仅在断网交付工作站执行：
npm run export:backend-v2-credentials -- --mode=decrypt --input=/secure/encrypted.json --private-key=/secure/migration-private.pem --output=/secure/plaintext-delivery.json --ack=DECRYPT_TO_OFFLINE_SECURE_SINK
```

逐人核验既有站内身份后使用独立渠道交付，不在邮件群发、工单或聊天日志粘贴明文。交付台账只记 legacy hash/时间/操作者。窗口关闭并确认未决凭据为零后安全销毁明文文件和私钥，保留密文、审计和备份周期记录。
- 作品/章节/素材：保留稳定 slug；章节先于素材迁移，素材通过 legacy chapter hash 绑定；拒绝 UUID 形 slug、重复页序、孤儿关联、非法目标前缀和缺失元数据。
- 评论：正文迁入受控表，报告只显示数量；软删除/审核状态保持。
- 论坛与排行榜：保留稳定 legacy hash、时间和数值；无法证明归属的数据不绑定 v2 用户。
- 题库答案不经过通用迁移输出；只由管理后台的域哈希流程创建新版本。

## 7. R18 对象迁移和删除

R18 顺序固定：读取公共源 → 复制到私有 `protected/works/...` → 私有对象 size/checksum/MIME/magic 复核 → 同一数据库事务绑定 active/private asset → 完整性检查 → 作品从 restricted/draft 发布。`lh-001` 或任何受限作品只要缺一项，就保持 restricted/draft，不回退公共 COS。

迁移器从不删除公共源。先由源 manifest 生成权限为 `0600` 的删除清单；生成器逐项重新读取私有副本并校验 bytes，不接受手写 `privateVerified`：

```sh
npm run generate:r18-cutover-manifest -- --environment=nonprod --source-manifest=/secure/source.json --backup-id=backup-20260918 --output=/secure/r18-delete.json --adapter=/absolute/path/scripts/adapters/backend-v2-cloudbase.mjs
```

记录命令输出的 SHA-256 到变更单。删除是独立 cutover，要求备份、不可变清单 SHA-256、再次复核私有副本以及生产二次确认：

```sh
node scripts/cutover-private-assets.mjs \
  --apply --environment=prod \
  --manifest=/secure/r18-delete-manifest.json \
  --manifest-sha256=<sha256> \
  --backup-id=backup-20260918 \
  --ack=DELETE_VERIFIED_PUBLIC_R18_SOURCES \
  --prod-confirm=PRODUCTION_R18_PUBLIC_DELETE \
  --adapter=/absolute/path/to/controlled-adapter.mjs
```

adapter 在每一项 claim 前续租全局锁；数据库同时验证 holder 与未过期 lease，再返回 fencing token。复核、删除、finalize 均绑定同一 holder/token；长清单不会在 900 秒后无锁继续。完成项重跑会跳过，进程在删除与 finalize 间退出时可持原 manifest 重入。重复 key、路径穿越、并发 manifest 会被拒绝。对象 key 不得写到普通日志。公开源备份至少保留一个完整备份周期。

## 8. 对账器

adapter 或受控输入需提供 `schemaVersion/sourceSnapshotId/migrationRunId/targetSchemaVersion`、完整源/目标聚合数量，以及孤儿 FK、重复键、UUID slug、非法状态、非法资产、快照漂移、公开 R18 对象和缺失恢复状态的全部数量；缺字段、多字段、字符串/负数/NaN 均 fail-closed：

```sh
npm run check:backend-v2 -- --input=/secure/redacted-check.json --json
```

退出码：`0` 正常，`2` warning（例如快照漂移），`3` critical，`4` 输入/adapter 错误。机器 JSON 和人类摘要均禁止样本行、PII、正文、token 和 object key。

## 9. COS 双桶

- 公共桶：只允许公开衍生物与不可变 `snapshots/public/catalog.vN.json`；禁止目录列举和 R18 正文。
- 私有桶：关闭静态网站，默认拒绝匿名读取；仅 CloudBase 服务角色可复制、HEAD、GET/DELETE。
- CORS：公私两桶都只列生产/Preview 必需 Origin；允许真实浏览器路径所需 GET/POST/PUT 与 `Content-Type`、`x-cos-meta-sha256`，不使用 `*` 搭配凭据。
- POST policy：精确 key、`content-length-range`、Content-Type，并包含 COS 必需签名字段；有效期不超过 5 分钟。
- staging 生命周期：未绑定对象 24 小时清理；promotion/cleanup 由数据库 fencing token 驱动。
- 私有读取 URL 最长 5 分钟；日志、数据库、快照、localStorage、sessionStorage 和 Service Worker 都不得保存签名 URL。

在 COS 控制台逐字段配置后必须回读：公私桶 bucket ACL 均无 `AllUsers/AllAuthenticatedUsers`，静态网站均关闭；公共桶 Bucket Policy 对匿名主体只能授予 `name/cos:GetObject`，资源必须恰好是该桶的 `media/works/*` 与 `snapshots/public/*`，不得包含 `GetBucket`、Put/Delete、桶根或其他前缀；两桶 CORS Origins 是生产与指定 Preview 的精确 HTTPS 列表，Methods 包含 GET/POST/PUT，Headers 包含 `Content-Type`/`x-cos-meta-sha256`，禁止 `*`；仅私桶要求 `staging/` lifecycle 为 1 天，公桶没有 lifecycle 配置属于正常状态。然后执行：

```sh
API_ALLOWED_ORIGINS=https://www.example.invalid,https://admin.example.invalid npm run verify:cos-backend-v2 -- --environment=nonprod --adapter=/absolute/path/scripts/adapters/backend-v2-cloudbase.mjs
```

验证器通过 COS API 回读双桶 ACL/CORS/Website、公共桶 Bucket Policy 和私桶 Lifecycle；除了明确的“公桶无 lifecycle”外，读取失败均视为失败。POST policy 的精确 key/size/type/q-sign 字段由 `cos.test.js` 的官方结构向量继续验证。

## 10. Worker、Vercel 和监控

CloudBase timers：snapshot worker 每 5 分钟，upload cleanup 每 10 分钟。两者使用独立 lease/fencing，不合并任务。连续失败先暂停危险重试、保留 job 记录，再排查数据库/COS。

Vercel 先 Preview 后 Production。配置 `CLOUDBASE_API_BASE_URL=https://<gateway-host>/api/v1` 与 `API_PROXY_HMAC_SECRET`；仓库的 `/api/v1/*` serverless 代理只拼接路径到该精确 HTTPS gateway，筛选 header，保留 Cookie/CSRF/Idempotency-Key，并从 Vercel 平台可信 IP 头生成 `method+path+ip+timestamp` HMAC。app-api 只在 60 秒窗口验签成功后信任该 IP；直连伪造、缺签名或过期签名拒绝。前端与 API 使用同一站点域，因此 `SESSION_COOKIE_DOMAIN` 可省略以使用 host-only Cookie；只有前台与 `admin.` 必须共享登录且所有子域 DNS 均受控时才设受控父域。Cookie 始终 `Secure; HttpOnly; SameSite=Lax`（CSRF cookie 按现有双提交策略）。CloudBase gateway CORS 仅允许 Vercel Production/明确 Preview Origin。确认 `/admin.html` 多入口、旧 `/admin/` 只读跳转、Service Worker 排除后台和 R18 URL、CSP/CORS/Cookie domain 正确；从部署域实测 `/api/v1/me` 不得 404。

建议告警阈值：

- API 5xx：5 分钟内连续 5 次或比例超过 2%；
- 登录/答题失败率：15 分钟超过基线 3 倍；
- snapshot：连续 2 次失败或数据库版本领先当前快照超过 15 分钟；
- 上传：完成失败率超过 5%，staging 孤儿超过 100 或最老超过 24 小时；
- COS：403/5xx 5 分钟超过 10 次；
- PostgreSQL：连接使用率超过 70%、慢查询超过 1 秒持续 10 分钟、备份失败一次即告警；
- 待审核评论/投稿/举报超过 100 或最老超过 48 小时。

日志只包含 requestId、匿名 actor hash、路由、状态、耗时和安全 errorCode；禁止密码、恢复码、迁移凭据、Cookie、题库答案、投稿/评论正文、签名 URL 和 object key。

## 11. 合规、举报和数据清除

只运营合法、已授权内容。年龄门和私有桶不能隐藏违法内容或免除责任。地区、平台或支付/托管政策不允许时，应下架而非依赖技术门禁。

举报需要登录、去重、状态机和管理员审计。确认违规后先下架/阻断访问，再进入 durable cleanup。用户删除采用软删除和会话撤销；按保留策略清理评论正文、IP hash 和 staging。审计至少保留 180 天。涉及法定保留、投诉或调查时停止清除并记录依据。

## 12. Staging smoke

至少验证：

1. 答题注册，无邀请码/邮箱入口；恢复码只显示一次。
2. legacy 凭据错误、过期、重放、限流均失败；正确凭据设置密码后必须确认恢复码。
3. 登录、登出、恢复、session 撤销和管理员 session 过期。
4. 新建漫画章节，直传 cover/page，章节页码连续后 review/publish；CAS 冲突返回 409。
5. restricted 作品匿名只见安全 preview；声明年龄后得到短签；撤销/停用后不再签发。
6. 点赞/收藏 set/unset、评论审核、进度跨设备、举报处置。
7. 投稿草稿、POST 直传、提交、并发审核、accepted 只创建 draft。
8. 快照 rebuild/retry，旧快照仍可读；cleanup 重试不重复删除。
9. checker 为 0 Critical；公共桶扫描无受限正文；secret scan 和 bundle scan 通过。

## 13. 切流和回滚

切流前冻结旧写入口，等待正在处理的上传结束，运行最终 dry-run/apply/checker，重建快照并记录版本。先切 API，再切前台读取，观察至少一个业务高峰。旧 JSON 保持只读，不再作为写事实来源。

回滚触发：持续认证失败、迁移 count critical、R18 泄漏、数据库不可用或快照无法恢复。立即停止 v2 写入和 legacy credential 入口；不要删除已迁数据或公共源。恢复数据库到备份的隔离副本验证后，再决定域名回切。已签发私有 URL 不能即时撤销，只能等待最多 5 分钟自然过期。

邀请、`admin-upload`、旧排行榜写入/读取函数和旧账号函数已从 `cloudbaserc.json` 部署清单移除。旧论坛与排行榜 UI 在切流窗口明确冻结为只读/本机成绩，不再访问旧事实源；统一投稿入口替代旧收件箱。生产控制台中应禁用现存触发器/HTTP 路由，但旧表在备份周期结束前不物理删除。

## 14. 低成本容量策略

- 公开目录走 COS/CDN，不按浏览量查询数据库。
- 数据库使用复合索引、游标分页和小连接池；不引入 Redis。
- 上传浏览器直传；CloudBase 只签名、HEAD/校验和提交元数据。
- 单 worker 小批量重试，checkpoint/lease 可恢复，不常驻进程。
- 每月检查数据库/COS 增长、快照体积、评论/投稿量和函数耗时。

当持续用户超过 1,000、峰值并发超过 100、作品超过 10,000 或每天评论/投稿超过 100 时，基于监控重新评估连接池、搜索、队列和审核能力；不要提前拆微服务。
