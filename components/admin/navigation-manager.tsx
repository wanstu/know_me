"use client";

import { FormEvent, useMemo, useState } from "react";
import type { NavGroup, NavItem, NavigationTree } from "@/lib/navigation/types";

type GroupFormState = {
  mode: "create" | "edit";
  id?: number;
  name: string;
  icon: string;
  visibility: "private" | "public";
};

type ItemFormState = {
  mode: "create" | "edit";
  id?: number;
  groupId: number;
  parentId: number | null;
  type: "link" | "folder";
  name: string;
  url: string;
  iconUrl: string;
  iconText: string;
  backgroundColor: string;
  size: "1x1" | "2x1" | "2x2";
  visibility: "private" | "public";
};

type ImportPreview = {
  groups: number;
  items: number;
  folders: number;
  browserLocal: number;
  conflicts: number;
};

function move<T>(list: T[], from: number, to: number) {
  const copy = [...list];
  const [value] = copy.splice(from, 1);
  copy.splice(to, 0, value);
  return copy;
}

function allItems(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...allItems(item.children)]);
}

function humanError(message: string) {
  const map: Record<string, string> = {
    unsupported_nav_url: "导航地址只支持 http/https 或 about:/chrome:/edge:/moz-extension: 等浏览器内部协议。",
    unsupported_icon_url: "图标地址只支持 http/https 或本站 /media/... 地址。",
    parent_group_mismatch: "目标文件夹不属于所选分组，请重新选择。",
    parent_not_folder: "只能把导航项放入文件夹。",
    parent_not_found: "目标文件夹已经不存在，请刷新后重试。",
    navigation_cycle: "不能把文件夹移动到自己或自己的子级中。",
    folder_has_children: "这个文件夹还有子项，不能直接改成普通链接。",
    group_not_found: "目标分组不存在，请刷新后重试。",
    item_name_required: "导航名称不能为空。"
  };
  return map[message] ?? message;
}

function safeIconUrl(value: string) {
  const url = value.trim();
  if (/^https?:\/\//i.test(url) || url.startsWith("/media/")) return url;
  return "";
}

function contrastText(background: string) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(background.trim());
  if (!match) return "#ffffff";
  const hex = match[1].length === 3 ? match[1].split("").map((ch) => ch + ch).join("") : match[1];
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.68 ? "#172033" : "#ffffff";
}

export function NavigationManager({ initialTree }: { initialTree: NavigationTree }) {
  const [tree, setTree] = useState(initialTree);
  const [activeGroupId, setActiveGroupId] = useState(initialTree.groups[0]?.id ?? 0);
  const [groupForm, setGroupForm] = useState<GroupFormState | null>(null);
  const [itemForm, setItemForm] = useState<ItemFormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragGroupId, setDragGroupId] = useState<number | null>(null);
  const [dragItemId, setDragItemId] = useState<number | null>(null);
  const [dragChildId, setDragChildId] = useState<number | null>(null);
  const [importRaw, setImportRaw] = useState("");
  const [importName, setImportName] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [message, setMessage] = useState("");

  const activeGroup = tree.groups.find((group) => group.id === activeGroupId) ?? tree.groups[0];
  const itemFormGroup = tree.groups.find((group) => group.id === itemForm?.groupId) ?? activeGroup;
  const folders = useMemo(
    () => itemFormGroup ? allItems(itemFormGroup.items).filter((item) => item.type === "folder") : [],
    [itemFormGroup]
  );

  async function action(actionName: string, data: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/navigation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: actionName, data })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "操作失败");
      if (payload.tree) {
        setTree(payload.tree);
        if (!payload.tree.groups.some((group: NavGroup) => group.id === activeGroupId)) {
          setActiveGroupId(payload.tree.groups[0]?.id ?? 0);
        }
      }
      return payload;
    } catch (error) {
      setMessage(humanError(error instanceof Error ? error.message : "操作失败"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submitGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!groupForm) return;
    const data = {
      ...(groupForm.id ? { id: groupForm.id } : {}),
      name: groupForm.name,
      icon: groupForm.icon,
      visibility: groupForm.visibility
    };
    const result = await action(groupForm.mode === "create" ? "create_group" : "update_group", data);
    if (result) setGroupForm(null);
  }

  async function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!itemForm) return;
    const data = {
      ...(itemForm.id ? { id: itemForm.id } : {}),
      groupId: itemForm.groupId,
      parentId: itemForm.parentId,
      type: itemForm.type,
      name: itemForm.name,
      url: itemForm.url,
      iconUrl: itemForm.iconUrl,
      iconText: itemForm.iconText,
      backgroundColor: itemForm.backgroundColor,
      size: itemForm.size,
      visibility: itemForm.visibility
    };
    const result = await action(itemForm.mode === "create" ? "create_item" : "update_item", data);
    if (result) setItemForm(null);
  }

  async function removeGroup(group: NavGroup) {
    if (!window.confirm("删除分组“" + group.name + "”以及其中全部导航项？")) return;
    await action("delete_group", { id: group.id });
  }

  async function removeItem(item: NavItem) {
    if (!window.confirm("删除“" + item.name + "”？文件夹会同时删除其中的子项。")) return;
    await action("delete_item", { id: item.id });
  }

  async function dropGroup(targetId: number) {
    if (!dragGroupId || dragGroupId === targetId) return;
    const from = tree.groups.findIndex((group) => group.id === dragGroupId);
    const to = tree.groups.findIndex((group) => group.id === targetId);
    if (from < 0 || to < 0) return;
    const reordered = move(tree.groups, from, to);
    setTree({ groups: reordered });
    setDragGroupId(null);
    await action("reorder_groups", { ids: reordered.map((group) => group.id) });
  }

  async function dropItem(targetId: number) {
    if (!activeGroup || !dragItemId || dragItemId === targetId) return;
    const from = activeGroup.items.findIndex((item) => item.id === dragItemId);
    const to = activeGroup.items.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const items = move(activeGroup.items, from, to);
    setTree({
      groups: tree.groups.map((group) => group.id === activeGroup.id ? { ...group, items } : group)
    });
    setDragItemId(null);
    await action("reorder_items", { groupId: activeGroup.id, parentId: null, ids: items.map((item) => item.id) });
  }

  async function dropChild(folder: NavItem, targetId: number) {
    if (!activeGroup || !dragChildId || dragChildId === targetId) return;
    const from = folder.children.findIndex((item) => item.id === dragChildId);
    const to = folder.children.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;

    const children = move(folder.children, from, to);
    const items = activeGroup.items.map((item) => item.id === folder.id ? { ...item, children } : item);
    setTree({
      groups: tree.groups.map((group) => group.id === activeGroup.id ? { ...group, items } : group)
    });
    setDragChildId(null);
    await action("reorder_items", {
      groupId: activeGroup.id,
      parentId: folder.id,
      ids: children.map((item) => item.id)
    });
  }

  function newItem(parentId: number | null = null) {
    if (!activeGroup) return;
    setItemForm({
      mode: "create",
      groupId: activeGroup.id,
      parentId,
      type: "link",
      name: "",
      url: "",
      iconUrl: "",
      iconText: "",
      backgroundColor: "",
      size: "1x1",
      visibility: "private"
    });
  }

  function editItem(item: NavItem) {
    setItemForm({
      mode: "edit",
      id: item.id,
      groupId: item.groupId,
      parentId: item.parentId,
      type: item.type,
      name: item.name,
      url: item.url,
      iconUrl: item.iconUrl,
      iconText: item.iconText,
      backgroundColor: item.backgroundColor,
      size: item.size,
      visibility: item.visibility
    });
  }

  async function chooseImport(file: File | null) {
    setImportPreview(null);
    setMessage("");
    if (!file) {
      setImportRaw("");
      setImportName("");
      return;
    }
    const raw = await file.text();
    setImportRaw(raw);
    setImportName(file.name);
    const response = await fetch("/api/navigation/import/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw })
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage("导入文件解析失败：" + (payload.error || "未知错误"));
      return;
    }
    setImportPreview(payload.preview);
  }

  async function applyImport(strategy: "merge" | "replace") {
    if (!importRaw) return;
    if (strategy === "replace" && !window.confirm("替换会先删除现有全部导航数据，确定继续？")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/navigation/import/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw: importRaw, strategy, overwrite })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "导入失败");
      setTree(payload.tree);
      setActiveGroupId(payload.tree.groups[0]?.id ?? 0);
      setMessage(
        "导入完成：新增 " + payload.result.addedGroups + " 个分组、" +
        payload.result.addedItems + " 个导航项；更新 " +
        payload.result.updatedItems + " 个导航项。"
      );
      setImportPreview(null);
      setImportRaw("");
      setImportName("");
    } catch (error) {
      setMessage(humanError(error instanceof Error ? error.message : "导入失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nav-admin-layout">
      <aside className="nav-admin-groups">
        <div className="nav-admin-section-head">
          <strong>分组</strong>
          <button type="button" onClick={() => setGroupForm({ mode: "create", name: "", icon: "", visibility: "private" })}>＋</button>
        </div>
        <div className="nav-group-list">
          {tree.groups.map((group) => (
            <button
              key={group.id}
              type="button"
              draggable
              onDragStart={() => setDragGroupId(group.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => void dropGroup(group.id)}
              className={group.id === activeGroup?.id ? "is-active" : ""}
              onClick={() => setActiveGroupId(group.id)}
            >
              <span>{group.icon || "•"}</span>
              <strong>{group.name}</strong>
              <small>{group.items.length}</small>
            </button>
          ))}
        </div>
        {activeGroup ? (
          <div className="nav-group-actions">
            <button type="button" onClick={() => setGroupForm({
              mode: "edit", id: activeGroup.id, name: activeGroup.name, icon: activeGroup.icon, visibility: activeGroup.visibility
            })}>编辑分组</button>
            <button type="button" className="danger-text" onClick={() => void removeGroup(activeGroup)}>删除分组</button>
          </div>
        ) : null}
      </aside>

      <section className="nav-admin-main">
        <div className="nav-admin-toolbar">
          <div>
            <div className="eyebrow">Start Page</div>
            <h2>{activeGroup?.name ?? "导航管理"}</h2>
          </div>
          <div className="nav-admin-toolbar-actions">
            {activeGroup ? <button type="button" className="secondary-button" onClick={() => newItem()}>＋ 新增入口</button> : null}
            <a className="secondary-button" href="/api/navigation/export">导出 iTab</a>
          </div>
        </div>

        {activeGroup ? (
          <div className="nav-item-list">
            {activeGroup.items.map((item) => (
              <div
                className="nav-item-row"
                key={item.id}
                draggable
                onDragStart={() => setDragItemId(item.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => void dropItem(item.id)}
              >
                <div className="nav-item-icon" style={item.backgroundColor ? { background: item.backgroundColor, color: contrastText(item.backgroundColor) } : undefined}>
                  {safeIconUrl(item.iconUrl) ? <img src={safeIconUrl(item.iconUrl)} alt="" /> : <span>{item.iconText || item.name.slice(0, 2)}</span>}
                </div>
                <div className="nav-item-copy">
                  <strong>{item.name}</strong>
                  <small>{item.type === "folder" ? "文件夹 · " + item.children.length + " 项" : item.url || "无 URL"}</small>
                </div>
                <span className="nav-badge">{item.size}</span>
                <span className="nav-badge">{item.visibility === "private" ? "私有" : "公开"}</span>
                {item.browserLocal ? <span className="nav-badge nav-badge-warn">浏览器地址</span> : null}
                <div className="nav-item-actions">
                  {item.type === "folder" ? <button type="button" onClick={() => newItem(item.id)}>＋子项</button> : null}
                  <button type="button" onClick={() => editItem(item)}>编辑</button>
                  <button type="button" className="danger-text" onClick={() => void removeItem(item)}>删除</button>
                </div>

                {item.children.length ? (
                  <div className="nav-child-list">
                    {item.children.map((child) => (
                      <div
                        className="nav-child-row"
                        key={child.id}
                        draggable
                        onDragStart={() => setDragChildId(child.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => void dropChild(item, child.id)}
                      >
                        <span>↳</span>
                        <strong>{child.name}</strong>
                        <small>{child.url || "无 URL"}</small>
                        <button type="button" onClick={() => editItem(child)}>编辑</button>
                        <button type="button" className="danger-text" onClick={() => void removeItem(child)}>删除</button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {activeGroup.items.length === 0 ? <div className="admin-empty">这个分组还是空的，可以新增入口或导入 iTab 数据。</div> : null}
          </div>
        ) : (
          <div className="admin-empty">先创建一个分组，或者在下面导入 iTab 备份。</div>
        )}

        <section className="admin-panel nav-import-panel" id="import">
          <div>
            <strong>iTab 导入 / 导出</strong>
            <p className="muted">支持当前备份中的分组、普通链接、文件夹、颜色、图标、访问次数和尺寸。未知字段会保留，便于再次导出。</p>
          </div>
          <label className="file-picker">
            <span>选择 .itabdata 文件</span>
            <input type="file" accept=".itabdata,application/json" onChange={(event) => void chooseImport(event.target.files?.[0] ?? null)} />
          </label>
          {importName ? <p className="muted">已选择：{importName}</p> : null}
          {importPreview ? (
            <div className="import-preview">
              <div><span>分组</span><strong>{importPreview.groups}</strong></div>
              <div><span>导航项</span><strong>{importPreview.items}</strong></div>
              <div><span>文件夹</span><strong>{importPreview.folders}</strong></div>
              <div><span>浏览器内部地址</span><strong>{importPreview.browserLocal}</strong></div>
              <div><span>冲突</span><strong>{importPreview.conflicts}</strong></div>
            </div>
          ) : null}
          {importPreview ? (
            <div className="import-actions">
              <label><input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} /> 合并时用导入数据覆盖冲突项</label>
              <div>
                <button type="button" disabled={busy} className="secondary-button" onClick={() => void applyImport("merge")}>合并导入</button>
                <button type="button" disabled={busy} className="danger-button" onClick={() => void applyImport("replace")}>替换全部</button>
              </div>
            </div>
          ) : null}
          {message ? <p className="admin-message">{message}</p> : null}
        </section>
      </section>

      {groupForm ? (
        <div className="admin-modal-backdrop" onMouseDown={() => setGroupForm(null)}>
          <form className="admin-modal" onSubmit={submitGroup} onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <h3>{groupForm.mode === "create" ? "新增分组" : "编辑分组"}</h3>
              <button type="button" onClick={() => setGroupForm(null)}>×</button>
            </div>
            <label>名称<input value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} required /></label>
            <label>图标 / 标识<input value={groupForm.icon} onChange={(event) => setGroupForm({ ...groupForm, icon: event.target.value })} placeholder="如 home、code、工" /></label>
            <label>可见性<select value={groupForm.visibility} onChange={(event) => setGroupForm({ ...groupForm, visibility: event.target.value as "private" | "public" })}><option value="private">私有</option><option value="public">公开</option></select></label>
            <button className="primary-button" type="submit" disabled={busy}>保存</button>
          </form>
        </div>
      ) : null}

      {itemForm ? (
        <div className="admin-modal-backdrop" onMouseDown={() => setItemForm(null)}>
          <form className="admin-modal admin-modal-wide" onSubmit={submitItem} onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <h3>{itemForm.mode === "create" ? "新增导航项" : "编辑导航项"}</h3>
              <button type="button" onClick={() => setItemForm(null)}>×</button>
            </div>
            <div className="admin-form-grid">
              <label>名称<input value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} required /></label>
              <label>类型<select value={itemForm.type} onChange={(event) => setItemForm({ ...itemForm, type: event.target.value as "link" | "folder" })}><option value="link">链接</option><option value="folder">文件夹</option></select></label>
              <label className="span-2">URL<input value={itemForm.url} onChange={(event) => setItemForm({ ...itemForm, url: event.target.value })} placeholder="https://..." /><small className="field-hint">支持 http/https，也保留 about:、chrome:、edge: 等浏览器内部地址。</small></label>
              <label className="span-2">图标 URL<input value={itemForm.iconUrl} onChange={(event) => setItemForm({ ...itemForm, iconUrl: event.target.value })} /><small className="field-hint">留空时起始页会尝试读取站点 favicon，失败后使用文字图标。</small></label>
              <label>文字图标<input value={itemForm.iconText} onChange={(event) => setItemForm({ ...itemForm, iconText: event.target.value })} /></label>
              <label>背景色<input value={itemForm.backgroundColor} onChange={(event) => setItemForm({ ...itemForm, backgroundColor: event.target.value })} placeholder="#1681ff" /></label>
              <label>尺寸<select value={itemForm.size} onChange={(event) => setItemForm({ ...itemForm, size: event.target.value as "1x1" | "2x1" | "2x2" })}><option value="1x1">1 × 1</option><option value="2x1">2 × 1</option><option value="2x2">2 × 2</option></select></label>
              <label>可见性<select value={itemForm.visibility} onChange={(event) => setItemForm({ ...itemForm, visibility: event.target.value as "private" | "public" })}><option value="private">私有</option><option value="public">公开</option></select></label>
              <label>所属分组<select value={itemForm.groupId} onChange={(event) => setItemForm({ ...itemForm, groupId: Number(event.target.value), parentId: null })}>{tree.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
              <label>所属文件夹<select value={itemForm.parentId ?? ""} onChange={(event) => setItemForm({ ...itemForm, parentId: event.target.value ? Number(event.target.value) : null })}><option value="">不放入文件夹</option>{folders.filter((folder) => folder.id !== itemForm.id).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
            </div>
            <button className="primary-button" type="submit" disabled={busy}>保存</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
