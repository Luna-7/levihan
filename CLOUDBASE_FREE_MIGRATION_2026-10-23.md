# CloudBase 免费体验环境迁移状态（2026-10-23）

## 当前状态

- 原环境 `levihan-tudou-d0g7jivue1ccc4a35` 已在腾讯云控制台显示“当前访问资源已临时隔离”，到期时间为 2026-10-22 23:59:59。CLI 的用量查询返回 `ResourceExpired`，无法据此估算迁移后的月用量。
- 同账号购买页可选择 **免费体验版、PostgreSQL、上海、免费试用 6 个月、¥0.00**。新环境名预填为 `levihan-forum-free`。页面要求填写“兑换码”，未填时“立即购买”禁用。用户提供的首枚兑换码经购买页校验显示“已过期”；已请求新码。尚未创建环境、下单、迁移数据或切换线上流量。
- COS 私有备份已下载到被 Git 忽略的 `backup-local/cloudbase-exit-2026-10-22/`：12 张表、931 行，逐表行数与备份摘要一致。论坛索引与上传文件仍在独立 COS 桶 `levihan-1325571558`。

## 已准备的代码

- 前端 CloudBase 地址可用 `VITE_CLOUDBASE_ORIGIN` 指向新环境，Vercel 的同人本验证接口可用 `CLOUDBASE_ORIGIN` 指向新环境。
- `auth` 与 `admin-upload` 从运行时 `TCB_ENV` 读取数据库环境 ID，不再在新部署中误写旧环境。
- 论坛、首页公告和今日更新的轮询由 2 分钟延长至 10 分钟；论坛在页面隐藏时暂停轮询、重新显示时刷新。
- 本地恢复脚本 `backup-local/restore-cloudbase-backup.cjs` 默认只做预检；明确传入新环境 ID 与 `--apply` 才写入。它拒绝把数据恢复到原环境。应用数据库迁移后才能运行。

## 获得兑换码后

1. 在当前腾讯云购买页确认仍为 ¥0 免费体验版、上海 PostgreSQL，填写兑换码创建环境；检查新环境状态和资源点配额。若出现付款或非零金额，停止创建。
2. 为新环境创建专用 API Key，保留原 `AUTH_PEPPER`，在独立部署配置中只部署 `auth` 与 `admin-upload`，超时设为免费版允许的 3 秒、内存 256 MB。旧版注册、排行榜和备份云函数先不部署。
3. 运行 `tcb db pg migration up -e <新环境 ID>`，再运行 `node backup-local/restore-cloudbase-backup.cjs <新环境 ID> --apply`，核对 12 张表行数。
4. 配置新环境 `/auth` 和 `/admin-upload` HTTP 入口；验证旧用户登录、新用户答题注册、论坛列表/发帖/评论、COS 图片读取及写入。重点检查新环境云函数对独立 COS 桶的权限，以及常用请求能否在 3 秒内完成。
5. 验证通过后在 Vercel 设置 `VITE_CLOUDBASE_ORIGIN` 和 `CLOUDBASE_ORIGIN`，构建预览并检查，再切换生产环境。确认旧环境不再接收写入后，核对最终数据差异。
6. 在新环境“套餐用量”观察至少一个完整用量周期；免费版每月 3000 资源点，用尽会停服，且免费环境需手动续期。COS 和 Vercel 是独立服务，费用和配额分别观察。

## 本地验证

- `npm run build` 通过。
- `npm run lint` 通过。
- `npm run test:forum`、`npm run test:ui` 通过。
- `node --check` 检查两个云函数入口通过。
