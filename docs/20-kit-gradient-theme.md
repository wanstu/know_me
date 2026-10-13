# Know Me v0.1.10：Kit v0.12 渐变主题接入

- Kit Go Module 与 GitHub reusable workflow、Desktop Kit CLI 统一升级为 v0.12.0。
- 不引入主题 Go Module，不复制 Kit 的渐变计算/渐变按钮算法；使用 `desktopKitTheme.applyGradient`、`clearGradient`、`getStyle` 与 Kit 提供的 CSS token。
- 管理后台「设置 → 主题与外观」先选 **普通主题** 或 **渐变主题**，后者可选择 2～4 套基础主题、调整次序，使用精选组合；支持 light / dark / system，修改实时预览，保存后全站生效。
- Kit 的背景、侧边栏、卡片及导航渐变 token 用于 Know Me 自有容器；主按钮只使用 Kit 的双色对比度安全渐变，次要、危险、禁用按钮不改为多色。
- 存储：新增 site settings 的 `themeStyle` 和 `themeGradientPacks`，保持 `themePreset` 作为独立普通主题选择；旧站点缺失字段按 solid 加载，无需数据库迁移。无效组合规范化为 solid，不影响旧数据。
- 现有 Kit Theme Runtime 使用远程主题 manifest、SHA256 校验、缓存和 builtin fallback，应用不自制 CSS 下载器。
- 当已有 v0.11 的主题 manifest 缓存缺少渐变锚点时，Know Me 会自动尝试刷新目录，无法获取则回退到普通主题并在设置页提示；旧缓存完全离线的兼容性增强已提交 Kit PR #20，待其被维护者审核并发布新版本后可升级。

## 验证

```text
go test ./...
go vet ./...
node node_modules/typescript/bin/tsc --noEmit
node node_modules/tsx/dist/cli.mjs scripts/theme-gradient.test.ts
node node_modules/vite/bin/vite.js build --config vite.native.config.mts
```

请用真正安装的 Know Me Desktop、Windows/macOS/Linux 和浏览器分别验证浅色/深色/跟随系统，普通主题切换、两到四主题、按钮状态及重启恢复。Theme CDN 不可用时不应导致服务启动失败。
