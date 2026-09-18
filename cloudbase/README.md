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
小说投稿第一期支持直接粘贴正文或单份 1MB 以内的 UTF-8 `.txt` / `.md`；
PDF、DOCX、EPUB 与图片附件的二进制待审上传需要后续单独审核区。

## app-api CSRF cookie configuration

The browser build's `VITE_CSRF_COOKIE_NAME` must exactly match the deployed
`app-api` function's `CSRF_COOKIE_NAME`. Both default to `lv_csrf`; changing
only one side makes protected writes such as logout and recovery confirmation
fail CSRF validation. The root `jsdom` dependency is test-only and is not
packaged into the CloudBase function.
