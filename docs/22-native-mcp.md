# Know Me 原生 MCP（第一阶段）

## 适用范围

MCP 已内置 **Go Native 服务**（Know Me CLI、Go Web Server、Desktop 内置 Go 服务）；地址为网站根路径下 `/mcp`，采用 MCP Streamable HTTP（JSON 响应）。

**注意**：当前仓库中的 `Dockerfile` 仍是 Next.js 服务端，暂未实现相同 MCP 路由；不要把本功能误标为现有 Next.js Docker 镜像已支持。也不需要 MCP Center 才能连接原生端点。

## 管理员配置

1. 登录 Know Me Go 后台，打开「AI 接入」(`/admin/mcp`)。
2. 填写令牌名称，选择 **只读** 或 **读写**。
3. 创建令牌；密钥只展示一次，复制后保存在 AI 客户端的凭据配置，不要放进文章、公开配置或提交到仓库。
4. AI 客户端使用地址 `https://<your-domain>/mcp`，自定义请求头 `Authorization: Bearer km_...`。
5. 可以随时吊销令牌；旧连接发起新请求时立即失效。没有令牌时 MCP 默认拒绝访问。
6. 对远程访问请使用 HTTPS；MCP 请求不接受网页登录 cookie 作为认证。

示例客户端配置（具体格式因客户端而异）：

```json
{
  "type": "http",
  "url": "https://example.com/mcp",
  "headers": { "Authorization": "Bearer km_REPLACE_WITH_ISSUED_SECRET" }
}
```

## 第一阶段工具清单

**只读令牌：**

- `posts_list` / `posts_get` — 后台文章摘要与完整 Markdown（包括草稿）
- `taxonomy_list` — 分类与标签及数量
- `site_get` — 站点设置与主页入口
- `start_get` — 起始页配置与导航
- `navigation_tree` — 完整导航分组、链接与文件夹

**读写令牌：** 包含以上只读工具，另有：

- `posts_create` / `posts_update` / `posts_delete`
- `taxonomy_change`（创建/改名/删除）、`taxonomy_merge`
- `site_update`（档案/主题/短句/主页入口与快捷标签/项目/页脚/友链/页面访问规则等）
- `start_update`（搜索引擎、密度、背景、布局参数）
- `navigation_create_group` / `navigation_update_group` / `navigation_delete_group`
- `navigation_create_item` / `navigation_update_item` / `navigation_move_item` / `navigation_delete_item`

删除和合并相关工具需要显式 `confirm=true`。写入均调用原有 Go 业务 Store，保留文章修订记录、字段校验和分类标签关联。不开放任意 SQL 或文件系统执行。

**权限与隔离：** MCP API 只接受 Bearer 令牌；只读和读写令牌在 `tools/list` 看到不同的工具列表。服务器仅保存令牌 SHA-256 哈希，并保存创建时间、最近使用时间、名称及权限。Token 管理 REST API 使用现有管理员网页登录认证及同源保护。带跨域 Origin 的 MCP 请求被拒绝。

## 后续阶段

- 批量 Markdown / GitHub 文章导入、资源 URL 转存与去重预览；以 `wanstu/wanstu.github.io` 的 33 篇 Markdown 文章作为首个实际迁移验收
- 媒体上传及修改、文章批处理 / 修订恢复、更加细粒度的工具权限与后台调用日志
- Next.js/Docker 部署形态的兼容方案

## 测试

`go test ./internal/server -run TestMCP -count=1 -v` 会启动真实 MCP HTTP 客户端，验证握手、`tools/list`、创建文章、分类查询、设置修改、导航创建、只读权限、Origin 限制与令牌吊销。`go test ./...` 会同时验证数据库迁移兼容性与所有现有业务测试。

本功能不会自动导入任何现有文章，不修改线上站点，也不在首次启动时自动创建 MCP Token。
