# R2 敏感作品分流试验封存

封存日期：2026-09-16

本目录保存试验结束时的完整本地实现快照，当前主站与管理员上传台已撤回相关入口。

## 已封存内容

- `cloudflare-sensitive-worker/`：绑定私有 R2 的上传 Worker 源码与配置。
- `public-admin/index.html`：带“含有微量 R18 内容”复选框和分流上传逻辑的管理员页面。
- `cloudbase/admin-upload.index.js`：包含 Worker 管理员令牌验证与 R2 元数据字段的云函数版本。
- `frontend/`：敏感作品锁定卡片与类型字段版本。

## 保留的云端资源

- Cloudflare R2 桶：`levihan-sensitive-works`
- Cloudflare Worker：`levihan-sensitive-upload`
- Worker 地址：`https://levihan-sensitive-upload.tudouqun.workers.dev`

这些云端资源未删除；当前网站不再引用 Worker，也不会把新作品分流至 R2。

## 封存原因

中国大陆网络测试中，`workers.dev` 连接超时，R2 S3 地址出现 TLS 域名验证异常，无法满足“上传者与读者无需特殊网络环境”的要求。
