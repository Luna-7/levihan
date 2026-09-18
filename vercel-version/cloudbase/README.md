# 管理员上传通道（CloudBase）

土豆粮仓的「同人本上传台」后端。站长在网页上填好信息、选好图片即可发布，
**不需要再进 COS 控制台**，也**不需要在本地或仓库里存放任何腾讯云密钥**。

- 上传台地址：<https://levihan-tudou-d0g7jivue1ccc4a35-1325571558.tcloudbaseapp.com/admin/>
- 云函数接口：`https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com/admin-upload`

---

## 它怎么工作

```
浏览器（/admin/）
   │  口令登录 → 拿到 2 小时有效的令牌
   │  图片在浏览器里转成 WebP → base64
   ▼
云函数 admin-upload（口令校验 + 写 COS + 写 archive.json）
   │  使用运行时自动注入的临时凭证，无需任何永久密钥
   ▼
COS 桶 levihan-1325571558  →  lh-XXX/image01.webp…
                            →  archive.json（站点读取的归档）
```

站点仍在原路径读取：`{目录}/{前缀}{页码}.webp` 与桶根目录的 `archive.json`。

## 口令

口令保存在 `cloudbase/.env`（**已被 .gitignore 忽略，不会提交**），
通过 `cloudbaserc.json` 里的 `{{env.ADMIN_PASSWORD}}` 注入到云函数。

修改口令：编辑 `cloudbase/.env` 中的 `ADMIN_PASSWORD`，然后重新部署云函数即可。

## 部署 / 更新

```bash
cd cloudbase

# 只改云函数
tcb fn deploy admin-upload --env-id levihan-tudou-d0g7jivue1ccc4a35 --path /admin-upload --force

# 站点（上传台页面在 public/admin/，随站点一起发布）
cd ..
npm run build
tcb hosting deploy ./dist --env-id levihan-tudou-d0g7jivue1ccc4a35 --yes
```

> 部署前建议先 `node --check cloudbase/functions/admin-upload/index.js`——
> 语法错误会让函数返回 `FUNCTIONS_INVOCATION_FAILED` 且日志里什么都没有，很难排查。

## 接口

`POST`，body 为 JSON（前端用 `text/plain` 发送以避开 CORS 预检；函数不校验 Content-Type）。

| action | 需要令牌 | 入参 | 说明 |
|---|---|---|---|
| `status` | 否 | — | 健康检查、是否已配置口令、单文件上限 |
| `login` | 否 | `password` | 返回 `token` 与过期时间 |
| `catalog` | 是 | — | 读取桶根 `archive.json` |
| `upload` | 是 | `bookId` `fileName` `dataBase64` `contentType` | 写入 `{bookId}/{fileName}` |
| `publish` | 是 | `book` | 按 `id` 新增或覆盖归档记录 |
| `remove` | 是 | `id` `deleteFiles` | 删除归档记录，`deleteFiles` 为 true 时一并清空该目录对象 |

字段与 `src/types/doujinArchive.ts` 的 `DoujinBookItem` 一致；
`bookFolder` / `coverFile` 留空分别回退为 `id` / `image01.webp`，
`pagePrefix` 为 `image`、`pagePadDigits` 为 `2` 时不写入（保持与 `sync-archive.mjs` 同构）。

## 踩过的坑（改之前先看）

1. **必须用「事件函数 + HTTP 访问服务」**（`fn deploy --path /admin-upload`，**不要加 `--httpFn`**）。
   `--httpFn` 会转成 Web 云函数，需要 `scf_bootstrap` 起 HTTP 服务；实测在本环境
   部署成功但调用一律 `FUNCTIONS_INVOCATION_FAILED`（连零依赖的 hello 服务也一样）。
2. **CLI 默认忽略 `node_modules`，且配置只能追加、无法取消**。所以依赖必须在云端安装
   （`installDependency: true`），不要指望把 `node_modules` 打包上传。
3. **`tcloudbaseapp.com` 测试域名有中间页**：无同站 Referer 的直接访问会先落到
   CloudBase 的「风险提醒」页（倒计时 3 秒 + 确定访问）。站内点击跳转不受影响。
   要去掉中间页需要绑定自定义域名。
4. 请求体上限 6MB（HTTP 访问服务），故单张图片上限设为 4MB（base64 后会膨胀约 1/3）。

## 自检脚本

```bash
python3 .workbuddy/tests/test-admin-channel.py   # 后端 40 项（走真实 HTTP，含清理）
NODE_PATH=/Users/luna/.workbuddy/binaries/node/workspace/node_modules \
  node .workbuddy/tests/test-admin-ui.cjs        # 浏览器 25 项（登录→上传→校验→删除）
```

两个脚本都会在结束时把归档恢复到运行前的状态，不会留下测试数据。

## 第一阶段：云端待审收件箱

小说稿件经主站表单发送到 `admin-upload` 的 `submitNovel`，存入 CloudBase PostgreSQL
`public.submission_inbox`。管理员后台使用原令牌调用 `inboxList` / `inboxReview`。
通过小说后调用原 `novelSave`，写入 `novels.json` 和 `novels/{id}.txt`；驳回只更新私有收件箱状态。

SQL 建表和私有权限配置见 `migrations/20260915_submission_inbox.sql`。前端不持有
CloudBase 数据库服务密钥；云函数只从环境变量 `CLOUDBASE_APIKEY` 读取它。
正式启用前需为云函数配置一把服务端 API Key，并确保 `cloudbase/.env` 中的
`CLOUDBASE_APIKEY` 仅用于部署且被 Git 忽略。缺少它时，收件箱明确返回 503。
## 账号系统：昵称 + 密码（2026-09-18 起）

短信验证码登录与粮仓钥匙邀请制已同时下线，改为**开放注册的「昵称 + 密码」**。

### 端点

注册与登录都必须发生在拿到登录态之前，所以走 **HTTP 访问服务**而不是浏览器的
`cloudbase.callFunction`（网关鉴权默认只放行已登录用户，只有策略里点名放行的 path 才允许匿名调用）。
两个函数均通过 CloudBase HTTP 访问服务暴露：

```
POST https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com/registerWithPassword
POST https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com/loginWithPassword
```

请求体用 `text/plain;charset=UTF-8` 发送 JSON（避开 CORS 预检）：

```json
{ "nickname": "韩吉", "password": "至少 6 位" }
```

成功返回 `{ ok: true, ticket, profile }`，前端把 `ticket` 交给
`auth.signInWithCustomTicket(() => Promise.resolve(ticket))` 换登录态。

| 端点 | 鉴权 | 说明 |
|---|---|---|
| `registerWithPassword` | 匿名 | 服务端生成 `lh_*` uid，scrypt 散列口令后写 PG；昵称撞唯一索引返回 409 |
| `loginWithPassword` | 匿名 | 校验 scrypt 散列，签发 30 天自定义登录票据 |
| `getUserAccount` | 需登录 | 读取自己的昵称 / 角色 / 加入时间 |
| `updateNickname` | 需登录 | 改昵称，唯一性由 `users.nickname_key` 唯一索引兜底 |

### 数据

`public.users` 在原有列之外增加了：

- `password_hash text` — `scrypt$<salt-hex>$<hash-hex>`，只存散列
- `nickname_key text GENERATED ALWAYS AS (lower(btrim(nickname))) STORED` + 唯一索引
- `updated_at timestamptz NOT NULL DEFAULT now()`

迁移见 `migrations/20260918030000_nickname_password_auth.sql` 与
`migrations/20260918040000_users_nickname_key.sql`。

### 踩过的坑（改之前先看）

1. **`app.rdb()` 没有 `rpc()`**。runtime 里的 `@cloudbase/node-sdk` 是 3.18.3，
   `app.rdb()` 返回的是 postgrest 客户端，只暴露 `from()`/`select()`/`insert()`/`update()`。
   调 `db.rpc(...)` 会直接 `TypeError: db.rpc is not a function`。
   仓库里 `generateInviteCode` / `createUserProfile` 仍在用 `db.rpc`，属于已失效的历史代码。
2. **必须有 `CLOUDBASE_APIKEY`**。PG 迁移里 `REVOKE ALL ... FROM PUBLIC, anon, authenticated`
   且只 `GRANT ... TO service_role`，所以不带环境级 API Key 的运行时临时凭证会直接
   `permission denied for table users`（42501）。`app.auth().createTicket()` 同样依赖它。
3. **登录失败一律返回同一句提示**，避免昵称枚举；口令比较用 `crypto.timingSafeEqual`。
   〔待补〕尚无失败次数限制，爆破防护待补。

### 历史数据

邀请码云函数、部署配置与前端入口已下线。旧 `invite_codes` 表及 `users` 中的邀请来源列暂时保留，
只作为历史审计数据，不再参与注册或登录流程；清理线上数据前需另行备份并确认。
- `submitComment` / `deleteComment` / `submitGameScore` / `getGameLeaderboard` 仍是 NoSQL 写法，
  且 `game_scores` / `game_best` / `comments` 三张表在 PG 里并不存在，属于未完成迁移。
