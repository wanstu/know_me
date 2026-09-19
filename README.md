# know_me

[![CI / CD](https://github.com/wanstu/know_me/actions/workflows/ci.yml/badge.svg)](https://github.com/wanstu/know_me/actions/workflows/ci.yml)


个人网站项目，目标是把三个长期使用场景统一到一个站点中：

1. **浏览器起始页**：管理常用链接、分组、文件夹、搜索、壁纸，并兼容 iTab 数据导入/导出。
2. **个人博客**：面向访客的文章浏览/搜索/归档，以及面向站长的 Markdown 写作、媒体、发布与管理。
3. **个人主页**：简洁的个人入口页，展示简介、时间/短句、社交入口和站内导航。

## 当前阶段

- [x] Phase 1：需求分析
- [x] Phase 2：信息架构 / UI 设计 / HTML 静态原型
- [x] Phase 3：正式实现（3.1～3.7 已完成）
- [~] Phase 4：起始页、博客写作、个人主页与主题系统精修已完成；内置极光 / 海洋 / 森林 / 落日主题，CI / Docker / 备份恢复基线已完成，等待真实域名部署验证

## 本地启动

```powershell
cd D:\projects\know_me
npm install
npm run db:migrate
npm run admin:init -- --username admin
npm run dev
```

打开 `http://127.0.0.1:3000`。管理员初始化命令未指定密码时会生成随机强密码并只显示一次。

常用入口：`/`、`/start`、`/blog`、`/admin`、`/admin/navigation`、`/admin/posts`、`/admin/media`、`/admin/settings`。

Docker 启动：

```powershell
docker compose up -d --build
```

健康检查：`/api/health`。完整备份与恢复位于 `/admin/settings`。

## Native Runtime（Phase 5）

项目正在迁移到 **Go Core + 跨平台 CLI + 可选 Wails Desktop**。当前原生运行时基线已经可以单独启动 HTTP Server：

~~~powershell
go run ./cmd/know-me serve --listen 127.0.0.1:3000
~~~

也可以构建当前平台：

~~~powershell
./scripts/build-native.ps1 -Version dev
~~~

或一次生成四个平台 CLI：

~~~powershell
./scripts/build-native-all.ps1 -Version dev
~~~

当前产物目标：

~~~text
know-me-<version>-windows-amd64.exe
know-me-<version>-linux-amd64
know-me-<version>-darwin-amd64
know-me-<version>-darwin-arm64
~~~

CLI 默认只监听 `127.0.0.1:3000`。服务器部署需要显式开放地址：

~~~bash
./know-me-linux-amd64 serve --listen 0.0.0.0:3000
~~~

Native UI 使用 `wails-desktop-kit v0.4.0` 与独立的 `wails-desktop-kit-theme v0.1.0`。Phase 5.2～5.4 后端迁移已经完成：pure-Go SQLite、认证 / session、settings、导航与 iTab、博客 / revisions / taxonomy、FTS、媒体和完整备份都已经由 Go Core 提供，并保持现有数据库和备份格式兼容。Kit v0.4.0 的统一配置目录也已接入；普通运行配置位于 `~/.config/know-me/settings.json`，数据库与上传文件仍由 `data/`、`uploads/` 持久化目录管理。下一阶段进入静态前端迁移。完整计划见 `docs/14-native-runtime-refactor.md`。

Native 配置与数据初始化：

~~~powershell
go run ./cmd/know-me config path
go run ./cmd/know-me config init
go run ./cmd/know-me config show

go run ./cmd/know-me db migrate
go run ./cmd/know-me admin init --username admin

go run ./cmd/know-me backup export --output ./know_me-backup.zip
go run ./cmd/know-me backup restore --file ./know_me-backup.zip
~~~

配置优先级为：CLI flags > 环境变量 > `~/.config/know-me/settings.json` > 内置默认值。普通配置文件不保存密码、Token 或 Session Secret；这类敏感配置后续统一使用 Kit `secureconfig`。站点数据库和媒体文件不会因为 Kit 配置目录升级而搬到 `~/.config`。

`admin init` 未提供 `--password` 时会生成随机密码并只显示一次。已有管理员再次执行会更新密码并使该用户现有 session 失效。

## CI / CD

GitHub Actions 已配置两条流水线：

- `.github/workflows/ci.yml`：master push / PR 自动执行迁移、TypeScript 检查、全部 smoke test、生产构建和真实生产服务验收；master 通过后构建 `linux/amd64` Docker 镜像并推送到 GHCR。
- `.github/workflows/release.yml`：推送 `v*` Tag 时构建版本镜像，同时自动创建 GitHub Release。

master 镜像：

```text
ghcr.io/wanstu/know_me:latest
ghcr.io/wanstu/know_me:sha-<commit>
```

生产服务器可使用：

```powershell
Copy-Item .env.production.example .env
# 编辑 .env，将 SITE_URL 改成正式 HTTPS 域名
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

发布正式版本示例：

```powershell
git tag v0.1.0
git push origin v0.1.0
```

设计文档位于 docs，静态原型位于 prototype/index.html。

> 原则：先把信息架构和数据兼容边界确定，再进入正式实现，避免后续因为起始页、博客、后台三套功能互相割裂而返工。
