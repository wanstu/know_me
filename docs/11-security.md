# 安全基线

状态：完成首版  
日期：2026-09-18

## 登录与 Session

- scrypt 密码哈希
- 随机 256-bit Session Token
- 数据库只保存 Token 的 SHA-256 哈希
- HttpOnly Cookie
- SameSite=Lax
- 生产环境 Cookie 自动启用 Secure
- Session 默认 30 天
- 过期 Session 清理
- 登录失败限流：同一来源 + 用户名在 15 分钟窗口内连续失败 10 次后暂时阻止继续尝试

## CSRF / 跳转

所有会修改数据的主要 POST / PATCH / DELETE 接口执行同源 Origin 校验。

登录 next 参数只接受以单个 / 开头的站内路径，拒绝外部 URL 与 // 开头的协议相对地址。

## Markdown

react-markdown 默认不会执行文章中的 raw HTML / script。

文章图片、链接、表格、GFM 与代码高亮均通过受控 Markdown 渲染链处理。

## 媒体

- 只接收 JPEG / PNG / WebP / GIF
- 单文件最大 10 MB
- 公开读取时设置 X-Content-Type-Options: nosniff
- 存储文件名使用随机 UUID

## iTab

- 导入最大 5 MB
- 浏览器内部 URL 原样保存但单独标记
- 起始页打开 URL 时只允许 http/https 与明确支持的浏览器协议
- 未登录公开起始页不会返回 private 分组 / private 项

## 备份恢复

- 只有已登录管理员可以下载与恢复
- 恢复 POST 做 Origin 校验
- 恢复包最大 100 MB
- ZIP 中媒体路径做目录穿越检查
- 管理员密码与 Session 不进入备份
- 数据库替换放在 SQLite transaction 中
- 恢复失败时尝试切回旧媒体目录

## HTTP 安全头

全站设置：

- X-Content-Type-Options: nosniff
- X-Frame-Options: SAMEORIGIN
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy
- Strict-Transport-Security

生产部署仍要求使用 HTTPS 反向代理。

## 自动验证

```powershell
npm run security:smoke
```

当前覆盖登录限流、同源判断与开放跳转防护。
