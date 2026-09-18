# Phase 4 测试与发布

状态：本地验收完成，等待真实部署验证  
日期：2026-09-18

## 本地自动验收

开发或生产服务启动后：

```powershell
npm run site:smoke
npm run auth:smoke
```

site smoke 当前验证：

- `/`
- `/blog`
- `/feed.xml`
- `/sitemap.xml`
- `/robots.txt`
- `/api/health`
- 未登录访问 `/start` 必须跳转登录

完整数据与功能测试：

```powershell
npm run itab:smoke
npm run blog:smoke
npm run media:smoke
npm run settings:smoke
npm run backup:smoke
npm run security:smoke
npm run typecheck
npm run build
```

## 本次本地验收结果

已通过：

- TypeScript
- Next.js production build
- 认证 / Session
- 起始页真实导航渲染
- iTab import / export round-trip
- 实际 iTab 备份导入：7 个分组、101 个导航项、4 个文件夹、4 个浏览器内部地址
- Markdown 草稿 / revision / revision restore / 发布 / 搜索 / 定时发布
- 媒体上传与删除
- 站点设置
- 完整备份 / 恢复
- 安全 smoke
- 公共路由与健康检查

## Docker 验证状态

Dockerfile 与 docker-compose.yml 已完成。

本机执行 `docker build` 时 Docker Desktop 无法连接 Docker Hub 获取 `node:24-bookworm-slim`，因此镜像构建没有在本机完成。失败发生在拉取基础镜像之前，不是 Dockerfile 编译错误。

在可以访问 Docker Hub 的环境执行：

```powershell
docker compose build
docker compose up -d
docker compose exec know-me npm run admin:init -- --username admin
```

然后：

```powershell
$env:SMOKE_BASE_URL = "http://127.0.0.1:3000"
npm run site:smoke
npm run auth:smoke
```

## 发布前最后检查

真实域名部署时需要：

1. 配置 HTTPS 反向代理；
2. 设置 `SITE_URL=https://你的域名`；
3. 初始化正式管理员强密码；
4. 下载一次完整备份验证恢复链路；
5. 确认 `/api/health` 为 200；
6. 跑 site/auth smoke；
7. 检查 sitemap 与 RSS 中绝对地址使用正式域名。
