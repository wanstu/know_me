# Phase 5：Go Native Runtime 重构

状态：进行中  
基线：`know_me master@2b98e91`；Desktop Kit 使用最新正式版 `v0.2.2`。

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

直接复用 Desktop Kit v0.2.2：

- `ui.Mount`：同一份前端静态资源可同时暴露 Kit CSS / JS。
- `tokens.css / base.css / components.css / navigation.css`：作为 Native Web UI 基础。
- `theme.js`：复用 light / dark / system 明暗切换。
- 后续 Desktop wrapper 使用 Kit Runtime、托盘、单实例、自启动与三平台 reusable workflow。

暂不放进 Kit：

- HTTP Server、SQLite、博客、认证、导航、媒体、备份：这些属于 Know Me 业务或通用 Web Server，不是 Wails Desktop 基础设施。
- CLI `serve` 编排：Kit 当前明确不接管产品 CLI。

计划抽象进 Kit：

- 将 Know Me 已验证的“极光 / 海洋 / 森林 / 落日”整理为**可选通用 Palette Pack**，只覆盖通用 `--dk-*` token，不引入 Know Me 产品命名。
- 如后续 Desktop wrapper 出现多个消费者共同需要的“启动本地 HTTP Core + 生命周期协同”，再评估是否抽象；本阶段不提前设计。

## 迁移阶段

### 5.1 Native Runtime 基线

- [x] 根 Go Module，固定 Desktop Kit v0.2.2。
- [x] `know-me serve`。
- [x] `know-me version`。
- [x] 默认 `127.0.0.1:3000`，公网必须显式 `--listen`。
- [x] `--data-dir`、`--uploads-dir`、`--site-url`。
- [x] `/api/health`、`/api/version`。
- [x] 嵌入静态前端并通过 `kitui.Mount` 暴露 Kit 资源。
- [x] SPA fallback 与基础安全响应头。
- [ ] 三平台 CLI Release。

### 5.2 数据层

- [ ] pure-Go SQLite。
- [ ] migration。
- [ ] settings。
- [ ] users / sessions。
- [ ] `admin init`。

### 5.3 导航与 iTab

- [ ] navigation repository。
- [ ] iTab import / preview / apply / export。
- [ ] 浏览器起始页 API。

### 5.4 Blog / Media / Backup

- [ ] posts / revisions / taxonomy。
- [ ] Markdown / FTS 搜索。
- [ ] media。
- [ ] backup export / restore。

### 5.5 前端迁移

保留 React/TypeScript，但去掉 Next Server Runtime。产物编译为纯静态文件后 embed 进 Go 二进制；前端统一调用 Go HTTP API。

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

当前 5.1 先交付 `serve` 和 `version`，其余命令随对应模块迁移后开放，避免存在“能执行但功能未实现”的占位命令。

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
