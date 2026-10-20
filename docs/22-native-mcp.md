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
- `posts_import_preview` — 批量预览 1–50 个 Markdown/Hexo 文件，读取 Front Matter 并检查重复，不修改数据库
- `taxonomy_list` — 分类与标签及数量
- `site_get` — 站点设置与主页入口
- `start_get` — 起始页配置与导航
- `navigation_tree` — 完整导航分组、链接与文件夹

**读写令牌：** 包含以上只读工具，另有：

- `posts_create` / `posts_update` / `posts_delete` — 文章新增、局部编辑、永久删除（需 `confirm=true`）
- `posts_set_status` — 立即发布、撤回到草稿、定时发布
- `posts_taxonomy_update` — 分类标签按名称增量添加/移除，或全部替换
- `posts_revision_restore` — 确认后恢复指定修订（包含新修订的标签、分类、SEO 等元数据）
- `posts_import_apply` — 与预览一致的文件和 `previewHash`，加 `confirm:true` 后导入；默认跳过已存在的 slug，不自动覆盖文章
- `posts_batch_taxonomy` — 批量为 1–50 篇文章增删/替换标签和分类；未确认时只预览
- `taxonomy_change`（创建/改名/删除）、`taxonomy_merge`
- `site_update`（档案/主题/短句/主页入口与快捷标签/项目/页脚/友链/页面访问规则等）
- `start_update`（搜索引擎、密度、背景、布局参数）
- `navigation_create_group` / `navigation_update_group` / `navigation_delete_group`
- `navigation_create_item` / `navigation_update_item` / `navigation_move_item` / `navigation_delete_item`

删除和合并相关工具需要显式 `confirm=true`。写入均调用原有 Go 业务 Store，保留文章修订记录、字段校验和分类标签关联。不开放任意 SQL 或文件系统执行。

**权限与隔离：** MCP API 只接受 Bearer 令牌；每个 Token 在 `tools/list` 只看到自己被授权的工具。服务器仅保存令牌 SHA-256 哈希，并保存创建时间、最近使用时间、名称及权限。管理员可以在不更换 Token 密钥的情况下收紧或调整权限。升级前创建的旧 Token 保持原“只读/读写”行为，直到管理员主动调整权限后才迁移为细粒度模式。Token 管理 REST API 使用现有管理员网页登录认证及同源保护。带跨域 Origin 的 MCP 请求被拒绝。

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
- 编辑前建议使用 `posts_get`，并带 `expectedUpdatedAt` 防止基于明显过期的文章版本覆盖数据。此检查已在同一写事务内验证版本，发生冲突会直接拒绝覆盖；仍建议编辑前先读取最新版。
- 修订快照现在涵盖正文、标题、URL、摘要、发布状态与日期、SEO、置顶、分类与标签。较老的历史修订如果不含新字段，恢复时对应属性仍保留当前值。历史修订恢复需 `confirm=true`，恢复可能同时使文章变为公开。
- `posts_delete` 为**永久删除**，不会建立可恢复的回收站；操作前应确认文章 ID 和备份，再明确传 `confirm=true`。

## Markdown / Hexo 批量导入

面向此前的 `wanstu/wanstu.github.io` 仓库（`source/_posts` 下 33 篇 Markdown）。AI 客户端负责读取仓库文件，然后把以下结构交给 Know Me MCP；**Know Me 不会自行连接任意下载 URL，也不会在启动时自动导入**。每次最多 50 篇，每篇最多 256 KiB，单次请求 JSON 上限 3 MiB（MCP HTTP 最大请求体为 4 MiB）。

1. 调用 `posts_import_preview`，例如：

```json
{
  "documents": [
    {
      "path": "source/_posts/docker/使用 DockerFile 构建自己的 lnp 镜像文件.md",
      "markdown": "---\\ntitle: 构建自己的 lnp 镜像文件\\ndate: 2024-06-22 00:00:00\\n---\\n# 正文..."
    }
  ],
  "publish": false
}
```

2. 查看每篇 `create` / `skip` / `invalid`、解析后的标题、slug、发布日期、标签、分类、缺失图片资源提示，并核对 `previewHash`。默认 **publish=false**，所有可导入文章先成为草稿，原发布日期保存在首次发布时间中。
3. 确认无误后调用 `posts_import_apply`，**原样再次传入相同的 `documents` 和 `publish`**，附加 `previewHash` 与 `confirm:true`。服务端会重新检查每个 slug。重复的 URL 标识跳过，绝不会直接覆盖已有文章；任何一个文件无效则整批在开始写入前拒绝。
4. 查看返回的 `created`、`skipped`、`failed` 和逐篇 ID。处理过程中若发生数据库错误，之前成功导入的文章保留，返回逐篇错误报告；重试同一批会跳过已导入的文章。

映射规则：优先采用 Front Matter 的 `title` / `date` / `tags` / `categories` / `slug` / `description` / `draft`，缺少分类时回退到源文件夹首层名称。默认从相对路径生成稳定 slug，Markdown 正文保存为原文（去掉 Front Matter）。即使多个客户端并发导入，也不允许将冲突的 slug 自动改为 `-2` 等后缀。标签和分类会自动创建、关联文章。Hexo 不带时区的 `2024-06-22 00:00:00` 按 **UTC+08:00** 解释；显式时间偏移以原始偏移为准。未标日期的文章如果明确选择发布则使用导入时的发布时间。

目前**不会下载或转存图片**。远程图片 URL 原样保留；相对路径图片/文件会在预览时提示人工核对。源文件中的 `draft: true` 即使勾选批量发布，也保持为草稿。未来的媒体迁移应单独实现 URL 解析和去重，避免导入时发生不受控外链请求。

`posts_batch_taxonomy` 适合后续整理旧文章：先传 `ids` 和 `addTags` / `removeTags` / `addCategories` / `removeCategories`，不传 `confirm` 先返回每篇修改前后的标签；确认后设置 `confirm:true`。也支持 `replaceTags` / `replaceCategories`，但不能和同类增删一起使用。批量操作会先检查全部文章 ID 是否存在，本批分类标签修改使用同一数据库事务，发生任何错误会整体回滚，不会留下半批已修改的数据。

## MCP 审计日志（新增）

进入 **后台 → AI 接入 → MCP 操作与鉴权日志**，可查看近期 MCP 认证和操作记录，按 Token 和结果筛选、分页加载。管理员也可以调用 `GET /api/mcp/audit?limit=50&tokenId=...&result=denied&beforeId=...`（需要已有后台登录会话）。

记录包括：

- **认证结果**：`authorization_missing`（未携带 Header）、`authorization_invalid_scheme`（非 Bearer）、`token_invalid_or_revoked`（Token 无效/已撤销）、`origin_mismatch`（跨域请求被拒）、`token_accepted`（令牌通过）
- **工具调用**：工具名、关联 Token ID/名称、权限类别（如 `posts.write`）、涉及文章或导航记录 ID、操作类型、成功/失败及脱敏的失败原因
- **Token 管理**：创建、吊销事件；使用令牌的记录与被拒绝的匿名请求可分别筛选

日志写入单独的 SQLite 审计表 `mcp_audit_events`，定期清理约 30 天前和最新 20,000 条之外的记录。审计写入失败不会改变正常 MCP 的认证或工具调用结果。仅存最小化元数据，不保存 Bearer 密钥、请求正文、工具完整参数、文章正文或工具响应；`remotePeer` 是 TCP 对端地址，在 OpenResty 等反向代理后通常为代理地址，不等于真实用户 IP。

Token 细粒度权限已经直接使用日志中的 `requiredPermission` 字段（如 `posts.read`、`posts.write`、`site.write`）进行授权。权限不足时工具不会出现在该 Token 的工具列表中；工具执行入口仍保留二次权限校验。

诊断 `know_me` 的认证故障时，先在 MCP Center 刷新服务，再在 Know Me 日志筛选「拒绝」：无记录提示请求可能根本没有到达这个 Know Me 实例；`authorization_missing` 说明请求没有 Authorization；`token_invalid_or_revoked` 说明已收到 Bearer，但令牌未通过当前数据库校验。如果显示 `token_accepted`，说明已经通过令牌认证，应继续排查 MCP 握手或代理行为。

**诊断 HTTP 协议后续结果：** Know Me 对每次已认证的 `/mcp` 请求另外记录一条 `MCP 协议 POST`（或 GET 等）日志，显示**最终 HTTP 状态码**，例如 `HTTP 200`、`HTTP 400`、`HTTP 403`。这条日志与 `token_accepted` 相互独立，防止认证成功被误认成整个连接成功。不会读取或记录 HTTP 请求/响应正文、Token 明文、工具参数或用户内容。HTTP 200 只能说明传输层成功，**不代表 JSON-RPC 方法一定成功**；MCP Center 如果仍显示 `auth_failure`，则应继续检查它的底层握手错误，而不是反复更换已通过的 Token。

## 后续阶段

- 让 AI 客户端实际完成 `wanstu/wanstu.github.io` 的 33 篇文章迁移并验收（当前已逐篇审阅 Front Matter；其中一篇无 Front Matter，使用文件名兜底）；资源 URL 转存、远程图片去重预览后续实现
- 媒体读取与修改能力、更细的单工具/危险操作权限（如需要）、后台调用日志增强
- Next.js/Docker 部署形态的兼容方案

## 测试

`go test ./internal/server -run TestMCP -count=1 -v` 会启动真实 MCP HTTP 客户端，验证握手、`tools/list`、创建文章、分类查询、设置修改、导航创建、细粒度工具可见性与权限更新、旧 Token 兼容、Origin 限制与令牌吊销。`go test ./...` 会同时验证数据库迁移兼容性与所有现有业务测试。

本功能不会自动导入任何现有文章，不修改线上站点，也不在首次启动时自动创建 MCP Token。
