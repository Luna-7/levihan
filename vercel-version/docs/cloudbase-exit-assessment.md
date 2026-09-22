# CloudBase 退出方案评估

> 产出时间：2026-09-22 · 状态：**评估完成，等待决策**
> 触发：站点登录报 `Load failed`，排查确认为 CloudBase 欠费停服

---

## 0. 一句话结论

**先算账再谈迁移。** 本项目后端体量（3827 行 + 12 张表）落在 CloudBase 个人版 ¥19.9/月 额度内的可能性很高；而"完整迁移到免费平台"的工时成本，折算下来够付很多年个人版。**真正值得考虑的不是"换哪家"，而是"砍掉哪些功能"**——砍掉账号 + 论坛互动 + 投稿收件箱后，后端从 3827 行降到约 200 行 + 2 张表，届时迁到任何免费平台都是一天的工作量。

---

## 1. 故障根因（已实测确认）

对网关 `https://levihan-tudou-d0g7jivue1ccc4a35.service.tcloudbase.com` 实测，所有 HTTP 云函数路由（`/auth`、`/admin-upload`、`/loginWithPassword`，GET/POST/OPTIONS 均同）返回：

```
HTTP/1.1 400 Bad Request
{"code":"FUNCTIONS_INVOCATION_FAILED",
 "message":"Function is Unavailable, AvailableStatus = InsufficientBalance"}
```

- **性质**：腾讯云账号级欠费停服。不是代码 bug，不是 CORS 配置问题。
- **为什么显示成 `Load failed`**：网关 400 的响应**不带任何 `access-control-allow-*` 头**（函数没执行到写 CORS 头那一步）。带 `Authorization` 的请求会先发 OPTIONS 预检 → 预检 400 且无 ACAO → 浏览器判预检失败 → fetch reject → Safari/WebKit 报 `Load failed`、Chrome 报 `Failed to fetch`。不带 Authorization 的登录请求是 simple request，不触发预检，会直接拿到 400 JSON 并显示「账号服务暂时不可用，请稍后重试」。
  **同一个故障在两个入口表现成两种报错，容易被误判成两个问题。**
- **前端不受影响**：`https://www.levihan.asia` 返回 200，Vercel 侧正常。挂的只是所有动态数据。
- **修复**：充值。改代码、重新部署都无效。

---

## 2. 现状盘点

### 2.1 后端代码

| 文件 | 行数 | 职责 |
|---|---:|---|
| `admin-upload/index.js` | 2589 | 公告 / 论坛 / 市集 / 投稿收件箱 / 漫画小说上传 / 排行榜，**全部塞在一个函数里** |
| `auth/index.js` | 577 | 自建会话：challenge、answer、register、login、me、logout、改昵称 |
| `registerWithPassword` | 212 | 注册（scrypt 散列写 PG） |
| `loginWithPassword` | 185 | 登录（scrypt 校验 + 签发会话） |
| `submitGameScore` | 102 | 排行榜提交 |
| `getGameLeaderboard` | 90 | 排行榜读取 |
| `updateNickname` | 46 | 改昵称 |
| `getUserAccount` | 26 | 读档案 |
| **合计** | **3827** | |

`admin-upload` 内部分节（估算）：安利墙/外链预览 441 行、各类业务 handler（论坛/公告/市集/上传）约 1015 行、在线小说 206 行、业务路由与投稿校验 158 行、**排行榜约 130 行**、HTTP 层与入口 165 行。

> 仓库根目录 `cloudfunctions/` 下的 8 个函数均为 2 行存根，实际代码已迁至 `vercel-version/cloudbase/functions/`。

### 2.2 数据库（PostgreSQL，12 张表）

| 归类 | 表 |
|---|---|
| 账号与会话（9 张） | `users`、`user_sessions`、`app_users`、`invite_codes`、`question_bank`、`recovery_codes`、`registration_challenges`、`registration_tickets`、`rate_limit_buckets` |
| 排行榜（2 张） | `game_scores`、`game_best` |
| 投稿收件箱（1 张） | `submission_inbox` |

### 2.3 对象存储（COS）

公告图、漫画本、加密本（AES-256-CBC 密文）、论坛图、小说正文与评论 JSON。
**数据量未知〔待校准〕**——这是迁移中最大的隐性工作量。

### 2.4 Action 清单（`admin-upload`）

- **公开**：`status` `login` `announcementList` `announcementImageUpload` `forumList` `forumTodayRelay` `marketList` `novelCommentList` `leaderboard` `submitNovel` `submitContact` `submitAnnouncement` `submitRecommend` `submitCustomOrderEmail`
- **需登录**：`forumComment` `forumPotato` `forumClaim` `forumReleaseClaim` `forumCommentDelete` `forumEdit` `marketPublish` `marketDelete` `novelDirectPublish` `novelUpdate` `novelCommentAdd` `novelBody` `submitScore`
- **用户或管理员**：`novelCommentDelete` `linkPreview` `forumDelete` `forumPublish` `forumEnrichLink` `forumImageUpload` `forumCommentEdit`

---

## 3. 三条路线对比

### 路线 A · 留在腾讯云（充值）

| 项 | 说明 |
|---|---|
| 成本 | 个人版 **¥19.9/月 = 4 万资源点**（≈200 万次 DB 调用 + 4GB 存储） |
| 改动 | **零**。代码一行不用动 |
| 国内访问 | **最优**（有大陆节点，微信内可正常打开） |
| 风险 | FREE 档只有 3000 点/月且超额即停，**不能停在免费档**，否则同样事故会重演 |

> CloudBase 已改为资源点制（1000 点 ≈ ¥1）。本次形态很可能就是 FREE 档超额或按量欠费。

### 路线 B · 完整迁移到免费平台

| 方案 | 免费额度 | 要改什么 | 主要坑 |
|---|---|---|---|
| **Vercel 函数 + Neon** | Neon 0.5GB/项目、100 CU-hrs/月，无卡无到期 | 后端搬 `/api`；PG 原样搬，schema 几乎不改 | Neon 冷启动约 1s；Vercel Hobby 函数有执行时长上限 |
| **Cloudflare Workers + D1 + R2** | 10 万请求/天、R2 10GB 零出口费、D1 5GB | D1 是 SQLite，schema 重写 | **免费版 CPU 仅 10ms/次，现有 scrypt 登录大概率爆**；且 CF 在大陆无节点 |
| **Supabase** | 500MB PG + 1GB 存储，自带 Auth | PG 直接搬 | **7 天无访问自动暂停**；免费层无备份 |

### 路线 C · 删减后迁移（详见 §4）

后端降到约 200 行 + 2 张表，迁移成本从"周级"降到"一天"。

---

## 4. 删减方案：逐项成本与替代

| 功能 | 后端成本 | 砍掉后怎么替代 | 建议 |
|---|---|---|---|
| **账号体系**（登录/注册/邀请码/答题/找回码/改昵称） | ~1100 行 · 9 张表 | 整块删除，站点免登录 | **砍** |
| **论坛**（发帖/评论/土豆/接龙/认领/安利墙） | ~900 行 | 导出成静态存档页，只读保留 | **砍或转只读** |
| **投稿收件箱**（投稿/联系/推荐/定制） | ~200 行 · 1 张表 | 换成腾讯问卷等第三方表单，零后端且自带通知 | **砍** |
| 小说 / 漫画评论 | ~150 行 | 去掉，或挂第三方评论 | 砍 |
| 公告 | ~80 行 | 静态 JSON，图片进仓库随构建发布 | **静态化** |
| 小说正文 | ~120 行 | 静态文件；加密本前端本来就能解（`src/utils/secureComicDecrypt.js`） | **静态化** |
| 市集 | ~100 行 | 静态 JSON | **静态化** |
| 管理员上传（漫画/图） | ~300 行 | 改成本地脚本跑完 `git push`（现已是这个模式） | **半静态** |
| **头号玩家排行榜** | ~200 行 · 2 张表 | 唯一真需要写库的 | **保留** |

### 三个关键判断

1. **账号体系吃掉了 9 张表**，它只服务三件事：论坛发帖、评论归属、排行榜身份。砍掉论坛后，账号的必要性大幅下降——排行榜完全可以用"昵称 + 分数"匿名提交，不需要密码、邀请码、答题挑战整套。
2. **公告、小说、市集本质是只读内容**，当前流程是管理员写好存 COS、前端再拉一次。改成仓库里的 JSON 后随前端一起构建发布，**少一次网络往返，国内访问反而更快**。
3. **投稿收件箱不需要后端**——它就是个收件箱，任何表单服务都能干，还自带通知和表格导出。

### 删减后的三种形态

- **A · 纯静态**：连排行榜都改成本地最高分（localStorage）。后端归零，可直接丢 GitHub Pages。
- **B · 最小动态**：只留在线排行榜，免登录昵称提交 + 每日限次防刷。约 200 行 + 2 张表。**推荐**
- **C · 保留账号 + 论坛**：那就是完整迁移，不属于删减范畴。

---

## 5. 国内访问维度（影响方案选择的关键约束）

Cloudflare 在**中国大陆没有正式边缘节点**，请求被 Anycast 调度到香港/东京/新加坡，偶绕洛杉矶/法兰克福。2026 上半年多站实测：

| 运营商 | 延迟 | 丢包 | 体感 |
|---|---|---|---|
| 电信 | 80–150ms | 较少 | 能用，偶尔慢 |
| 联通 | 120–200ms | 中等 | 晚高峰明显变慢 |
| **移动** | **200–400ms+** | **较高** | **经常打不开或超时** |

- `*.workers.dev` 默认域名在国内（尤其移动网）**经常 DNS 解析失败**，真要用必须绑自定义域名。
- 微信内置浏览器对海外 + 未备案域名更严格——**同人圈传播重度依赖微信/QQ 转发**，这条近乎致命。
- Cloudflare 官方"中国网络"（京东云合作）仅限企业版、数千美元/月、需备案，与免费层无关。

**对本项目的推论**：图片/漫画是站点主体流量，走 R2 等于让国内用户跨境拉大图；手机 + 移动网用户占比高，正好是 CF 表现最差的一档。
**按国内访问速度排序：腾讯云（充值）> Vercel ≈ 现状 >> Cloudflare。**

---

## 6. 待校准项

以下数据缺失，会实质影响结论，需要你提供或实测后填入：

| 项 | 为什么重要 |
|---|---|
| 实际欠费金额 / 上月用量 | 决定路线 A 的真实月成本。若每月远超 ¥20，迁移的性价比会上升 |
| COS 实际数据量 | 迁移中最大的隐性工作量。GB 级和百 MB 级完全是两个难度 |
| 站点月 PV 与用户地域分布 | 决定免费额度够不够、以及国内访问权重的取舍 |
| 论坛/评论的真实活跃度 | 决定砍掉它们的内容损失有多大 |

建议用 itdog.cn 的 HTTP 测速输入 `https://www.levihan.asia`，看国内各省响应时间与成功率，先摸清用户实际体感。

---

## 7. 待你拍板的四个问题

1. **账号体系**：整个砍掉 / 只留昵称免密码 / 完整保留？
2. **论坛**：转只读存档 / 整个砍掉 / 完整保留互动？
3. **排行榜**：保留在线榜（免登录）/ 改成手机本地最高分 / 保留且要登录？
4. **投稿收件箱**：换成第三方表单 / 改成邮箱或社交账号入口 / 保留自己的后端？

四个问题定完后即可给出具体的分步执行计划。
