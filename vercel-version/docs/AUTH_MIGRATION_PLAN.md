# 账号认证迁移方案：自定义票据 → 答题注册 + 会话

> 状态：**待 review（未执行）**
> 目标：把账号认证从「昵称+密码+自定义票据」换成「答题挑战 + 用户名+密码 + HttpOnly Cookie 会话 + CSRF」
> 来源：`origin/codex/backend-refactor` 分支的 auth 体系（基线 `aa81019`）
> 决策记录：① 支持中文昵称（改造 codex 的 USERNAME 规则）② 接受老用户迁移成本 ③ 先出方案再执行

---

## 一、结论先行（一句话）

这是一次**账号系统整体换血**，不是「保守增量」。安全上更优，但需要：新建 8 张表 + 11 个 RPC + 原生依赖 + 前端重写 + 中文昵称改造 + 老用户迁移 + 你手动出题库。**在动手前请确认接受以下三个不可逆点。**

---

## 二、三个不可逆点（务必先看）

| # | 不可逆点 | 影响 |
|---|---|---|
| 1 | **老用户不自动迁移** | `public.users`（中文昵称 + scrypt 哈希）与 codex 的 `app_users` 是两套表。切过去后老用户需重新注册，或跑一次性迁移脚本。已确认「接受迁移成本」。 |
| 2 | **中文昵称需改造 codex 代码** | codex 的 `USERNAME = /^[a-z0-9_]{3,32}$/` 不支持中文。需改 `service.js` 正则 + `backend_v2.sql` 里 `app_users.username` 的 CHECK 约束。已确认「改成支持中文昵称」。 |
| 3 | **`@node-rs/argon2` 是 Rust 原生模块** | 云函数运行时 `Nodejs18.15`，云端 `npm install` 对 native 包支持不稳定，存在**起不来的现实风险**。这是最大技术不确定性。 |

---

## 三、迁移范围清单

### 3.1 数据库（新建，3 个迁移 SQL）

| 文件 | 内容 | 说明 |
|---|---|---|
| `20260918_backend_v2.sql`（1090 行） | 建 8 张 auth 表 + 11 个 RPC + 全套业务表 | **需裁剪**：只取 auth 相关（app_users / user_sessions / question_bank / registration_challenges / registration_attempts / registration_tickets / recovery_codes / age_consents + 11 个 RPC），**不要** works/comments/favorites 等业务表（那些属于「内容管线」重构，不在本次范围） |
| `20260918_backend_v2_runtime_access.sql` | RLS 运行时授权 | auth 表相关的 grant/revoke |
| `20260918_backend_v2_rollback.sql` | 回滚脚本 | 保留，作为回退手段 |

**auth 相关 RPC 函数（11 个）**：
`answer_registration_challenge`、`validate_registration_ticket`、`consume_registration_ticket`、`create_login_session`、`rotate_user_session`、`resolve_user_session`、`revoke_user_session`、`consume_recovery_code`、`get_unconfirmed_recovery_credential`、`regenerate_unconfirmed_recovery_code`、`confirm_recovery_session`

**改造点**：`app_users.username` 的 CHECK 约束从 `[a-z0-9_]` 改为支持中文（建议 `长度 2-20`，与现有 `users.nickname` 对齐）。

### 3.2 后端云函数（新建 1 个 + 骨架）

| 文件 | 来源 | 说明 |
|---|---|---|
| `cloudbase/functions/app-api/` 整套 | codex 分支 | 统一运行时 + auth 模块。需裁剪掉非 auth 模块（works/uploads/snapshots/interactions/submissions/admin-console） |
| 骨架文件 | codex | `index.js`、`src/{router,http,security,errors,db,config,logger,rate-limit}.js`、`src/infrastructure/cos.js`（auth 不依赖 cos，可省） |
| auth 模块 | codex | `src/modules/auth/{service,repository,passwords,session,routes}.js`、`src/compat/legacy-users.js` |

**改造点**：
- `service.js` 的 `USERNAME` 正则 → 支持中文
- `passwords.js` 保留 argon2id，但需验证 native 兼容性（见风险）

### 3.3 前端（重写 1 个 + 改 6 个）

| 文件 | 改动 | 说明 |
|---|---|---|
| `src/components/UserEntry.tsx`（223 行） | **重写** | 走答题流程（challenges → answer → register）+ 用户名/密码 + cookie 会话 + CSRF header |
| `src/utils/cloudbaseToken.ts`（6 处） | 改 | 从 `signInWithCustomTicket` 改为基于 cookie 会话的 `/me` 拉取 |
| `src/utils/gameScores.ts`（5 处） | 改 | 去掉 ticket/uid 注入，改走会话 |
| `src/components/RestaurantForum.tsx`（15 处） | 改 | 依赖最多，评论/点赞改走会话态 |
| `src/components/PotatoMarket.tsx`（3 处） | 改 | 同上 |
| `src/components/DoujinshiArchive.tsx`（1 处） | 改 | 同上 |
| `src/utils/cloudbaseEndpoint.ts`（0 处） | 不动 | 端点常量，可能需加 app-api 地址 |

> 注：codex 分支有现成的 `src/features/auth/api.ts` + `UserEntry.test.tsx`，可参考其 API 契约，但需适配中文昵称 + 你的现有 UI。

### 3.4 产品内容（题库已定 + 冷却规则）

**题库（5 题，已由用户提供，答案序列 C B D C D）**

| # | prompt | options（A/B/C/D） | 正确答案 |
|---|---|---|---|
| 1 | 公式书上，利威尔、韩吉两人分别什么属性（格斗/行动/脑力/协调/…）是 11？ | 格斗、脑力 / 洁癖、脑力 / 格斗、智慧 / 洁癖、智慧 | **C（格斗、智慧）** |
| 2 | 漫画王政篇中，利威尔、韩吉两人的接头外号分别是？ | Titan killer; Glasses / Moppel; Engelchen / Black tea; Glasses / Baby face; Little angel | **B（Moppel; Engelchen）** |
| 3 | 「ifkk」在漫画中是第几话？章节名「矜持」正确的中文翻译是？ | 115话；支撑 / 115话；角色 / 126话；火种 / 126话；自尊 | **D（126话；自尊）** |
| 4 | 「akkk」是什么的缩写？ | 分からないものがあれば… / いっそう二人で… / 相変わらず巨人とは片想いのまま… / じゃあな、ハンジ。見ててくれ。 | **C（相変わらず巨人とは片想いのまま…）** |
| 5 | 巨人中学校里，韩吉找利威尔对试卷分数谁更高，用什么做赌注？ | 紅茶 / 巨人のエサ / さっちゃんイカ / 焼きそばパン | **D（焼きそばパン）** |

> ✅ 答案序列最终为 **C B D C D**（第 1 题 = C 格斗、智慧；第 4 题 = C 相変わらず巨人とは片想い…）。

**答题规则（最终决策）**

- **抽题方式**：5 题随机抽 1 题（`sampling_weight` 全为 1，等权重），答对 1 题即过关（`passing_score = 1`）。
- **冷却规则**：单次挑战内 `max_attempts = 3`，答错 3 次（`status='failed'`）后，同一 IP 哈希 24h 内禁止新建挑战。
  - 实现位置：`createChallenge` 前加一步 `SELECT count(*) FROM registration_challenges WHERE ip_hash=$1 AND status='failed' AND updated_at > now()-interval '24 hours'`，≥ 1 则抛错（返回冷却剩余时间）。
  - 冷却阈值 = **1 次失败**（即一次挑战 3 次机会用尽，锁 24h）。

**环境变量**

| 变量 | 说明 |
|---|---|
| `PEPPER` | ≥32 字符，HMAC-SHA256 domain hash 用（算 `accepted_answer_hashes` 也用它） |
| `SESSION_COOKIE_DOMAIN` | 会话 Cookie 域名 |
| `SESSION_COOKIE_NAME` / `CSRF_COOKIE_NAME` | Cookie 名 |

**题库种子 SQL 的哈希计算**：`accepted_answer_hashes` = `HMAC-SHA256(pepper, "question-answer\0" + normalized_answer)`，normalization_rule 建议 `trim_lowercase`（中文答案不区分大小写/空格）。pepper 定下来后跑一个 node 脚本批量算 5 题哈希，生成 INSERT。

---

## 四、部署顺序（保守、可回滚）

```
阶段 0：备份
  └─ 备份 public.users 表 + 现有云函数配置（fn detail --json 留档）

阶段 1：数据库（可独立回滚）
  └─ 跑裁剪后的 backend_v2.sql（仅 auth 表 + RPC）→ 验证 8 表 + 11 RPC 存在
  └─ 跑 runtime_access.sql → 验证权限
  └─ 出题库：插入 question_bank 至少 1 题

阶段 2：后端（新函数，不影响旧函数）
  └─ 部署 app-api（新的独立云函数，与 loginWithPassword/registerWithPassword 并存）
  └─ 冒烟：curl /auth/challenges → /answer → /register → /me

阶段 3：前端（切换，需一次发布）
  └─ 重写 UserEntry + 改 6 个依赖文件
  └─ tsc + build + 本地 http 走查（CDP 验证答题注册全流程）

阶段 4：老用户迁移（可选，你已接受成本可跳过）
  └─ 写迁移脚本 users → app_users（或放弃，让老用户重注册）

阶段 5：下线旧函数（观察期后）
  └─ 确认无流量后，停用 loginWithPassword / registerWithPassword
```

**关键设计**：阶段 2 里 `app-api` 与旧函数**并存**，前端在阶段 3 一次性切换。任何一步失败，回滚到上一阶段即可，不影响线上。

---

## 五、风险与不确定性（按严重度）

| 风险 | 严重度 | 应对 |
|---|---|---|
| `@node-rs/argon2` native 模块在云端装不上/起不来 | 🔴 高 | 阶段 2 前先做最小 POC：部署一个只 `require('@node-rs/argon2')` 的探针函数验证。失败则降级回 Node 内置 scrypt（改 passwords.js，保留 argon2id 接口签名不变） |
| 老用户丢失/被迫重注册 | 🟡 中 | 已接受；可选写一次性迁移脚本 |
| 中文昵称改造引入的边界 bug | 🟡 中 | 用户名规则与 `users.nickname` 对齐（2-20 字），补单测 |
| 前端 6 个文件改动引入回归 | 🟡 中 | 逐个改 + tsc + CDP 走查（评论/点赞/游戏分数都要验） |
| 答题门槛导致注册量下降 | 🟢 产品 | 你出题时可设置简单题（降低门槛） |
| 与本地 174 处未提交图片改动纠缠 | 🟡 中 | **建议先 commit 图片优化工作**，再做 auth 迁移，避免两个大改动混在一起 |

---

## 六、建议的前置动作

1. **先把 174 处图片优化改动 commit + push**（上一轮的任务），让工作区干净，auth 迁移在干净基线之上做，避免混淆。
2. **先做 argon2 探针 POC**（阶段 2 前），确认 native 依赖可行性，这是整个方案的最大不确定点。

---

## 七、待你确认的问题

1. 题库你想出什么题？（领域相关简单题，如「韩吉的坐骑/称号」之类，降低门槛）
2. 老用户迁移：彻底放弃让老用户重注册，还是写一次性迁移脚本平移（中文昵称 + 密码哈希需要能平移，scrypt→argon2 需要重哈希，用户需重置密码）？
3. argon2 若在云端装不上，是否接受降级回 Node 内置 scrypt（安全上略逊，但稳定）？
