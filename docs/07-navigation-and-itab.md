# 起始页与 iTab 实现

状态：完成  
日期：2026-09-18

## 已实现

- SQLite 导航分组 / 导航项 / 文件夹
- 起始页按分组展示
- 卡片尺寸
- 图标 URL / 文字图标 / 背景色
- 文件夹弹窗
- 搜索常用链接
- Bing / Google / DuckDuckGo
- 浏览器内部 URL 标记
- 起始页私有 / 公开策略
- 后台导航 CRUD
- 顶层分组拖拽排序
- 顶层导航拖拽排序
- 文件夹子项增删改
- iTab 导入预览
- Merge / Replace
- 冲突检测
- iTab 导出
- 未知字段 round-trip 保留
- smoke test

## iTab 兼容

当前样本所需字段均已覆盖：

- id
- name
- icon
- children
- url
- type
- src
- iconText
- backgroundColor
- view
- size
- component
- editedCurrentSrc
- insetType

未识别字段写入 extra_json，重新导出时会合并回 iTab 节点。

## 浏览器内部地址

about:、chrome:、moz-extension: 等不会被删除，而会标记为 browserLocal。

是否能打开取决于当前浏览器及扩展权限。

## 验证

~~~powershell
npm run itab:smoke
~~~

验证内容包括：

- 分组数量
- 文件夹
- 子项
- 浏览器内部地址
- Replace
- export
- import -> export round-trip
