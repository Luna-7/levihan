# 账号体系重构方案：自建会话（Session）彻底替换 CloudBase 内置 auth()

> 状态：**方案设计待 review（未执行）**
> 目标：把「答题注册 + 自建会话 + HttpOnly Cookie」彻底替换现有的「自定义票据 + CloudBase auth()」
> 背景结论：① codex 的 app-api 依赖 `rdb().rpc()`，后端 node-sdk 不支持 → 不能照搬；② 彻底自建会话是用户明确决策。

---

## 一、为什么这是「大改」（影响面全景）

现有账号体系**深耦合在 CloudBase 内置 `auth()`** 上，替换它需要动以下所有点。

### 1.1 后端云函数（登录态依赖）

| 函数 | 当前鉴权方式 | 需改为 |
|---|---|---|
| `registerWithPassword` | `createTicket()` 签发自定义票据 | 答题挑战 + 建 `user_sessions` 记录 + 签发自建 session token |
| `loginWithPassword` | `createTicket()` 签发自定义票据 | 校验密码 → 建会话 → 签发 session token |
| `getUserAccount` | `app.auth().getUserInfo()` 拿 uid | 凭 session token 查 `user_sessions` 表拿 uid |
| `submitGameScore` | `app.auth().getUserInfo()` | 同上 |
| `updateNickname` | `app.auth().getUserInfo()` | 同上 |
| `getGameLeaderboard` | `getUserInfo().uid`（可空） | 同上（可选登录） |
| `admin-upload` | **已有自建 token**（`verifyToken`/`signExp`）+ `getUserInfoByAccessToken` 换 uid | 部分需改（uid 换来源） |

### 1.2 前端（11 文件，几十处）

| 文件 | 依赖 | 改动 |
|---|---|---|
| `UserEntry.tsx` | `signInWithCustomTicket` / `getCurrentUser` / `signOut` | **重写**：答题 → 注册 → 存 session token（localStorage） |
| `cloudbaseToken.ts` | `auth().getAccessToken` / `getCurrentUser` / `callFunction` | 改为读自建 session token |
| `gameScores.ts` | `auth().getCurrentUser` + `callFunction` | 改为凭 session token 调函数 |
| `RestaurantForum.tsx` | `getAccessToken`/`getCurrentUid`（评论/点赞，~10 处） | 改身份来源 |
| `PotatoMarket.tsx` | `getAccessToken`/`getCurrentUser` | 同上 |
| `DoujinshiArchive.tsx` | `getCurrentUser` | 同上 |
| `HomeAnnouncementGrid.tsx` / `PopUpShopBanner.tsx` | 间接依赖 | 检查后改 |

---

## 二、核心设计决策

### 2.1 会话 token 方案

**方案 A：不透明 token（opaque token）+ 服务端存哈希**（沿用 codex 思路）

- 登录/注册成功 → 服务端生成 `crypto.randomBytes(32).toString('base64url')`
- **只把 `SHA-256(token)` 存进 `user_sessions.token_hash`**，明文 token 只返回给前端一次
- 前端存 `localStorage`（注意：非 HttpOnly，有 XSS 风险；但比 Cookie 跨域简单）
- 后续请求带 `Authorization: Bearer <token>` 或 `X-Session-Token` 头
- 服务端 `SHA-256(收到的 token)` → 查 `user_sessions` → 得 uid + 校验未撤销未过期

> 为什么不用 Cookie：你的前端和后端是**跨域**（`levihan.asia` → `*.service.tcloudbase.com`），HttpOnly Cookie 跨域带不上去，除非配 SameSite=None + Secure + 域名白名单。用 Bearer token 存 localStorage 更简单，代价是 XSS 风险（你站点无富文本 UGC 注入，风险可控）。

### 2.2 数据库表（精简版，不用 rpc，直接表读写）

后端 node-sdk 只有 `from()/select()/insert()/update()`，所以**所有逻辑下推到「表 + 云函数内 JS」**，不建 SECURITY DEFINER RPC 函数。

| 表 | 字段 | 说明 |
|---|---|---|
| `app_users` | id uuid, username, password_hash, role, status, created_at... | 用户（保留中文昵称，密码 argon2） |
| `user_sessions` | id, user_id, token_hash, expires_at, revoked_at, ip_hash... | 会话 |
| `question_bank` | id, prompt, options jsonb, accepted_answer_hashes, normalization_rule, status, sampling_weight | 题库 |
| `registration_challenges` | id, question_ids, attempt_count, max_attempts, status, expires_at, ip_hash | 答题挑战 |
| `recovery_codes` | id, user_id, code_hash, used_at | 恢复码 |

> 不再需要 `registration_attempts`（答题尝试记录可并入 challenge 表）、`age_consents`（年龄确认暂缓）。

### 2.3 后端函数重构（3 个函数覆盖全部认证）

| 新函数 | 职责 | 对应旧函数 |
|---|---|---|
| `auth`（新） | 统一入口：`challenge` / `answer` / `register` / `login` / `logout` / `me` / `recover` | registerWithPassword + loginWithPassword + getUserAccount |
| `submitGameScore`（改） | 改鉴权为 session token | 同名 |
| `updateNickname`（改） | 同上 | 同名 |

### 2.4 答题 + 冷却逻辑（在云函数 JS 里实现，不依赖 rpc）

- `challenge`：随机抽 1 题，建 `registration_challenges` 记录（`max_attempts=3`），返回 challenge_id + 题目
- `answer`：校验答案 → 更新 attempt_count；答对 → 发 `registration_ticket`；答错 3 次 → 置 `failed`
- **24h 冷却**：`challenge` 建新挑战前，查 `registration_challenges` 里同 `ip_hash` 且 `status='failed'` 且 `updated_at > now()-24h` 的记录数 ≥1 → 拒绝

---

## 三、执行顺序（5 阶段，可回滚）

1. **阶段 0（备份）**：✅ 已完成（users 42 行 + 函数配置）
2. **阶段 1（建表）**：精简版 5 张表（直接表读写，无 RPC 函数）
3. **阶段 2（后端 auth 函数）**：新建 `auth` 函数（argon2 随包上传）
4. **阶段 3（前端切换）**：重写 UserEntry + 改 6 个组件/工具
5. **阶段 4（下线旧函数 + 老用户迁移）**：观察期后停用旧函数

---

## 四、风险与未决问题

| 风险 | 说明 |
|---|---|
| **XSS → token 泄露** | localStorage 存 token，若有 XSS 会被偷。缓解：token 有效期短（7 天）+ 可撤销 |
| **老用户迁移** | 42 个现有用户（中文昵称 + scrypt 密码）在 `public.users`，需迁移到 `app_users`（scrypt 无法直接转 argon2，用户需重置密码）——已确认「放弃，重注册」 |
| **admin-upload 的 uid 绑定** | 它用 `getUserInfoByAccessToken` 换 uid，改用自建 token 后要改这一处 |
| **并发/幂等** | codex 用 RPC 保证原子性，改表操作后需要事务（node-sdk 的 postgrest 单次 insert 是原子的，多表操作需在云函数内串行） |
| **argon2** | ✅ 已探针验证可用（随包上传 linux-x64 二进制） |

---

## 五、已确认决策（2026-09-20 定稿）

1. **token 存储**：localStorage + `Authorization: Bearer` 头传递。不用 Cookie（前后端跨域，HttpOnly Cookie 配 SameSite=None 成本高易踩坑）。localStorage + 短有效期 + 服务端可撤销，风险可控、实现最简单。
2. **题库答案哈希**：`accepted_answer_hashes` = HMAC-SHA256(pepper, `"question-answer\0"` + 归一化答案) 的 hex。pepper 放云函数环境变量 `AUTH_PEPPER`（≥32 字符），与 codex 的 `domainHash` 一致。题库表不存明文答案。
3. **会话有效期**：普通用户（member）30 天 / 管理员（admin）8 小时（沿用 codex）。
4. **老用户**：彻底放弃，重注册（已确认）。
