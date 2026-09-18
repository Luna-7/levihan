# 头号玩家 · 三游戏排行榜设计 v2（已实现）

> 位置：首页 → 塔塔开·街机 → 弹出卡片内，三个游戏按钮的最下方
> 代码落点：`src/components/ImmersiveGameHome.tsx`（`activeModal === 'game'` 弹窗）
> 状态：**前端与云函数已实现，云函数待部署**

---

## 一、收录范围（2026-09-17 定）

| 游戏 | 是否进榜 | 收录条件 |
|---|---|---|
| 🍉 利韩·合成大西皮 `daxigua` | ✅ | 全难度，取本次进入后的最高分 |
| 🛡️ 利韩·拯救韩吉 `hange` | ✅ | **仅「绝境」难度**，且**仅突围成功**（失败不上报） |
| 🥔 利韩·利了个韩 `lihan` | ❌ | 暂不参与头号玩家，不参与任何计算 |

「绝境」是拯救韩吉三档难度（简单 / 经典 / 绝境）中的最高档，常量 `RANKED_DIFFICULTY = 'hard'` 定义在 `src/save-hange/constants.ts`，游戏侧与云端校验共用。

---

## 二、统一口径：积分值 MP

两款游戏量纲不同，先各自归一到 0–1000 的积分值，再相加成总榜。

| 游戏 | 公式 | 满分条件 |
|---|---|---|
| 🍉 大西皮 | `MP = round(min(score, 3000) / 3)` | 3000 分封顶即满积分，同时兜底无敌模式刷分 |
| 🛡️ 拯救韩吉 | `MP = 400 + 300×剩余时间比 + 300×步数系数`<br>步数系数 = `clamp(1 - (moves - 30) / 30, 0, 1)` | 终曲刚开始就突围 + 30 步内解决 |

基准值集中在两处，**必须同步修改**：
- 前端 `src/utils/gameScores.ts` → `MERIT_TUNING`
- 云端 `cloudbase/functions/submitGameScore/index.js` → `TUNING`

〔待校准〕3000 分封顶与 30 步标准杆都是按经验拍的，需各打若干局采样后调整。

**积分一律在服务端重算**，客户端只传原始成绩 —— 否则归一化形同虚设。

---

## 三、成绩采集（三条路径，两款游戏）

| 游戏 | 路径 |
|---|---|
| 🍉 大西皮 | `public/daxigua/index.html` 里 hook `Storage.prototype.setItem`，捕获 Cocos 写 `playerData11` 时把分数 `postMessage` 给宿主。**不改动压缩过的 `project.js`** |
| 🛡️ 拯救韩吉 | 复用已有的 `postMessage` 协议，与 `save-hange-bgm` 平级新增 `save-hange-result`，在 `handleWin` 且难度为 hard 时发出 |
| 🥔 利了个韩 | 无（不进榜） |

三条路径都汇到 `TatakaruGame` 的 `message` 监听，暂存在 ref 里，在**退出对局 / 切换游戏 / 组件卸载**时统一 `submitScore` 提交。只在刷新纪录时弹 toast，不打断玩家。

---

## 四、数据模型（PostgreSQL · CloudBase RDB `public`）

```sql
game_scores (id, uid, nickname, game_key, merit, raw_score jsonb, created_at)  -- 流水，用于限流与审计
game_best   (uid, game_key, merit, raw_score jsonb, achieved_at, PK(uid, game_key))  -- 榜单直读
```

两张表都开 RLS，只给 `service_role` 授权，前端一概算不到。迁移文件：`cloudbase/migrations/20260917_game_scores.sql`

云函数：

| 函数 | 鉴权 | 职责 |
|---|---|---|
| `submitGameScore` | 需登录 | 校验 → **服务端重算积分** → 写流水 → upsert 最好成绩 |
| `getGameLeaderboard` | **公开** | 返回总榜 Top 50 + 两张分榜 + 我的排名（游客可读，无 `me`） |

安全规则已加 `"getGameLeaderboard": { "invoke": true }`。

---

## 五、UI（弹窗内，三个游戏按钮下方）

弹窗从 `max-w-sm overflow-hidden` 改为 `max-w-sm max-h-[86dvh] flex flex-col`：游戏区 `shrink-0`，榜单区 `flex-1 min-h-0` 内部滚动，小屏不撑破。

结构：金色虚线分隔 → `🏆 头号玩家` + 〔总榜 / 🍉 / 🛡️〕三个 tab + 刷新 → 榜单行（前三名金银铜徽章，总榜模式下每行列两游戏 MP 拆解）→ 底部吸底「我的战绩」。

状态：加载骨架屏 / 空榜 / **榜单服务尚未开通**（云函数没部署时）/ 未登录时底部展示「🥔 利了个韩暂未加入头号玩家 · 本机最佳」。

---

## 六、防作弊与限流

- 服务端重算积分，客户端传了也不信
- `banned` 用户拒绝提交
- 每人每游戏**每日 30 次**提交上限（`RATE_LIMITED`）
- 大西皮 3000 分封顶，兜住无敌模式的无限刷分

> 当前是纯客户端上报，理论仍可伪造。同好小站定位下只做到这个强度，未做强反作弊。

---

## 七、未登录 / 游客

- 成绩写 `localStorage['levihan.gameBest.v1']`，UI 显示「本机最佳」
- 云端榜公开可读，不强制登录才能看
- 登录后不会补交历史本地成绩（只从登录之后开始计）

---

## 八、部署前必做

1. 执行 `cloudbase/migrations/20260917_game_scores.sql` 建表
2. 部署 `submitGameScore` / `getGameLeaderboard` 两个云函数（已在 `cloudbaserc.json` 注册）
3. 下发 `security-rules.json`

未部署时榜单显示「榜单服务尚未开通」，其余功能不受影响。
