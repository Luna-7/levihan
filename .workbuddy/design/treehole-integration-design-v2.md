# 深夜树洞 · 详细技术设计 v2（可落地规格）

> 状态：**设计定稿候选，仍未写任何代码**
> 前序：`treehole-integration-design-v1.md`（体检 + 方案对比 + 登录论证）
> 本版把 v1 的 6 个决策点按"最优"定值，并展开到可直接施工的粒度。
> 核心约束（来自你的要求）：**保留"别人拾取"**，且它必须是**真的别人**——不是自己浏览器里那个数组。

---

## 0. 已定方案（v1 决策点的最终取值）

| # | 决策 | 定值 | 一句话理由 |
|---|---|---|---|
| 1 | 嵌合方式 | **iframe**（`public/treehole/`） | 一次性绕开 3 处全局 CSS 冲突，且与既有「塔塔开」范式同构 |
| 2 | 拾取语义 | **不消耗 + 双层未读优先** | 保住"永久保存"，又让每条卷轴都有机会被读到 |
| 3 | 登录 | **不上**，用无感设备身份 | 树洞靠匿名；且个人主体拿不到微信/QQ 网页授权资质 |
| 4 | 存储层 | **CloudBase 云数据库** | 公开匿名并发写入不能用 COS 单 JSON（读-改-写会丢数据） |
| 5 | 永久性 | 接受"体验版到 2027-03-13 + 后续续费/迁移" | 见 §12，配导出备份兜底 |
| 6 | 导航标签 | **「深夜树洞」** | 与 `HeaderCard` 现有 4 个标签的 2/4/7 字长度节奏一致 |

---

## 1. 设计红线（不可动摇的不变式）

这五条是评审任何实现细节时的判据，违反即打回：

1. **视觉、动效、音效零改动**。现有像素森林、卷轴飞出动画（`flyScrollFromHollow` 680ms）、合成音效、五个分类标记、阅读弹窗的点赞/送热汤全部保留。本次只替换**数据层**。
2. **匿名**：不记录 IP、不记录 User-Agent、不记录浏览器指纹。服务端对设备只持有一个**不可逆哈希**。
3. **拾取永不消耗内容**。任何"捡走即消失"的实现都违反"永久保存"。
4. **不做公开列表**。没有"浏览别人所有卷轴"的入口——那会把树洞变成匿名留言板，隐喻和体验一起垮掉。
5. **浏览器不直连数据库**。所有读写经云函数，否则限流、内容审核、伪造时间戳全部失守。

---

## 2. 系统结构

```
┌────────────────────────────────────────────────────────────────┐
│ 主站（Vite 静态，CloudBase hosting）                            │
│   HeaderCard ── 5 个 tab ──▶ TreeHoleStage（新增组件）            │
│                                  └─ <iframe src="/treehole/">   │
├────────────────────────────────────────────────────────────────┤
│ /treehole/ 静态子应用（独立构建，视觉与现状完全一致）              │
│   App.tsx ──▶ src/api/treehole.ts（新增：设备身份 + 接口封装）    │
├────────────────────────────────────────────────────────────────┤
│ 云函数 treehole-api（Event 函数 + HTTP 访问服务）                 │
│   鉴权 → 校验 → 限流 → 敏感词 → 读写 DB                          │
│   ⚠ 不加 --httpFn（见 .workbuddy/memory/MEMORY.md）              │
├────────────────────────────────────────────────────────────────┤
│ CloudBase 云数据库                                                │
│   scrolls（卷轴） / reads（已读去重） / stats（计数器）            │
└────────────────────────────────────────────────────────────────┘
```

**为什么拾取必须经过云函数而不是前端直连**：如果前端能直接查库，那么任何人都能把整个集合拉下来——树洞里所有的秘密一次泄露，"别人拾取"的仪式感也没了。云函数是**唯一入口**，也是限流与内容审核的落点。

---

## 3. 匿名身份：无感、无登录

### 3.1 握手（首次访问，用户无感）

```
前端首次访问
  deviceId = crypto.randomUUID()            // 存 localStorage: 'lh_th_device'
  POST /treehole-api  { action: 'handshake', deviceId }
服务端
  格式校验：必须匹配 UUID v4
  deviceHash = HMAC_SHA256(deviceId, SERVER_SECRET)   // 单向，不可逆推 deviceId
  签发 pass
  返回 { pass, exp }
```

- `SERVER_SECRET` 存在 `cloudbase/.env`，与现有 `ADMIN_PASSWORD` 同一套注入方式（cloudbaserc 的 `{{env.X}}` 替换，已实测有效）。
- **数据库里只出现 `deviceHash`，永远不出现 `deviceId`**。即使库被脱，也无法反推出设备的原始标识。

### 3.2 pass 格式与校验

```
pass = `${exp}.${deviceHash}.${sig}`
sig  = base64url( HMAC_SHA256(`${exp}|${deviceHash}`, PASS_SECRET) )
```

- 请求头带 `X-Treehole-Pass`。
- 服务端校验：段数 → 有效期 → `timingSafeEqual` 比对签名。
- 这三件事（`signExp` / `verifyToken` / `safeEqual`）在 `cloudbase/functions/admin-upload/index.js` 里**已经实测跑通**，直接复用，零新增风险。
- pass 有效期 **180 天**；过期或缺失时前端**静默重新握手**，用户完全无感。

### 3.3 能力与边界

| 能做什么 | 靠什么 |
|---|---|
| 记住"我的卷轴"、删除自己的卷轴 | `scrolls.deviceHash` |
| 一人一赞 / 一汤（防刷到 9999） | `deviceHash` + 反应去重 |
| 频率限流 | `deviceHash` + 计数 |
| 拾取去重（本设备未读） | `deviceHash` 参与 HMAC，见 §4.2 |

**边界（必须如实告知用户）**：清缓存 / 换浏览器 / 换设备 = 换身份，"我的卷轴"列表会丢。**这个"不可靠"对树洞是优点**——它天然不支持跨设备追踪，服务端也拼不出同一个人的全貌。

> 可选 P5「恢复码」：给用户一个 12 位随机码，服务端存 `recoveryCode → deviceHash`。换设备输入即可找回自己的卷轴。**不是账号**（不绑任何真实信息），但能救回体验。默认不做，等有人抱怨再说。

---

## 4. 数据模型（定稿）

### 4.1 `scrolls` — 卷轴

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | DB 自动 |
| `content` | string | ≤ 200 字（沿用 `WriteScrollModal.tsx:149` 的现有限制） |
| `author` | string | ≤ 16 字（沿用 `:170`）；空则 `"巨木森林同行者"` |
| `category` | string | `secret` \| `miss` \| `wish` \| `release` \| `whisper` |
| `createdAt` | number | **服务端时间**，不信任客户端 `Date.now()`（现有 `WriteScrollModal.tsx:38` 可伪造） |
| `likes` | number | 献出心脏计数 |
| `steam` | number | 送热汤计数 |
| `readCount` | number | **被拾取次数**（投放者可看的反馈，见 §5.7） |
| `status` | string | `visible` \| `hidden` \| `deleted` |
| `deviceHash` | string | 投放者（仅用于"我的卷轴"与自删） |
| `reportCount` | number | 举报计数 |
| `seeded` | boolean? | 上线种子数据标记（见 §5.8） |

### 4.2 `reads` — 已读去重（**隐私关键设计**）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | DB 自动 |
| `rk` | string | `HMAC_SHA256(`${deviceHash}|${scrollId}`, READ_SALT)`，**唯一索引** |
| `createdAt` | number | 仅用于按龄清理过期记录 |

**这里刻意不存 `deviceHash`、也不存 `scrollId`。** 理由：

- 存了这两个字段，库里的数据就能被还原成一张"谁读了谁的"关系表——对树洞来说是**比记录 IP 更严重的隐私泄露**；
- 只存 `rk` 后，去重能力（判断"这台设备读没读过这条"）**完全保留**，但任何单条记录都推不出关联，除非同时拿到 `deviceHash`、`scrollId` 和 `READ_SALT` 三者。
- `rk` 可以就地计算（拿到候选卷轴后算一次 HMAC 去查），所以**不需要按设备查询**，这个设计在性能上也是最优的。

### 4.3 `stats` — 计数器

| 字段 | 用途 |
|---|---|
| `visibleCount` | 可见卷轴总数，避免每次拾取都做 count 查询 |

用原子自增维护，允许偶发漂移（拾取时做一次兜底校正）。

### 4.4 索引清单

| 集合 | 索引 | 作用 |
|---|---|---|
| `scrolls` | `status + createdAt(desc)` | 拾取候选、管理列表 |
| `scrolls` | `status + readCount` | 优先取"全局未读"的卷轴（§5.2） |
| `scrolls` | `deviceHash` | 「我的卷轴」 |
| `reads` | `rk`（**unique**） | 去重判定 + 防并发重复写入 |
| `reads` | `createdAt` | 按龄清理 |

〔待校验〕CloudBase 云数据库在体验版下是否支持 unique 索引与 TTL 索引、集合数量上限——**施工第一步就去控制台确认**，若 unique 索引不可用，改用"先查后写 + 忽略重复"的降级方案（不影响正确性，只影响极小概率的并发重复）。

### 4.5 为什么不能用同人本那套 `archive.json`

现有 `admin-upload` 是"读整个 JSON → 改 → 写回"。单管理员低频写入没问题，但树洞是**公开匿名并发写入**：

> 两个人同时投稿 → 都读到同样 100 条 → 各自追加自己的 → 后写的覆盖先写的 → **必丢一条**。

这是设计层面的缺陷，不是概率问题。云数据库的原子 `add` 从根上解决。

---

## 5. 拾取算法（本方案的核心）

### 5.1 想同时满足的四个性质

| 性质 | 为什么重要 |
|---|---|
| **不消耗** | 卷轴永久保存，反复被不同的人读到 |
| **本设备不重复** | 每次点击都是新内容，不是同一张卷轴反复弹 |
| **全局未读优先** | 新投的卷轴不会因为池子大而被埋没——**投放者能很快看到有人读过** |
| **读完了要说清楚** | 不能无限返回同一条，也不能假装还有（那会摧毁信任） |

### 5.2 双层候选（这样解决"新卷轴没人看"）

```
第一层候选：{ status: 'visible', readCount: 0 }        ← 从没被人拾取过的
第二层候选：{ status: 'visible' }                       ← 全部可见卷轴
```

- 先在第一层里采样，过滤掉本设备已读的；命中 → 返回。
- 第一层耗尽（或采到的都被自己读过）→ 落到第二层，同样过滤本设备已读。
- 第二层也过滤空了 → 说明**这台设备已经读完了洞里所有卷轴** → 返回 `exhausted: true`。

效果：新投的卷轴会被优先捡起（`readCount` 从 0 变 1 很快），老卷轴在新内容读完之后接手，**没有一条会被永久埋没**。

### 5.3 随机取样：随机游标法（不做 `skip(random)`）

`skip(N)` 是 O(N) 的，池子大了会拖垮性能。改用随机游标：

```
r = 随机 _id 下界（取全集 _id 空间里的一个随机值，或用一个随机时间戳）
取 limit=20 条 where _id > r 且 status='visible'，orderBy _id
若返回空 → 从集合头部再取 limit=20 条（绕回）
```

一次拿 20 条候选，在这 20 条里做过滤与随机选择。命中率高、成本恒定。

〔待校验〕CloudBase 云数据库是否直接支持 `_id` 的 `gt` 查询与自定义 `_id` 写入。若不支持自定义 `_id`，降级为「在 `createdAt` 上做随机游标」（`createdAt > 随机时间戳`），效果等价。

### 5.4 伪代码（完整规格）

```js
async function pick(deviceHash) {
  for (const tier of [{ readCount: 0 }, {}]) {          // 第一层 → 第二层
    for (let attempt = 0; attempt < 3; attempt++) {
      const cands = await sampleCandidates(tier, 20);   // 随机游标，见 §5.3
      if (!cands.length) break;                         // 该层为空，换下一层

      const unseen = [];
      for (const c of cands) {
        const rk = hmac(`${deviceHash}|${c._id}`, READ_SALT);
        if (!(await readExists(rk))) unseen.push(c);    // 只存 rk，见 §4.2
      }
      if (!unseen.length) continue;                     // 这 20 条自己都读过，重采样

      const chosen = unseen[Math.floor(Math.random() * unseen.length)];

      // 落库：写去重记录 + 原子自增被拾取次数
      await Promise.all([
        insertRead({ rk: hmac(`${deviceHash}|${chosen._id}`, READ_SALT), createdAt: now() }),
        incScroll(chosen._id, { readCount: 1 }),
      ]);
      return { scroll: publicView(chosen) };
    }
  }
  return { scroll: null, exhausted: true };
}
```

**`publicView()` 必须剥离**：`deviceHash`、`status`、`reportCount` 一律不下发。前端只应看到 `id / content / author / category / createdAt / likes / steam / readCount`。

### 5.5 边界情况

| 情况 | 行为 |
|---|---|
| 洞里一条都没有 | `scroll: null, exhausted: true` → 前端提示"树洞还很空，你是第一个投递的人" |
| 本设备读完所有卷轴 | 前端提示"你已经读完了洞里所有的卷轴"，给两个出口：**随机重读一条**（此时不过滤已读）/ **去写一条** |
| 并发拾取 | `reads.rk` 唯一索引兜住重复写入；重复只会导致 `readCount` 多算 1，可接受 |
| 拾取瞬间卷轴被管理员删除 | 返回 `404` → 前端 toast"这张卷轴刚刚被取走了"并自动重试一次 |
| 采样 3 次都失败 | 视为该层无未读，进入下一层；两层都失败 → `exhausted` |
| 第一层候选全被本设备读过 | `continue` 重采样，不降级到第二层（第二层里还是这些） |

### 5.6 为什么不加"公开列表"和"按分类筛选拾取"

- **公开列表**：违反红线 4。匿名心事被当成内容流浏览，用户会开始"表演"，树洞就死了。
- **按分类筛选拾取**：看似贴心，实则让拾取变成有目的的检索。树洞的价值在**偶然遇到**。分类标记保留在**投放侧**和**阅读侧展示**（让读到的人理解对方的心情），但不作为筛选入口。

### 5.7 投放者反馈：`readCount`

「我投递的卷轴」列表里，每张卷轴显示 **「已有 N 位同行者读到」**。

- 这是让"投放"这件事**有回报**的关键——投出去石沉大海是最劝退的体验；
- 只给计数，**不给是谁**；
- 与"不消耗"配合，计数会持续增长，形成正反馈。

### 5.8 上线种子：别让树洞一开始是空的

把现有 `src/data/initialScrolls.ts` 的 4 条示例卷轴作为**种子数据**写入 DB，`author` 标为 `"巨木森林的旧卷"`、`seeded: true`。理由：空树洞的第一次体验极差（点拾取 → "树洞空空如也"），种子给它一个"这里已经有人在说话了"的开局。

---

## 6. 接口契约（定稿）

统一 `POST https://<env>.service.tcloudbase.com/treehole-api`，请求体 `text/plain` 承载 JSON（**规避预检，网关会合并函数的 CORS 头** —— 这个技巧在 `admin-upload` 已验证）。除 `handshake` 外全部要求 `X-Treehole-Pass`。

| action | 入参 | 成功出参 | 失败 |
|---|---|---|---|
| `handshake` | `deviceId` | `{ pass, exp }` | 400 `BAD_DEVICE_ID` |
| `cast` | `content, author?, category, deviceId?` | `{ id, createdAt }` | 400 `EMPTY_CONTENT` / `TOO_LONG` / `BAD_CATEGORY`；429 `RATE_LIMITED` |
| `pick` | — | `{ scroll }` 或 `{ scroll: null, exhausted: true }` | 401 `BAD_PASS` |
| `pickAgain` | — | `{ scroll }`（**不过滤已读**，用于"读完后再看一条"） | 401 / 404 |
| `listMine` | — | `{ scrolls: [...] }`（含 `readCount`） | 401 |
| `deleteMine` | `id` | `{ ok: true }`（仅当 `deviceHash` 匹配 → 置 `status: deleted`） | 403 `NOT_OWNER` |
| `react` | `id, kind: 'like'\|'steam'` | `{ likes, steam }` | 409 `ALREADY_REACTED` |
| `report` | `id, reason?` | `{ ok: true }` | 404 |
| `adminLogin` | `password` | `{ token }` | 401 |
| `adminList` | `status?, offset?, limit?` | `{ items, total }` | 401 |
| `adminSetStatus` | `id, status` | `{ ok: true }` | 401 |
| `adminExport` | — | `{ count, json }` | 401 |

**错误码表（统一结构 `{ ok:false, code, message }`）**

| code | HTTP | 含义 |
|---|---|---|
| `BAD_DEVICE_ID` | 400 | 不是合法 UUID v4 |
| `EMPTY_CONTENT` / `TOO_LONG` | 400 | 内容空 / 超 200 字 |
| `BAD_CATEGORY` | 400 | 分类不在白名单 |
| `BAD_PASS` | 401 | 签名错 / 过期 |
| `NOT_OWNER` | 403 | 想删别人的卷轴 |
| `SCROLL_GONE` | 404 | 卷轴已被删除 |
| `ALREADY_REACTED` | 409 | 同一设备重复反应 |
| `RATE_LIMITED` | 429 | 触发限流 |
| `BLOCKED_CONTENT` | 422 | 命中敏感词 |
| `SERVER_ERROR` | 500 | 兜底（对外不吐内部信息） |

---

## 7. 风控与内容安全

### 7.1 限流（按 `deviceHash`）

| 行为 | 阈值〔初始值，可调〕 | 超限 |
|---|---|---|
| 投放 | 10 分钟 ≤ 3 条，且每日 ≤ 20 条 | 429，前端提示"让巨树喘口气" |
| 拾取 | 每分钟 ≤ 30 次 | 429（这一条主要是防脚本整库爬取） |
| 反应 | 每条卷轴每设备 1 次 | 409 |
| 举报 | 每设备每日 ≤ 10 次 | 429 |
| 握手 | 每 IP 每小时 ≤ 60 次〔这一项不可避免要接触 IP，仅用于计数，不落库〕 | 429 |

### 7.2 内容安全

1. **敏感词过滤**（落库前，服务端）——先上一份本地词表，覆盖违法/色情/辱骂/引流广告四类；
2. 〔待校验〕可对接**腾讯云文本内容安全（TMS）** 做机器审核，需确认体验版下的免费额度与调用方式。**建议 P4 再上**，P2/P3 先用本地词表 + 人工审核顶着；
3. **举报自动降级**：`reportCount ≥ 3` → 自动置 `hidden`，进管理待审队列（不直接删，避免恶意举报构陷）。

### 7.3 为什么管理出口是必需品

匿名开放写入 + 没有审核出口 = 迟早出内容事故。站点可能被举报、被墙、被封。**没有 P4，就不要上线公开写入。** 这条不接受妥协。

---

## 8. 管理侧设计

- 入口：`/admin/treehole.html`（与现有 `/admin/` 同级的独立静态页，`noindex`，不进主站 bundle）。
- 鉴权：复用 `ADMIN_PASSWORD` + HMAC token（`admin-upload` 那套，已跑通）。
- 能力：
  1. 列表（按 `status` / `reportCount` / `createdAt` 过滤，分页）
  2. 单条置 `visible` / `hidden` / `deleted`
  3. 举报待审队列（按 `reportCount` 倒序）
  4. **一键导出全量 JSON**（备份与迁移的唯一保障）
  5. 概览统计：总数 / 今日新增 / 被拾取总次数 / 零拾取卷轴数（后者能告诉你有没有卷轴被埋没）
- 不做：编辑用户内容。"隐藏/删除"是审核动作，"改写别人的心事"不是。

---

## 9. 树洞侧改动清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/api/treehole.ts` | **新增** | 设备身份（`deviceId` 生成与持久化）、握手与 pass 续期、`api()` 封装、错误码 → 中文提示映射 |
| `src/App.tsx` | 改 | 把两处 `localStorage` 换成 `api()`；加 `loading` / `error` 态；`handleDelveHollow` 改为调 `pick`；`handleWriteSubmit` 改为 `await cast`；「我投递的」列表加 `readCount` 展示 |
| `src/components/WriteScrollModal.tsx` | 改 | 提交改为等待服务端结果；失败保留已填内容并给出可读错误（不要静默丢字） |
| `src/components/ReadScrollModal.tsx` | 改 | `like` / `steam` 改为调 `react`；显示「已有 N 位同行者拾取过」 |
| `src/data/initialScrolls.ts` | 改 | 不再作运行时种子；仅保留 `CATEGORY_NAMES`（分类名与图标），示例数据移到种子脚本 |
| `src/utils/watermarkRemover.ts` | **删** | 105 行死代码，从未被 import |
| `src/assets/images/pixel_forest_scene_*.jpg` | **删** | 与 `public/default_forest_bg.jpg` **MD5 完全相同**，白占 908KB |
| `vite.config.ts` | 改 | 加 `base: '/treehole/'`，否则 iframe 里的资源路径会 404 |
| `index.html` | 微调 | `title` 改为「深夜树洞 · 利韩土豆仓」；`robots` 加 `noindex`（内容不应被搜索引擎收录） |

**拾取时的延迟处理**（现有动画是 680ms，网络往返会打乱节奏）：

```
点击
 ├─ 立即 sound.playRetrieve() + 起飞动画（乐观，不等待）
 └─ 同时发 pick 请求
     ├─ 在 680ms 内返回 → 动画结束即展开卷轴（理想）
     ├─ 未返回 → 停在 loading 态，最多再等 1200ms
     └─ 超时 / 报错 → toast 提示并回位，不消耗任何「已读」状态
```

---

## 10. 主站嵌合清单

| 文件 | 位置 | 动作 |
|---|---|---|
| `src/components/HeaderCard.tsx` | `:6-7` | tab 联合类型加 `'treehole'` |
| 同上 | `:67` | `grid grid-cols-2 sm:grid-cols-4` → `sm:grid-cols-5`；移动端第 5 项加 `col-span-2`（否则 2 列网格剩半个空位） |
| 同上 | `:113-126` 后 | 追加第 5 个 tab 按钮，文案「深夜树洞」，图标 `🪵`，选中态配色 **深墨蓝 `#2B3A55`**（与现有 4 个 tab 的绿/紫/红各占一色形成第五色，且呼应树洞的暗色主题） |
| `src/components/TreeHoleStage.tsx` | **新增** | 照 `TatakaruGame.tsx:247-267` 的范式：机框（顶栏指示灯条）+ 加载骨架 + 全屏按钮 + `<iframe src="/treehole/index.html" allow="autoplay">` |
| `src/App.tsx` | `:14` | tab 联合类型加 `'treehole'` |
| 同上 | `:17` | `?tab=` 白名单加 `treehole`（支持 `?tab=treehole` 直达分享） |
| 同上 | `:127-130` 后 | 追加 `activeTab === 'treehole'` 分支 |

**iframe 尺寸规格**（沿用塔塔开的宽度公式，比例改为树洞的 448:860）：

```css
aspect-ratio: 448 / 860;
width: min(calc(100vw - 56px), calc((min(76vh, 860px) - 46px) * 448 / 860), 460px);
height: auto;
```

**音效冲突处理**（这是 iframe 方案唯一的真实副作用）：
- 主站的 `soundManager` 管不到 iframe 内部，反之亦然；
- 树洞现有代码已经是"用户手势后才播"，**不会在进入 tab 时突然出声**，这已经是正确行为，无需改；
- 机框上放一句轻提示：「树洞内自带音效开关」；
- 可选 P5：用 `postMessage` 双向同步静音状态（锦上添花，不作首期要求）。

---

## 11. 测试与验收

### 11.1 后端（Python + 真实 HTTP，沿用 `test-admin-channel.py` 的写法）

断言至少覆盖：
- 握手：合法 UUID 通过、非法格式拒绝、pass 可校验、过期 pass 拒绝、伪造签名拒绝
- 投放：正常写入、空内容拒绝、201 字拒绝、非法分类拒绝、限流触发 429、命中敏感词 422
- 拾取：**连续拾取 N 次不重复**、第一层（`readCount:0`）优先被命中、两层都耗尽返回 `exhausted`
- 反应：首次成功、二次 409、计数正确
- 自删：本人成功、他人 `NOT_OWNER`
- 隐私：响应体**不含** `deviceHash` / `status` / `reportCount`；库内**不含** `deviceId` 原文；`reads` 记录**不含** `deviceHash` 与 `scrollId`
- 管理：列表 / 置状态 / 导出 JSON / 口令错误拒绝
- 清理：测试数据全部删除，库还原到基线

### 11.2 浏览器（**这是唯一能验证"别人能拾取"的方式**）

关键设计：用 **两个独立的 browser context** 模拟两个真实的人。storage 与身份完全隔离。

```
context A：投放一条带唯一标记的卷轴
context B：连续点击拾取，直到出现 A 的那条 ── 断言必须命中
断言 B 的响应里不包含 A 任何身份信息
断言 A 的「我投递的」列表里 readCount ≥ 1      （投放者反馈闭环）
断言 B 重复拾取不再出现同一条
context A 删除该卷轴 → context B 再拾取不会拿到它
```

> v1 的教训：`pagePadDigits:0` 那个真实 bug 就是被浏览器级验证抓到的，接口级测试看不见。**这个双 context 测试是本次方案的核心验收项**，不是可选项。

### 11.3 每阶段验收标准

| 阶段 | 通过标准 |
|---|---|
| P1 | 主站 5 个 tab 正常切换；`?tab=treehole` 直达；iframe 内树洞可完整交互；主站其余 4 个 tab 无任何视觉/行为变化；`npm run build` ✓ |
| P2 | 云函数部署成功，`handshake` + `cast` + `pick` 真实 HTTP 走通 |
| P3 | 11.1 + 11.2 全部通过 |
| P4 | 管理侧可审核/删除/导出；导出 JSON 可完整还原 |
| P5 | 按需 |

---

## 12. 容量与成本〔待校验〕

| 项 | 估算 | 备注 |
|---|---|---|
| 单条卷轴存储 | ≈ 600 字节（200 字 UTF-8 + 元数据） | |
| 1 万条卷轴 | ≈ 6 MB | 存储层面完全不构成压力 |
| 日读量（假设 100 活跃用户 × 5 次拾取） | ≈ 500 次读 + 每条 1 次 `reads` 查询 | 量级很小 |
| 日写量 | ≈ 20 条投放 + 500 条 `reads` 记录 | |
| `reads` 增长 | 每（设备 × 新读卷轴）一条 → 会持续增长 | 需要按 `createdAt` 定期清理（如保留 1 年），否则会超过卷轴本身的数量级 |
| 云数据库免费额度 | **〔待校验〕** | 施工第一步去控制台确认 |
| 体验版到期 | **2027-03-13**〔依项目记录，请复核〕 | 到期前必须续费或迁移 |

**迁移预案**：`adminExport` 导出的 JSON 是**自包含**的（卷轴全字段 + 明文结构），换任何后端都能重新导入。这是"永久保存"这条承诺在工程上唯一站得住的做法——比任何平台的"永久"承诺都可靠。

---

## 13. 分期落地与交付物

| 阶段 | 交付物 | 是否碰数据层 |
|---|---|---|
| **P1 嵌合壳** | `public/treehole/` 构建产物、`TreeHoleStage.tsx`、HeaderCard/App 的 tab 改动 | ❌ 不碰（树洞仍是本地存储，但已能在主站里点起来） |
| **P2 后端地基** | `cloudbase/functions/treehole-api/`、3 个集合与索引、`handshake` / `cast` / `pick` | 新建 |
| **P3 全功能** | `pickAgain` / `listMine` / `deleteMine` / `react` / `report`、`src/api/treehole.ts`、双 context 测试 | 改数据层 |
| **P4 管理侧** | `/admin/treehole.html`、敏感词表、举报队列、导出 | 加接口 |
| **P5 可选** | 恢复码 / 群口令 L1 / 音效 postMessage 同步 | 按需 |

**建议节奏**：P1 独立交付并让你先看观感——改动小、可回滚、不动逻辑。看完满意再投 P2/P3 的后端工作量。

---

## 14. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 体验版到期（2027-03-13） | **全部卷轴丢失** | 到期前续费/升级；管理侧导出 JSON 定期备份 |
| 匿名内容出事故 | 站点被封，"永久保存"落空 | P4 管理出口 + 敏感词 + 举报降级；**P4 未完成不上线公开写入** |
| 被脚本整库爬取 | 全部心事泄露 | 不做公开列表 + 拾取限流（每分钟 30 次）+ 唯一入口云函数 |
| 云数据库能力假设不成立 | 索引/查询写法需调整 | 已标注〔待校验〕；施工第一步先验证，并给出降级路径 |
| `reads` 无限增长 | 存储与查询成本上升 | 按 `createdAt` 定期清理（保留 1 年即可，不影响体验） |
| iframe 内音效不受主站控制 | 观感小瑕疵 | 树洞本就需要手势才出声，实际无感；可选 postMessage 同步 |
| 用户清缓存丢"我的卷轴" | 体验损失 | 文档如实说明；可选 P5 恢复码 |

---

## 15. 现在只剩这些需要你点头

| # | 事项 | 我的建议 |
|---|---|---|
| 1 | 是否按"P1 先交付壳、看到观感再投后端"的节奏 | 是 |
| 2 | 投放限流阈值（10 分钟 3 条 / 每日 20 条） | 先用这个，上线后按实际调 |
| 3 | 举报 ≥3 次自动隐藏（而非直接删） | 是（防恶意举报构陷） |
| 4 | 上层种子数据：把现有 4 条示例卷轴作为"古树旧卷"写入 | 是（避免空树洞的糟糕首体验） |
| 5 | 导航标签定名「深夜树洞」 | 是 |
| 6 | P5 的恢复码 / 群口令是否预留 | 预留接口，默认不开 |

---

## 附：素材来源索引（本版新增部分）

**树洞侧**
- `src/components/WriteScrollModal.tsx:38` — 客户端 `Date.now()`（可伪造，故服务端重写时间）
- `src/components/WriteScrollModal.tsx:149, 170` — 200 字 / 16 字上限（沿用）
- `src/data/initialScrolls.ts` — 4 条示例卷轴（转作种子）
- `src/components/PixelForestScene.tsx:22` — 自定义背景同样依赖本地存储
- `src/index.css:36-74` — `flyScrollFromHollow` 680ms（拾取节奏约束的依据）
- `src/utils/watermarkRemover.ts` — 死代码
- 两张 MD5 相同的 908KB 背景图

**主站侧**
- `src/components/HeaderCard.tsx:6-7, 67, 113-126` — tab 类型与 2×4 网格
- `src/App.tsx:14, 17, 127-130` — tab 类型、`?tab=` 白名单、分区渲染
- `src/components/TatakaruGame.tsx:247-267` — iframe 范式与宽度公式

**已跑通、可复用**
- `cloudbase/functions/admin-upload/index.js` — Event 函数 + HTTP 访问服务、`signExp`/`verifyToken`/`safeEqual`、`text/plain` 规避预检、`{{env.X}}` 注入
- `.workbuddy/memory/MEMORY.md` — 部署命令、`--httpFn` 禁令、部署前 `node --check`、体验版到期日
- `.workbuddy/tests/test-admin-channel.py` — 后端真实 HTTP 测试写法
- `.workbuddy/tests/test-admin-ui.cjs` — 浏览器测试写法（含测试域名中间页自动点过）

**外部依据**
- 微信开放社区 / 微信服务市场：网页授权仅限非个人主体的认证服务号
- QQ 互联《网站审核规范》：网站地址与回调地址需完成工信部备案

**〔待校验〕清单（施工前必须逐项确认）**
1. CloudBase 云数据库在体验版下的免费读写额度与集合数上限
2. 是否支持 unique 索引（`reads.rk`）与 TTL/按龄清理
3. 是否支持自定义 `_id` 及 `_id` 的 `gt` 查询（决定 §5.3 用 `_id` 还是 `createdAt` 做随机游标）
4. 腾讯云文本内容安全（TMS）的免费额度与接入方式
5. 云数据库是否提供自动备份，备份保留时长
