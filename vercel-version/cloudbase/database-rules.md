# 数据库安全规则

敏感集合由云函数读写，浏览器只读取公开内容。请在 CloudBase 控制台逐个集合设置：

```json
// users
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

云函数网关权限使用 `gateway-policy.rego`：默认仅正式登录用户可调用；排行榜读取单独开放。注册与登录通过各自的 HTTP 访问服务匿名调用。使用 `tcb policy set "$(cat gateway-policy.rego)" -e <env-id>` 发布。管理员身份仍在云函数内部通过 `users.role` 二次校验。

`security-rules.json` 是旧版函数安全规则的等价备份；PostgreSQL 环境实际使用 OPA 网关策略，不能只把该 JSON 留在仓库而不发布。

> 注：树洞（treehole）功能已于 2026-09-17 全量下线并归档至 `archive/treehole-removed-2026-09-17/`。
