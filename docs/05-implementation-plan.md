# Phase 3 实现计划

状态：进行中  
开始时间：2026-09-18

## 目标

先建立可运行的完整站点骨架，再逐步把静态原型替换成真实数据。

## 3.1 基础骨架

- Next.js + TypeScript
- 统一主题变量
- / 个人主页
- /start 起始页
- /blog 博客列表
- /blog/[slug] 文章详情
- /admin 管理后台骨架
- 响应式布局

验收：npm run build 通过，各入口可正常访问。

## 3.2 数据层与认证

- SQLite
- migration
- User / Session / Post / Tag / Category / Media / NavGroup / NavItem / Setting
- 初始化管理员
- 登录 / 退出
- /admin 权限保护
- /start 默认权限保护

## 3.3 起始页与 iTab

- 导航 CRUD
- 分组 / 文件夹
- 拖拽排序
- 卡片尺寸
- 图标 / 文字图标
- 搜索与搜索引擎
- iTab parser
- 导入预览
- merge / replace
- iTab export
- round-trip 测试

## 3.4 博客用户端

- Markdown 渲染
- 文章列表
- 文章详情
- 分类 / 标签 / 归档
- FTS5 全文搜索
- TOC
- 代码高亮
- RSS
- sitemap / SEO

## 3.5 博客管理端

- 文章 CRUD
- Markdown 编辑 + 预览
- 自动保存
- revision
- 媒体上传
- 发布 / 草稿 / 定时发布
- SEO 元信息

## 3.6 个人主页与外观

- 个人资料配置
- 社交入口
- 首页入口卡片
- 背景 / 遮罩
- light / dark / auto
- 起始页主题共用

## 3.7 收尾

- 安全检查
- 备份 / 恢复
- Docker
- 健康检查
- CI
- 部署文档
