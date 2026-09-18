# know_me

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

设计文档位于 docs，静态原型位于 prototype/index.html。

> 原则：先把信息架构和数据兼容边界确定，再进入正式实现，避免后续因为起始页、博客、后台三套功能互相割裂而返工。
