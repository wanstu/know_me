# 技术设计

状态：Phase 2 初版，进入实现时继续补充 ADR。

## 1. 技术方案

推荐首版使用单体全栈结构：

- Next.js App Router + TypeScript
- SQLite
- ORM / migration 层
- 服务端 Session 登录
- Markdown pipeline
- 本地文件存储 + 可切换 S3 兼容对象存储

原因：

- 个人站部署简单；
- 博客天然需要 SSR / SEO；
- 管理后台与公开页面可以共享组件；
- 起始页仍然可以做成高度客户端化的交互页面；
- SQLite 对单用户个人站足够，并且备份迁移很方便。

如果未来数据量或多人协作增加，数据库可切 PostgreSQL，业务模型不需要重写。

## 2. 建议目录

~~~text
know_me/
├─ app/
│  ├─ (public)/
│  │  ├─ page.tsx
│  │  └─ blog/
│  ├─ start/
│  ├─ login/
│  ├─ admin/
│  └─ api/
├─ components/
│  ├─ ui/
│  ├─ start/
│  ├─ blog/
│  └─ admin/
├─ lib/
│  ├─ auth/
│  ├─ db/
│  ├─ markdown/
│  ├─ search/
│  ├─ importers/
│  └─ storage/
├─ db/
│  ├─ migrations/
│  └─ seed/
├─ public/
├─ docs/
├─ prototype/
└─ tests/
~~~

## 3. 数据模型

### User

单用户起步，但表结构保留用户 ID。

关键字段：

- id
- username
- password_hash
- display_name
- avatar
- created_at
- updated_at

### Session

- id
- user_id
- expires_at
- created_at
- last_seen_at
- user_agent_hint

### Post

- id
- slug
- title
- excerpt
- content_md
- cover_media_id
- status: draft / published / scheduled
- pinned
- seo_title
- seo_description
- published_at
- created_at
- updated_at

### PostRevision

- id
- post_id
- content_md
- metadata_json
- created_at

### Category / Tag

独立表 + 多对多关联。

### Media

- id
- storage_key
- original_name
- mime
- width
- height
- size
- alt
- created_at

### NavGroup

- id
- name
- icon
- sort_order
- visibility

### NavItem

- id
- group_id
- parent_id
- type: link / folder
- name
- url
- icon_url
- icon_text
- background_color
- size
- visit_count
- sort_order
- visibility
- extra_json

extra_json 用于保存 iTab 中暂时不认识的字段，使导入后再次导出时尽量不丢数据。

### Setting

- key
- value_json
- updated_at

用于保存：

- 主题；
- 背景；
- 搜索引擎；
- 个人主页资料；
- start page 公开策略；
- 站点 SEO。

## 4. 搜索设计

博客搜索使用 SQLite FTS5：

- title；
- excerpt；
- 去除 Markdown 标记后的正文。

起始页链接搜索不需要 FTS，客户端对已加载导航数据做快速过滤即可。

## 5. Markdown 渲染

处理链：

~~~text
Markdown
  -> parse
  -> GFM / footnote / math / mermaid extensions
  -> sanitize
  -> heading id + TOC
  -> syntax highlight
  -> HTML
~~~

关键原则：

- 数据库保存原始 Markdown；
- HTML 可以缓存，但不作为唯一真相；
- 用户端不直接执行文章中的 script；
- Mermaid 采用受控渲染，不允许任意注入。

## 6. 登录

首版只做站长账号。

建议：

- 初始化时通过命令或环境变量创建管理员；
- 密码强哈希；
- 服务端 Session；
- 登录后写 HttpOnly Cookie；
- /admin/** 和默认 /start 统一 middleware 保护。

后续可增加：

- Passkey；
- TOTP；
- 登录设备管理。

## 7. API / 领域边界

即使内部采用 Route Handler / Server Action，也不把数据库操作散落到组件。

核心领域：

- auth
- posts
- media
- navigation
- settings
- import-export

iTab 导入必须先：

1. parse；
2. validate；
3. preview；
4. 用户确认；
5. transaction apply。

## 8. 备份

首版备份包包含：

- SQLite 数据库快照；
- 上传文件；
- site settings；
- Markdown 文章导出；
- 起始页 iTab 兼容导出。

备份包要有 schema version。

## 9. 测试重点

- iTab round-trip；
- 导航层级；
- 导入冲突；
- 登录权限；
- draft 泄漏；
- Markdown XSS；
- slug 冲突；
- FTS 搜索；
- 媒体上传；
- start page private/public。
