# LeviHan CloudBase 接入

当前代码已经完成前端身份状态、统一用户弹窗、邀请制注册流程、评论权限、树洞投稿分流和云函数业务校验。要连接真实环境：

1. 在 `dist/cloudbase-config.js` 填写环境 ID、地域和 Publishable Key。
2. 在 CloudBase 安全来源中加入本地预览地址 `127.0.0.1:4317`，以后上线时再加入正式域名。
3. 开启邮箱密码登录，并配置验证邮件。
4. 创建或复用集合：`users`、`invite_codes`、`comments`、`treehole_posts`、`comics`、`novels`、`illustrations`。
5. 部署 `cloudfunctions/` 下每个同名云函数，并安装其依赖。
6. 应用 `cloudfunctions/security-rules.json` 与 `cloudbase/database-rules.md` 中的最小权限规则。
7. 首位管理员需要在 `users/{uid}` 文档中将 `role` 设置为 `admin`；该字段禁止前端修改。

注册流程先由云函数验证邀请码，再调用 CloudBase 邮箱注册。用户完成邮箱激活并首次登录时，`createUserProfile` 会在事务中再次验证并消费邀请码，因此前端验证结果无法绕过单次使用和额度规则。
