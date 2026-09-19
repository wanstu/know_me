# Phase 5：Go Native Runtime 重构

状态：进行中  
基线：`know_me master@2b98e91`；Desktop Kit 使用最新正式版 `v0.4.0`，可选主题使用 `wails-desktop-kit-theme v0.1.0`。

## 目标

把当前“Next.js 服务 + Docker 镜像”为主的运行方式重构成“Go Core + 跨平台 CLI + 可选 Wails Desktop”。最终服务器只需要一个原生可执行文件；Windows、Linux、macOS 的 CLI 启动后开放 HTTP 端口。

```text
                 ┌─ know-me CLI ─ HTTP Server ─ Browser
Go Core ─────────┤
                 └─ Wails Desktop
                        ↑
                wails-desktop-kit
```

CLI 是主运行时。Wails Desktop 是桌面入口，不让 Linux Server 依赖 GTK/WebKit。

## Kit 使用边界

直接复用 Desktop Kit v0.4.0 与 Theme v0.1.0：

- `theme.MountWithKit`：同一份前端静态资源同时暴露 Kit CSS / JS 与可选主题包。
- `tokens.css / base.css / components.css / navigation.css`：作为 Native Web UI 基础。
- `theme.js`：复用 light / dark / system 与 `data-dk-theme-pack` 协议。
- Native Runtime 默认使用通用 `aurora` pack，不把 Know Me 产品样式写回 Kit。
- Kit `paths` 统一普通应用配置目录为 `~/.config/know-me`；数据库和媒体数据继续独立外置。
- Kit `secureconfig` 作为未来 SMTP / API Token / 远程凭据等敏感配置的统一存储能力；管理员密码仍只保存 scrypt hash，不重复加密明文密码。
- 后续 Desktop wrapper 使用 Kit Runtime、托盘、单实例、自启动、图标生成器与三平台 reusable workflow。

暂不放进 Kit：

- HTTP Server、SQLite、博客、认证、导航、媒体、备份：这些属于 Know Me 业务或通用 Web Server，不是 Wails Desktop 基础设施。
- CLI `serve` 编排：Kit 当前明确不接管产品 CLI。

已经完成的公共抽象：

- Kit v0.3.0 已增加 Theme Pack 协议，保持明暗模式和配色包正交；当前消费者已升级到 v0.4.0。
- `wails-desktop-kit-theme v0.1.0` 已独立提供极光 / 海洋 / 森林 / 落日四套通用主题，只覆盖 `--dk-*` token。
- 如后续 Desktop wrapper 出现多个消费者共同需要的“启动本地 HTTP Core + 生命周期协同”，再评估是否抽象；本阶段不提前设计。

## 迁移阶段

### 5.1 Native Runtime 基线

- [x] 根 Go Module，固定 Desktop Kit v0.4.0 + Theme v0.1.0。
- [x] `know-me serve`。
- [x] `know-me version`。
- [x] 默认 `127.0.0.1:3000`，公网必须显式 `--listen`。
- [x] `--data-dir`、`--uploads-dir`、`--site-url`。
- [x] `/api/health`、`/api/version`。
- [x] 嵌入静态前端并通过 `theme.MountWithKit` 暴露 Kit + Theme 资源。
- [x] SPA fallback 与基础安全响应头。
- [x] Windows amd64 / Linux amd64 / macOS amd64 / macOS arm64 CLI CI 构建产物。
- [ ] 正式版本 Tag 时发布 CLI Release 资产（待业务迁移完成后切换主发布流程）。

### 5.2 数据层

- [x] pure-Go SQLite：`modernc.org/sqlite`，CLI 四平台构建保持 `CGO_ENABLED=0`。
- [x] migration：与现有 Node 版复用 `001_initial` / `002_fts_delete_support` ID 与表结构，可直接打开现有数据库。
- [x] settings：保持现有 `site` JSON 结构、默认值、legacy socialLinks 兼容与字段归一化。
- [x] users / sessions：兼容现有 `scrypt$...` 密码格式、30 天 session、SHA-256 token hash 与登录失败限流。
- [x] `admin init`：支持创建 / 重置管理员并清除旧 session；未传密码时生成一次性随机密码。
- [x] 原生 API：`/api/auth/login`、`/api/auth/logout`、`/api/auth/me`、`/api/settings`。
- [x] `know-me db migrate`。
- [x] Kit v0.4.0 `paths` 配置层：`~/.config/know-me/settings.json`，支持 `config path/show/init`，并保持 CLI > env > file > defaults 优先级。
- [x] 明确 Secure Config 边界：敏感凭据使用 Kit `secureconfig`，管理员密码与 session 继续采用 hash-only 数据模型。

### 5.3 导航与 iTab

- [x] navigation repository：分组 / 链接 / 文件夹 CRUD、排序、跨分组移动、批量移动 / 删除、访问计数与 URL 校验。
- [x] iTab import / preview / apply / export：保持现有冲突规则、尺寸映射、browser-local 标记、未知字段和文件夹层级兼容。
- [x] 浏览器起始页 API：`GET /api/navigation/public` 提供公开导航树；后台继续使用受保护的 `/api/navigation`。
- [x] 原生管理 API：导航 CRUD、批量操作、iTab preview/apply/export 均已迁移并复用 Native session / same-origin 校验。

### 5.4 Blog / Media / Backup

- [x] posts / revisions / taxonomy：草稿、发布、定时发布、置顶、历史版本恢复、标签和分类管理均已迁移到 Go。
- [x] Markdown / FTS 搜索：继续使用 SQLite FTS5，正文索引使用与 Node 版一致的 Markdown→纯文本规则。
- [x] media：JPEG / PNG / WebP / GIF、10MB 限制、年月目录、公开 `/media/...`、删除与路径穿越保护均已迁移。
- [x] backup export / restore：保持 `know_me_backup` v1 ZIP 格式与表集合兼容，继续排除 users / sessions，并在恢复后重建 FTS。
- [x] 原生 API：`/api/posts`、revisions、taxonomy、media、backup 与公开 blog API 已接入 Native session / same-origin 校验。
- [x] CLI：`know-me backup export` / `know-me backup restore`。
- [x] 现有本地 Node SQLite 数据兼容验证：Native CLI 可直接打开现有数据库，识别 101 个导航项并完成备份导出/恢复。

### 5.5 前端迁移

保留 React/TypeScript，但去掉 Next Server Runtime。产物编译为纯静态文件后 embed 进 Go 二进制；前端统一调用 Go HTTP API。

- [x] 新建 `native-web/`：Vite + React + TypeScript，生产产物直接写入 `internal/webassets/static` 并由 Go embed。
- [x] 公共页：个人主页、随机“今日短句”、Blog 列表/搜索/分类标签、Markdown 文章页、登录页。
- [x] 起始页：分组导航、全局搜索、文件夹、browser-local 标记、公开/私有策略、壁纸/密度/透明度/圆角配置。
- [x] 后台路由改为真实独立 URL：总览、导航、文章、分类标签、媒体、设置、备份，不再依赖单页锚点滚动。
- [x] 导航管理：分组/链接/文件夹新增编辑删除、排序、iTab 合并/替换导入与导出。
- [x] 文章管理：Markdown 双栏实时预览、工具栏、草稿/发布/定时、置顶、分类标签、SEO、历史版本恢复、图片上传/粘贴、Markdown 导入导出。
- [x] 分类标签管理：新增、重命名、删除并保持文章关联。
- [x] 媒体管理：图片上传、URL/Markdown 复制、删除。
- [x] 站点设置：主题、背景、起始页参数、社交链接、主页入口、项目卡片。
- [x] 备份管理：浏览器下载完整 ZIP 与上传恢复。
- [x] Desktop Kit Theme Pack：light/dark/system + aurora/ocean/forest/sunset 继续由 Kit token 驱动。
- [x] Native Web 已接入 `build-native*.ps1` 与 Native CLI CI；CI 校验生成的 embed 静态资产没有漂移。
- [x] 使用现有 7 分组 / 101 项 iTab 数据进行浏览器验证；`/`、`/blog`、`/start`、全部 `/admin/*` 路由均已在真实 Native Server 下打开验证，文章新建也已通过 UI 实测。

### 5.6 Desktop wrapper

使用 Desktop Kit 最新正式版：

- 托盘。
- 单实例。
- 登录自启。
- 关闭策略。
- Kit Theme。
- 复用 Go Core。

## CLI 目标

```text
know-me serve
know-me version
know-me db migrate
know-me admin init
know-me backup export
know-me backup restore
```

当前已经交付 `serve`、`version`、`db migrate`、`admin init`、`config path/show/init`、`backup export` 和 `backup restore`。下一阶段主要工作已经从后端迁移转为 5.5 静态前端迁移与 5.6 Desktop wrapper。

## 发布目标

```text
know-me-vX.Y.Z-windows-amd64.exe
know-me-vX.Y.Z-linux-amd64
know-me-vX.Y.Z-darwin-amd64
know-me-vX.Y.Z-darwin-arm64
```

服务器最终无需 Node.js 或 Docker：

```bash
./know-me-linux-amd64 serve --listen 0.0.0.0:3000
```

数据仍然外置到 `data/` 与 `uploads/`，升级二进制不覆盖持久化数据。
