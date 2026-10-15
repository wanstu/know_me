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

- `posts_list` / `posts_get` — 后台文章摘要与完整 Markdown（包括草稿）；文章列表支持状态、分类、标签、发布时间区间及分页
- `posts_revisions_list` / `posts_revision_get` — 历史修订的摘要、日期和全文
- `taxonomy_list` — 分类与标签及数量
- `site_get` — 站点设置与主页入口
- `start_get` — 起始页配置与导航
- `navigation_tree` — 完整导航分组、链接与文件夹

**读写令牌：** 包含以上只读工具，另有：

- `posts_create` / `posts_update` / `posts_delete` — 文章新增、局部编辑、永久删除（需 `confirm=true`）
- `posts_set_status` — 立即发布、撤回到草稿、定时发布
- `posts_taxonomy_update` — 分类标签按名称增量添加/移除，或全部替换
- `posts_revision_restore` — 确认后恢复指定修订（包含新修订的标签、分类、SEO 等元数据）
- `taxonomy_change`（创建/改名/删除）、`taxonomy_merge`
- `site_update`（档案/主题/短句/主页入口与快捷标签/项目/页脚/友链/页面访问规则等）
- `start_update`（搜索引擎、密度、背景、布局参数）
- `navigation_create_group` / `navigation_update_group` / `navigation_delete_group`
- `navigation_create_item` / `navigation_update_item` / `navigation_move_item` / `navigation_delete_item`

删除和合并相关工具需要显式 `confirm=true`。写入均调用原有 Go 业务 Store，保留文章修订记录、字段校验和分类标签关联。不开放任意 SQL 或文件系统执行。

**权限与隔离：** MCP API 只接受 Bearer 令牌；只读和读写令牌在 `tools/list` 看到不同的工具列表。服务器仅保存令牌 SHA-256 哈希，并保存创建时间、最近使用时间、名称及权限。Token 管理 REST API 使用现有管理员网页登录认证及同源保护。带跨域 Origin 的 MCP 请求被拒绝。

## 文章管理流程和日期约定

常用 MCP 工具参数示例：

```json
{ "tool": "posts_update", "arguments": {
    "id": 12,
    "title": "新的标题",
    "contentMd": "# 修改后的 Markdown",
    "pinned": false,
    "seoTitle": "搜索引擎标题",
    "publishedAtDate": "2024-08-01",
    "firstPublishedAtDate": "2023-07-01",
    "tags": ["Go", "MCP"],
    "categories": ["技术"]
}}
```

- `posts_update` 仅更新传入字段；不提供的正文、分类或标签保持原样；明确传 `tags: []` 或 `categories: []` 才会清空对应关系。
- `posts_taxonomy_update` 推荐用于只新增/移除个别标签：例如 `{"id":12,"addTags":["MCP"],"removeCategories":["旧分类"]}`，不会改动正文。若使用 `replaceTags` / `replaceCategories`，不能同时指定对应的增删参数。
- `posts_set_status` 的 `action` 取 `publish`（立即发布）、`schedule`（设置将来的 `publishedAtDate`）、`unpublish`（撤回草稿）。立即发布不提供日期时以当前时间发布；从定时发布改为立即发布，不保留原来的未来日期。
- 所有日期优先支持 `publishedAtDate` / `firstPublishedAtDate`（RFC3339 且自带时区，如 `2026-10-15T14:30:00+08:00`）。`YYYY-MM-DD` 按 **UTC 零点** 解释；需要严格本地时区时，务必写时区偏移。或者使用 `publishedAt` / `firstPublishedAt` 传 Unix **毫秒**。同一日期不能同时传字符串与毫秒值，传秒数会报错。
- `firstPublishedAt` 保存最初发表时间；撤回、重发时默认保留，允许在文章更新中明确更正。创建时间 `createdAt` 和修改时间 `updatedAt` 是系统审计时间，不接受 MCP 手动篡改。旧日期导入应填写 `publishedAtDate`。
- `posts_list` 支持 `status`、`tag`、`category`、`publishedFrom`、`publishedTo`、`page`、`limit`。返回分页总数，不返回全文；需要正文调用 `posts_get`。
- 编辑前建议使用 `posts_get`，并带 `expectedUpdatedAt` 防止基于明显过期的文章版本覆盖数据。此检查是预检，不代替事务级并发编辑锁。
- 修订快照现在涵盖正文、标题、URL、摘要、发布状态与日期、SEO、置顶、分类与标签。较老的历史修订如果不含新字段，恢复时对应属性仍保留当前值。历史修订恢复需 `confirm=true`，恢复可能同时使文章变为公开。
- `posts_delete` 为**永久删除**，不会建立可恢复的回收站；操作前应确认文章 ID 和备份，再明确传 `confirm=true`。

## 后续阶段

- 批量 Markdown / GitHub 文章导入、资源 URL 转存与去重预览；以 `wanstu/wanstu.github.io` 的 33 篇 Markdown 文章作为首个实际迁移验收
- 媒体上传及修改、批量文章操作、更加细粒度的工具权限与后台调用日志
- Next.js/Docker 部署形态的兼容方案

## 测试

`go test ./internal/server -run TestMCP -count=1 -v` 会启动真实 MCP HTTP 客户端，验证握手、`tools/list`、创建文章、分类查询、设置修改、导航创建、只读权限、Origin 限制与令牌吊销。`go test ./...` 会同时验证数据库迁移兼容性与所有现有业务测试。

本功能不会自动导入任何现有文章，不修改线上站点，也不在首次启动时自动创建 MCP Token。
