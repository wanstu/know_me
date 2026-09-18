# iTab 兼容设计

本文基于用户提供的 .itabdata 样本分析。

## 1. 样本结构

样本本质是 UTF-8 JSON，顶层结构为：

~~~json
{
  "navConfig": []
}
~~~

本次样本中：

- 7 个一级分组；
- 86 个一级导航项；
- 其中存在 4 个 folder；
- folder 内共有 15 个二级导航项；
- 总计 101 个可见导航节点。

观察到的一级分组字段：

~~~text
id
name
icon
children
~~~

普通导航节点常见字段：

~~~text
id
url
type
name
src
iconText
backgroundColor
view
size
~~~

额外观察到：

~~~text
children
component
editedCurrentSrc
insetType
~~~

type 样本值：

- icon
- text
- folder

size 样本值：

- 2x2
- 2x4
- 空 / 缺省

## 2. 安全与兼容注意

样本中包含浏览器内部协议，例如：

- about:
- moz-extension:

这类 URL：

- 不能保证在 Chrome / Edge / Firefox 之间互通；
- Web 页面本身也可能没有权限直接打开；
- 导入时不能简单判定为“非法”而删除。

处理方式：

1. 保留原始 URL；
2. 标记 browser_local = true；
3. UI 显示兼容性提示；
4. 导出时原样保留。

同时，导入文件可能包含本地服务、工作系统或其他不适合公开的 URL，因此导入后的导航默认 visibility=private。

## 3. 内部映射

### 分组

~~~text
iTab navConfig[n]
  -> NavGroup
~~~

### 链接

~~~text
type=icon/text
  -> NavItem(type=link)
~~~

### 文件夹

~~~text
type=folder
  -> NavItem(type=folder)

folder.children
  -> NavItem(parent_id=folder.id)
~~~

### 尺寸

~~~text
iTab 2x2 -> internal 1x1
iTab 2x4 -> internal 2x1
~~~

未知值直接保留在 extra_json。

## 4. 导入流程

~~~text
选择 .itabdata
   ↓
JSON parse
   ↓
结构校验
   ↓
标准化
   ↓
生成预览
   ↓
显示：
- 新增多少分组
- 新增多少链接
- 新增多少文件夹
- 多少冲突
- 多少浏览器内部 URL
   ↓
选择策略
- Merge
- Replace
- Cancel
   ↓
数据库事务写入
~~~

## 5. 冲突策略

优先级：

1. 同 iTab id；
2. 同分组 + 同 normalized URL；
3. 同分组 + 同 name。

有冲突时不静默覆盖，预览中明确列出。

Merge 模式默认：

- 已存在记录保留本地编辑；
- iTab 未存在记录新增；
- 用户可以勾选“用导入数据覆盖冲突项”。

## 6. 导出

导出文件名建议：

~~~text
iTab备份-YYYY-MM-DD HH_mm.itabdata
~~~

输出顶层保持：

~~~json
{
  "navConfig": [...]
}
~~~

导出时：

- internal 1x1 -> iTab 2x2；
- internal 2x1 -> iTab 2x4；
- link 根据图标状态恢复 icon / text；
- folder 递归恢复 children；
- iTab 原始未知字段从 extra_json 合并回节点。

## 7. Round-trip 验收

对同一份备份：

~~~text
import -> no edit -> export
~~~

要求：

- 分组数量一致；
- 节点数量一致；
- folder 层级一致；
- URL 不丢失；
- icon URL 不丢失；
- backgroundColor 不丢失；
- view 不丢失；
- 未识别字段尽量不丢失。

字段顺序无需一致，JSON 格式化方式无需一致。
