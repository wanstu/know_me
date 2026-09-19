import { FormEvent, useEffect, useMemo, useState } from "react";
import { requestJSON } from "../../api";
import type { NavGroup, NavItem } from "../../types";
import { AdminTitle, ErrorCard, LoadingCard } from "../../ui";

type GroupDraft = { id?: number; name: string; icon: string; visibility: "public" | "private" };
type ItemDraft = {
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
  visibility: "public" | "private";
};

function emptyGroup(): GroupDraft {
  return { name: "", icon: "", visibility: "private" };
}

function emptyItem(groupId = 0): ItemDraft {
  return {
    groupId,
    parentId: null,
    type: "link",
    name: "",
    url: "",
    iconUrl: "",
    iconText: "",
    backgroundColor: "",
    size: "1x1",
    visibility: "private"
  };
}

function flatten(items: NavItem[], depth = 0): Array<{ item: NavItem; depth: number }> {
  const result: Array<{ item: NavItem; depth: number }> = [];
  for (const item of items) {
    result.push({ item, depth });
    result.push(...flatten(item.children ?? [], depth + 1));
  }
  return result;
}

export function NavigationManager() {
  const [groups, setGroups] = useState<NavGroup[] | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const payload = await requestJSON<{ groups: NavGroup[] }>("/api/navigation");
    setGroups(payload.groups ?? []);
    setSelectedGroupId((current) => current ?? payload.groups?.[0]?.id ?? null);
  }

  useEffect(() => {
    void reload().catch((reason) => setError(reason instanceof Error ? reason.message : "navigation_failed"));
  }, []);

  const selectedGroup = groups?.find((group) => group.id === selectedGroupId) ?? groups?.[0] ?? null;
  const allItems = useMemo(() => selectedGroup ? flatten(selectedGroup.items ?? []) : [], [selectedGroup]);
  const folders = useMemo(() => allItems.filter(({ item }) => item.type === "folder"), [allItems]);

  async function action(action: string, data: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = await requestJSON<{ tree?: { groups: NavGroup[] } }>("/api/navigation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, data })
      });
      if (payload.tree?.groups) setGroups(payload.tree.groups);
      else await reload();
      setMessage("已保存");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "navigation_failed");
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function saveGroup(event: FormEvent) {
    event.preventDefault();
    if (!groupDraft) return;
    const creating = !groupDraft.id;
    await action(creating ? "create_group" : "update_group", groupDraft);
    setGroupDraft(null);
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    if (!itemDraft) return;
    const creating = !itemDraft.id;
    await action(creating ? "create_item" : "update_item", itemDraft);
    setItemDraft(null);
  }

  async function removeGroup(group: NavGroup) {
    if (!window.confirm(`删除分组“${group.name}”？分组内导航也会删除。`)) return;
    await action("delete_group", { id: group.id });
    setSelectedGroupId(null);
  }

  async function removeItem(item: NavItem) {
    if (!window.confirm(`删除“${item.name}”？文件夹会连同子项一起删除。`)) return;
    await action("delete_item", { id: item.id });
  }

  async function moveGroup(group: NavGroup, direction: -1 | 1) {
    if (!groups) return;
    const index = groups.findIndex((item) => item.id === group.id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= groups.length) return;
    const ids = groups.map((item) => item.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    await action("reorder_groups", { ids });
  }

  async function moveItem(item: NavItem, direction: -1 | 1) {
    if (!selectedGroup) return;
    const siblings = item.parentId
      ? (flatten(selectedGroup.items).find(({ item: candidate }) => candidate.id === item.parentId)?.item.children ?? [])
      : selectedGroup.items;
    const index = siblings.findIndex((candidate) => candidate.id === item.id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= siblings.length) return;
    const ids = siblings.map((candidate) => candidate.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    await action("reorder_items", { groupId: item.groupId, parentId: item.parentId, ids });
  }

  function editItem(item: NavItem) {
    setItemDraft({
      id: item.id,
      groupId: item.groupId,
      parentId: item.parentId ?? null,
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

  async function importItab(file: File, strategy: "merge" | "replace") {
    const raw = await file.text();
    const preview = await requestJSON<{ preview: { groups: number; items: number; folders: number; browserLocal: number; conflicts: number } }>("/api/navigation/import/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw })
    });
    const p = preview.preview;
    const confirmText = `检测到 ${p.groups} 个分组、${p.items} 个项目、${p.folders} 个文件夹、${p.conflicts} 个冲突。\n\n${strategy === "replace" ? "替换模式会删除当前导航。" : "合并模式会保留当前导航。"}继续？`;
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const payload = await requestJSON<{ tree: { groups: NavGroup[] } }>("/api/navigation/import/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw, strategy, overwrite: true })
      });
      setGroups(payload.tree.groups);
      setSelectedGroupId(payload.tree.groups?.[0]?.id ?? null);
      setMessage("iTab 数据已导入");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "import_failed");
    } finally {
      setBusy(false);
    }
  }

  if (!groups) return error ? <ErrorCard message={error} /> : <LoadingCard text="正在加载导航…" />;

  return (
    <>
      <AdminTitle eyebrow="START" title="起始页导航" description="分组、链接、文件夹、排序与 iTab 导入导出都已切到 Native API。" />
      <div className="km-nav-admin-layout">
        <aside className="km-panel km-nav-groups">
          <header><strong>分组</strong><button className="dk-button dk-button-primary" onClick={() => setGroupDraft(emptyGroup())}>新增</button></header>
          <div className="km-nav-group-list">
            {groups.map((group) => (
              <button key={group.id} className={group.id === selectedGroup?.id ? "is-active" : ""} onClick={() => setSelectedGroupId(group.id)}>
                <span>{group.icon || "•"}</span><strong>{group.name}</strong><small>{group.items.length}</small>
              </button>
            ))}
          </div>
          <div className="km-nav-import">
            <a className="dk-button" href="/api/navigation/export">导出 iTab</a>
            <label className="dk-button">合并导入<input hidden type="file" accept=".itabdata,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importItab(f, "merge"); e.currentTarget.value = ""; }} /></label>
            <label className="dk-button">替换导入<input hidden type="file" accept=".itabdata,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importItab(f, "replace"); e.currentTarget.value = ""; }} /></label>
          </div>
        </aside>

        <section className="km-nav-admin-main">
          {selectedGroup ? (
            <>
              <div className="km-panel km-nav-toolbar">
                <div><span className="km-eyebrow">GROUP</span><h2>{selectedGroup.name}</h2><small>{selectedGroup.visibility === "public" ? "公开" : "私有"}</small></div>
                <div>
                  <button className="dk-button" onClick={() => void moveGroup(selectedGroup, -1)}>↑</button>
                  <button className="dk-button" onClick={() => void moveGroup(selectedGroup, 1)}>↓</button>
                  <button className="dk-button" onClick={() => setGroupDraft({ id: selectedGroup.id, name: selectedGroup.name, icon: selectedGroup.icon, visibility: selectedGroup.visibility })}>编辑分组</button>
                  <button className="dk-button dk-button-primary" onClick={() => setItemDraft(emptyItem(selectedGroup.id))}>新增导航</button>
                  <button className="dk-button km-danger-button" onClick={() => void removeGroup(selectedGroup)}>删除分组</button>
                </div>
              </div>

              <div className="km-nav-item-list">
                {allItems.map(({ item, depth }) => (
                  <article className="km-panel km-nav-row" key={item.id} style={{ "--km-nav-depth": String(depth) } as React.CSSProperties}>
                    <div className="km-nav-row-icon">{item.iconUrl ? <img src={item.iconUrl} alt="" /> : item.iconText || (item.type === "folder" ? "▣" : item.name.slice(0, 1))}</div>
                    <div className="km-nav-row-copy">
                      <strong>{item.name}</strong>
                      <small>{item.type === "folder" ? `${item.children.length} 个子项` : item.url || "无 URL"}</small>
                    </div>
                    <span>{item.size}</span>
                    <span>{item.visibility === "public" ? "公开" : "私有"}</span>
                    {item.browserLocal ? <em>本地</em> : null}
                    <div className="km-nav-row-actions">
                      <button onClick={() => void moveItem(item, -1)}>↑</button>
                      <button onClick={() => void moveItem(item, 1)}>↓</button>
                      <button onClick={() => editItem(item)}>编辑</button>
                      <button onClick={() => void removeItem(item)}>删除</button>
                    </div>
                  </article>
                ))}
                {!allItems.length ? <section className="km-panel km-empty">这个分组还没有导航项。</section> : null}
              </div>
            </>
          ) : <section className="km-panel km-empty">先创建或选择一个分组。</section>}
        </section>
      </div>

      {groupDraft ? (
        <div className="km-modal-backdrop" onMouseDown={() => setGroupDraft(null)}>
          <form className="km-panel km-edit-modal" onSubmit={(e) => void saveGroup(e)} onMouseDown={(e) => e.stopPropagation()}>
            <header><div><span className="km-eyebrow">GROUP</span><h2>{groupDraft.id ? "编辑分组" : "新增分组"}</h2></div><button type="button" onClick={() => setGroupDraft(null)}>×</button></header>
            <label className="dk-field">名称<input autoFocus value={groupDraft.name} onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })} /></label>
            <label className="dk-field">图标/Emoji<input value={groupDraft.icon} onChange={(e) => setGroupDraft({ ...groupDraft, icon: e.target.value })} /></label>
            <label className="dk-field">可见性<select value={groupDraft.visibility} onChange={(e) => setGroupDraft({ ...groupDraft, visibility: e.target.value as GroupDraft["visibility"] })}><option value="private">私有</option><option value="public">公开</option></select></label>
            <footer><button type="button" className="dk-button" onClick={() => setGroupDraft(null)}>取消</button><button className="dk-button dk-button-primary" disabled={busy || !groupDraft.name.trim()}>保存</button></footer>
          </form>
        </div>
      ) : null}

      {itemDraft ? (
        <div className="km-modal-backdrop" onMouseDown={() => setItemDraft(null)}>
          <form className="km-panel km-edit-modal is-wide" onSubmit={(e) => void saveItem(e)} onMouseDown={(e) => e.stopPropagation()}>
            <header><div><span className="km-eyebrow">ITEM</span><h2>{itemDraft.id ? "编辑导航" : "新增导航"}</h2></div><button type="button" onClick={() => setItemDraft(null)}>×</button></header>
            <div className="km-form-grid">
              <label className="dk-field">名称<input autoFocus value={itemDraft.name} onChange={(e) => setItemDraft({ ...itemDraft, name: e.target.value })} /></label>
              <label className="dk-field">类型<select value={itemDraft.type} onChange={(e) => setItemDraft({ ...itemDraft, type: e.target.value as ItemDraft["type"] })}><option value="link">链接</option><option value="folder">文件夹</option></select></label>
              <label className="dk-field km-span-2">URL<input value={itemDraft.url} disabled={itemDraft.type === "folder"} onChange={(e) => setItemDraft({ ...itemDraft, url: e.target.value })} placeholder="https://..." /></label>
              <label className="dk-field">父文件夹<select value={itemDraft.parentId ?? 0} onChange={(e) => setItemDraft({ ...itemDraft, parentId: Number(e.target.value) || null })}><option value={0}>顶层</option>{folders.filter(({ item }) => item.id !== itemDraft.id).map(({ item, depth }) => <option key={item.id} value={item.id}>{"—".repeat(depth + 1)} {item.name}</option>)}</select></label>
              <label className="dk-field">尺寸<select value={itemDraft.size} onChange={(e) => setItemDraft({ ...itemDraft, size: e.target.value as ItemDraft["size"] })}><option value="1x1">1×1</option><option value="2x1">2×1</option><option value="2x2">2×2</option></select></label>
              <label className="dk-field">图标 URL<input value={itemDraft.iconUrl} onChange={(e) => setItemDraft({ ...itemDraft, iconUrl: e.target.value })} /></label>
              <label className="dk-field">图标文字<input value={itemDraft.iconText} onChange={(e) => setItemDraft({ ...itemDraft, iconText: e.target.value })} /></label>
              <label className="dk-field">背景色<input value={itemDraft.backgroundColor} onChange={(e) => setItemDraft({ ...itemDraft, backgroundColor: e.target.value })} placeholder="#6366f1" /></label>
              <label className="dk-field">可见性<select value={itemDraft.visibility} onChange={(e) => setItemDraft({ ...itemDraft, visibility: e.target.value as ItemDraft["visibility"] })}><option value="private">私有</option><option value="public">公开</option></select></label>
            </div>
            {error ? <div className="dk-message is-danger">{error}</div> : null}
            <footer><button type="button" className="dk-button" onClick={() => setItemDraft(null)}>取消</button><button className="dk-button dk-button-primary" disabled={busy || !itemDraft.name.trim()}>保存</button></footer>
          </form>
        </div>
      ) : null}

      {message ? <div className="km-toast">{message}</div> : null}
    </>
  );
}
