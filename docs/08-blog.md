# Markdown 博客实现

状态：完成首版  
日期：2026-09-18

## 用户端

- /blog 文章列表
- /blog/[slug] 文章详情
- Markdown + GFM
- 代码高亮
- 标题 TOC
- 标签
- 分类
- 归档
- SQLite FTS5 搜索
- 上下篇
- SEO title / description
- sitemap.xml
- robots.txt
- feed.xml

默认不会执行 Markdown 中的 raw HTML / script。

## 管理端

- /admin/posts
- 新建 / 编辑 / 删除
- 草稿
- 发布
- 定时发布
- 置顶
- Slug
- 摘要
- 标签 / 分类
- SEO
- Markdown 左右分栏预览
- 1.8 秒无操作自动保存
- 历史 revision
- 历史版本恢复

## 媒体

- JPEG / PNG / WebP / GIF
- 单文件最大 10 MB
- 媒体库
- Markdown 编辑器直接选择图片
- Markdown 编辑器粘贴图片自动上传
- /media/... 公开读取
- 删除媒体

## 验证

~~~powershell
npm run blog:smoke
npm run media:smoke
~~~

blog smoke 覆盖：

- 草稿不会公开泄漏
- revision 创建
- revision 恢复
- 发布
- FTS 搜索
- 定时发布
