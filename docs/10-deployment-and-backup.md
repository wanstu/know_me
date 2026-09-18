# 部署、健康检查与备份

状态：Phase 3.7 进行中  
日期：2026-09-18

## 健康检查

公开健康检查接口：

```text
GET /api/health
```

正常返回 200，并包含：

- status
- database
- 当前 migration
- uptimeSeconds
- timestamp

数据库异常时返回 503，不返回数据库路径、凭据等敏感信息。

## 完整备份

后台：

```text
/admin/settings
```

可以下载完整 ZIP 备份。

ZIP 包含：

- 博客文章
- revision
- 标签 / 分类
- 起始页导航
- 站点设置
- 媒体元数据
- uploads 中的媒体文件

**不会包含管理员密码与当前登录 Session。**

恢复时：

1. 先把上传的 ZIP 解到临时媒体目录；
2. 整体切换媒体目录；
3. 使用 SQLite transaction 替换内容数据；
4. 重建 FTS5 搜索索引；
5. 如果数据库恢复失败，会把旧媒体目录切回。

单个恢复文件当前限制为 100 MB。

自动验证：

```powershell
npm run backup:smoke
```

## Docker

构建并启动：

```powershell
cd D:\projects\know_me
docker compose up -d --build
```

访问：

```text
http://127.0.0.1:3000
```

持久化目录：

- ./data -> /app/data
- ./uploads -> /app/uploads

首次启动后初始化管理员：

```powershell
docker compose exec know-me npm run admin:init -- --username admin
```

如果部署在真实域名，例如：

```text
https://me.example.com
```

先在 PowerShell 设置：

```powershell
$env:SITE_URL = "https://me.example.com"
docker compose up -d
```

SITE_URL 用于 sitemap、RSS 等绝对地址。

## 非 Docker 生产运行

```powershell
cd D:\projects\know_me
npm ci
npm run db:migrate
npm run build
npm run start -- -H 0.0.0.0 -p 3000
```

生产环境建议放在 Caddy / Nginx / Cloudflare Tunnel 等 HTTPS 入口之后。

## CI

GitHub Actions：

```text
.github/workflows/ci.yml
```

当前 CI 覆盖：

- npm ci
- migration
- TypeScript
- iTab smoke
- blog smoke
- media smoke
- settings smoke
- backup smoke
- security smoke
- production build
- production server health
- auth smoke
