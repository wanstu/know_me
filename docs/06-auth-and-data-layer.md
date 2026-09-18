# Phase 3.2 数据层与认证

状态：完成  
日期：2026-09-18

## 已实现

- SQLite 数据库：默认 data/know-me.db
- 版本化 migration：db/migrations/001_initial.sql
- 管理员初始化 / 重置密码命令
- scrypt 密码哈希
- 随机 Session Token
- 数据库只保存 Session Token 的 SHA-256 哈希
- HttpOnly + SameSite=Lax Cookie
- Session 默认有效期 30 天
- 登录 / 退出
- /admin 默认必须登录
- /start 默认必须登录
- POST Origin 校验
- 过期 Session 清理
- auth smoke test

## 当前表

- users
- sessions
- posts
- post_revisions
- media
- categories
- tags
- post_categories
- post_tags
- nav_groups
- nav_items
- settings
- posts_fts
- schema_migrations

这些表一次建立是为了让后面的起始页和博客阶段直接基于同一套数据层继续实现。

## 初始化

~~~powershell
cd D:\projects\know_me
npm install
npm run db:migrate
npm run admin:init -- --username admin
~~~

未传 password 时会随机生成一个强密码，并且只在命令行显示一次。

指定密码：

~~~powershell
npm run admin:init -- --username admin --password "你的强密码"
~~~

同名管理员已经存在时，这个命令会更新密码并清除旧 Session，因此也可以作为本地重置密码命令使用。

## 启动

~~~powershell
npm run dev
~~~

访问：

- http://127.0.0.1:3000/login
- http://127.0.0.1:3000/start
- http://127.0.0.1:3000/admin

未登录访问后两个地址会自动跳到登录页。

## 自动验证

开发服务启动后：

~~~powershell
npm run auth:smoke
~~~

测试会临时创建专用账号，然后验证：

1. 未登录访问 /start 被拦截
2. 登录成功并设置 Session Cookie
3. 登录后 /start 返回 200
4. 登录后 /admin 返回 200
5. 退出成功
6. 临时账号与 Session 自动清理

不会修改真实管理员密码。

## 数据文件

data/*.db 已加入 .gitignore，不会提交到 Git。

正式部署前仍需要：

- 使用独立强密码
- HTTPS
- 定期备份 SQLite 与 uploads
- 后续管理端写接口统一加入 CSRF / 权限校验层
