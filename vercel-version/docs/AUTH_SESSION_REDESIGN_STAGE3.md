# 阶段 3 方案：前端切换自建会话 + 旧表 uid 改 uuid

> 状态：**方案已定稿（2026-09-20），待执行**
> 前置：阶段 0（备份）、阶段 1（建表）、阶段 2（auth 云函数）均已完成并上线、冒烟通过。

## 零、核心决策（2026-09-20 用户拍板）

**「保留 uuid，旧表改 uuid」** —— 新 auth 体系 `app_users` 用标准 uuid 不动，旧体系所有绑定 `lh_` 前缀 uid 的地方统一对齐到 uuid。

**理由**：
- `app_users` 已建好（uuid 主键），无存量用户，改它要重建，不划算。
- 旧 `users` 表的 42 个存量用户已确认「放弃、重注册」（scrypt 密码无法转 argon2），所以旧表没有「必须保留 uid 连续性」的包袱。
- uuid 是更干净的长期方案，避免 `lh_` 前缀与 CloudBase 原生 uid 的语义混淆。

## 一、影响面全景（已逐一盘清）

### 1.1 后端函数

| 函数 | 现状 | 改动 |
|---|---|---|
| `auth`（新） | ✅ 已上线，uuid + 自建会话 | 无 |
| `getUserAccount` | `app.auth().getUserInfo()` → 读 `users` | 改凭自建 token 查 `user_sessions`→`app_users`（uuid） |
| `updateNickname` | `getUserInfo()` → 读写 `users` | 同上，改读 `app_users` |
| `submitGameScore` | `getUserInfo()` → 读 `users` + `game_scores` | 同上；`game_scores`/`game_best` 建表用 uuid（PG 里尚不存在，属死代码，暂不动） |
| `getGameLeaderboard` | `getUserInfo().uid`（可空）→ 读 `game_best` | 同上；游客仍可看榜 |
| `admin-upload` | `authUid(bearer)` = `getUserInfoByAccessToken` | `authUid` 改自建 token（`Authorization: Bearer <session>` → 查 `user_sessions`→`app_users` 拿 uuid） |
| `registerWithPassword` / `loginWithPassword` | 旧，`createTicket` | **下线**（阶段 4） |

### 1.2 前端（6 文件）

| 文件 | 改动 |
|---|---|
| `UserEntry.tsx` | **重写**：答题 → 注册 → 存 session token 到 localStorage；登录/登出走 auth 函数 |
| `cloudbaseToken.ts` | `getAccessToken`/`getCurrentUid` 改读自建 token（localStorage）+ 调 `auth` 的 `me` |
| `gameScores.ts` | `currentUid` 改自建 token；`submitScore`/`fetchLeaderboard` 暂保留（函数未上线，前端有兜底） |
| `PotatoMarket.tsx` | `getAccessToken`/`getUserAccount` 改自建 token |
| `RestaurantForum.tsx` | 同上（~10 处） |
| `DoujinshiArchive.tsx` | `getCurrentUser` 改自建 token |

### 1.3 数据面（uid 对齐）

| 数据 | 现状 uid | 改动 |
|---|---|---|
| `app_users` | uuid ✅ | 无 |
| `users`（旧） | `lh_` 前缀，42 行 | **废弃**，不迁移；新用户全进 `app_users` |
| 论坛/市集内容（COS JSON） | 帖/评 `uid` = `lh_` | 新内容存 uuid；旧内容 `lh_` uid 断链（可接受，历史归属失效） |
| `submission_inbox`（PG） | 需确认是否有 uid | 若有，新写入用 uuid |
| `game_scores`/`game_best` | PG 未建（死代码） | 若上线，建表用 uuid |

## 二、执行顺序（可回滚）

1. **后端**：改 `getUserAccount`/`updateNickname`/`getGameLeaderboard` 为「自建 token 鉴权 + 读 app_users」；`admin-upload` 的 `authUid` 改自建 token
2. **前端**：重写 `UserEntry`（答题→注册→存 token）+ `cloudbaseToken` + 5 个组件改身份来源
3. **联调**：build + preview（4173 端口）走真实链路验证
4. **上线**：git push（Vercel 自动部署）

## 三、关键风险

| 风险 | 缓解 |
|---|---|
| 旧论坛内容 uid 断链（作者归属失效） | 可接受；不影响浏览，只影响「删除自己旧帖」 |
| 前端多处改 token，易漏 | 改完 grep 兜底查残留 `cloudbase.auth()` |
| 管理员（admin）角色识别 | admin 账号要迁移到 `app_users` 并标 role=admin（8h 会话） |
| 自建 token 走 HTTP 需带 `Authorization` 头 | 前端统一封装 `fetch` 带 Bearer 头 |

## 四、已查明（执行前确认完毕）

1. **管理员后台不依赖账号体系**（已查证 admin-upload/index.js）：
   - 管理动作（login/inboxList/inboxReview 等）走 `verifyToken(token)`（`x-admin-token` + `ADMIN_PASSWORD` 口令门），**与账号体系完全分离**。
   - `PUBLIC_ACTIONS`（读/匿名投递）无需鉴权；`USER_ACTIONS`（论坛/市集发布互动）才用账号 uid。
   - **结论**：阶段 3 账号切换**不影响管理后台**，也无需「admin 角色迁移到 app_users」。app_users 的 role='admin' 字段保留但当前无实际消费点（预留）。
