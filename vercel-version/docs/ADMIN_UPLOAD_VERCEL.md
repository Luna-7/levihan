# 管理台漫画上传与公告维护

管理台的登录、作品归档和公告数据由 Vercel Function 处理；漫画图片、加密文件和公告图片由浏览器使用短时 COS 凭证直传到现有存储桶。

## Vercel 环境变量

在 Vercel 项目的 Production、Preview 和 Development 环境中按需设置：

| 变量 | 值 |
| --- | --- |
| `ADMIN_PASSWORD` | 管理员登录口令 |
| `COS_SECRET_ID` | 有限权限的腾讯云 API 密钥 ID |
| `COS_SECRET_KEY` | 对应的 API 密钥 |
| `COS_BUCKET` | `levihan-1325571558` |
| `COS_REGION` | `ap-nanjing` |
| `COS_APP_ID` | `1325571558`，COS 存储桶名称末尾的 AppID |
| `VAPID_PUBLIC_KEY` | 现有 Web Push 公钥 |
| `VAPID_PRIVATE_KEY` | 现有 Web Push 私钥 |
| `VAPID_SUBJECT` | 可选，默认 `mailto:admin@levihan.asia` |

服务端密钥只存放在 Vercel 环境变量中，不要写进前端、仓库或发到聊天里。CAM 权限按最小范围配置：对 `archive.json`、`tags.json`、`authors.json`、`announcements.json`、`push-subscriptions.json` 授予读写权限；对 `announcements/*` 授予删除权限；并允许调用 `sts:GetFederationToken`。临时凭证只允许上传到指定的漫画目录、`comic_vault/` 或 `announcements/`。腾讯云支持按对象前缀和 COS 操作限制临时凭证权限，适合浏览器直传场景。[临时密钥指引](https://cloud.tencent.com/document/product/436/14048)

设置变量后重新部署 Vercel。已有订阅用户会继续收到漫画发布和公告更新通知；缺少 VAPID 密钥时只跳过推送，不影响上传与公告保存。管理台地址仍为 `https://admin.levihan.asia`。

## COS 跨域规则

在 `levihan-1325571558` 存储桶的跨域访问配置中增加一条规则：

- 来源：`https://admin.levihan.asia`
- 允许方法：`GET`、`HEAD`、`POST`、`PUT`、`DELETE`、`OPTIONS`
- 允许 Header：`*`
- 暴露 Header：`ETag`
- 超时：`600` 秒

管理台登录后可上传漫画页、加密漫画和公告图片。公告文字及作品信息通过 Vercel Function 写入桶内的 `announcements.json` 与 `archive.json`；标签和作者索引仍写入 `tags.json` 与 `authors.json`。
