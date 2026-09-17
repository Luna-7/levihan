# 数据库安全规则

敏感集合由云函数读写，浏览器只读取公开内容。请在 CloudBase 控制台逐个集合设置：

```json
// users / invite_codes
{ "read": false, "write": false }
```

```json
// comments
{ "read": "doc.status == 'published'", "write": false }
```

```json
// comics / novels / illustrations
{ "read": true, "write": false }
```

云函数权限使用 `security-rules.json`：默认仅正式登录用户可调用；邀请码验证单独开放。管理员身份仍在云函数内部通过 `users.role` 二次校验。

> 注：树洞（treehole）功能已于 2026-09-17 全量下线并归档至 `archive/treehole-removed-2026-09-17/`。
