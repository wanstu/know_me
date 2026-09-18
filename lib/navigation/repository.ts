import { getDb } from "@/lib/db";
import type { NavGroup, NavItem, NavItemSize, NavItemType, NavVisibility, NavigationTree } from "./types";

type GroupRow = {
  id: number; externalId: string | null; name: string; icon: string; sortOrder: number;
  visibility: NavVisibility; extraJson: string;
};
type ItemRow = {
  id: number; externalId: string | null; groupId: number; parentId: number | null;
  type: NavItemType; name: string; url: string; iconUrl: string; iconText: string;
  backgroundColor: string; size: NavItemSize; visitCount: number; sortOrder: number;
  visibility: NavVisibility; browserLocal: number; extraJson: string;
};

function parseExtra(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapItem(row: ItemRow): NavItem {
  return {
    id: row.id, externalId: row.externalId, groupId: row.groupId, parentId: row.parentId,
    type: row.type, name: row.name, url: row.url, iconUrl: row.iconUrl, iconText: row.iconText,
    backgroundColor: row.backgroundColor, size: row.size, visitCount: row.visitCount,
    sortOrder: row.sortOrder, visibility: row.visibility, browserLocal: row.browserLocal === 1,
    extra: parseExtra(row.extraJson), children: []
  };
}

export function getNavigationTree(includePrivate = true): NavigationTree {
  const db = getDb();
  const groupRows = db.prepare(
    `SELECT id, external_id AS externalId, name, icon, sort_order AS sortOrder, visibility, extra_json AS extraJson
     FROM nav_groups
     WHERE (? = 1 OR visibility = 'public')
     ORDER BY sort_order ASC, id ASC`
  ).all(includePrivate ? 1 : 0) as GroupRow[];

  const itemRows = db.prepare(
    `SELECT id, external_id AS externalId, group_id AS groupId, parent_id AS parentId, type, name, url,
            icon_url AS iconUrl, icon_text AS iconText, background_color AS backgroundColor, size,
            visit_count AS visitCount, sort_order AS sortOrder, visibility, browser_local AS browserLocal,
            extra_json AS extraJson
     FROM nav_items
     WHERE (? = 1 OR visibility = 'public')
     ORDER BY group_id ASC, parent_id ASC, sort_order ASC, id ASC`
  ).all(includePrivate ? 1 : 0) as ItemRow[];

  const byId = new Map<number, NavItem>();
  for (const row of itemRows) byId.set(row.id, mapItem(row));

  const groupItems = new Map<number, NavItem[]>();
  for (const item of byId.values()) {
    if (item.parentId && byId.has(item.parentId)) {
      byId.get(item.parentId)!.children.push(item);
    } else {
      const list = groupItems.get(item.groupId) ?? [];
      list.push(item);
      groupItems.set(item.groupId, list);
    }
  }

  const groups: NavGroup[] = groupRows.map((row) => ({
    id: row.id, externalId: row.externalId, name: row.name, icon: row.icon, sortOrder: row.sortOrder,
    visibility: row.visibility, extra: parseExtra(row.extraJson), items: groupItems.get(row.id) ?? []
  }));
  return { groups };
}

export type GroupInput = {
  name: string; icon?: string; visibility?: NavVisibility; externalId?: string | null;
  sortOrder?: number; extra?: Record<string, unknown>;
};

export function createGroup(input: GroupInput) {
  const db = getDb();
  const now = Date.now();
  const max = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM nav_groups").get() as { value: number };
  const result = db.prepare(
    "INSERT INTO nav_groups (external_id, name, icon, sort_order, visibility, extra_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    input.externalId ?? null, input.name.trim(), input.icon?.trim() ?? "",
    input.sortOrder ?? max.value + 1, input.visibility ?? "private", JSON.stringify(input.extra ?? {}), now, now
  );
  return Number(result.lastInsertRowid);
}

export function updateGroup(id: number, input: Partial<GroupInput>) {
  const current = getDb().prepare(
    "SELECT name, icon, visibility, external_id AS externalId, sort_order AS sortOrder, extra_json AS extraJson FROM nav_groups WHERE id = ?"
  ).get(id) as (Omit<GroupRow, "id">) | undefined;
  if (!current) return false;
  const db = getDb();
  db.prepare(
    "UPDATE nav_groups SET external_id = ?, name = ?, icon = ?, sort_order = ?, visibility = ?, extra_json = ?, updated_at = ? WHERE id = ?"
  ).run(
    input.externalId === undefined ? current.externalId : input.externalId,
    input.name === undefined ? current.name : input.name.trim(),
    input.icon === undefined ? current.icon : input.icon.trim(),
    input.sortOrder ?? current.sortOrder,
    input.visibility ?? current.visibility,
    JSON.stringify(input.extra ?? parseExtra(current.extraJson)),
    Date.now(), id
  );
  return true;
}

export function deleteGroup(id: number) {
  return getDb().prepare("DELETE FROM nav_groups WHERE id = ?").run(id).changes > 0;
}

export type ItemInput = {
  groupId: number; parentId?: number | null; type?: NavItemType; name: string; url?: string;
  iconUrl?: string; iconText?: string; backgroundColor?: string; size?: NavItemSize;
  visitCount?: number; sortOrder?: number; visibility?: NavVisibility; browserLocal?: boolean;
  externalId?: string | null; extra?: Record<string, unknown>;
};

function isBrowserLocalUrl(url: string) {
  return /^(about|moz-extension|chrome|chrome-extension|edge|file):/i.test(url.trim());
}

function validateNavUrl(url: string) {
  const value = url.trim();
  if (!value) return;
  if (!/^(https?:|about:|moz-extension:|chrome:|chrome-extension:|edge:|file:)/i.test(value)) {
    throw new Error("unsupported_nav_url");
  }
}

function validateIconUrl(url: string) {
  const value = url.trim();
  if (!value) return;
  if (!/^https?:\/\//i.test(value) && !value.startsWith("/media/")) {
    throw new Error("unsupported_icon_url");
  }
}

function ensureGroupExists(groupId: number) {
  const row = getDb().prepare("SELECT 1 FROM nav_groups WHERE id = ? LIMIT 1").get(groupId);
  if (!row) throw new Error("group_not_found");
}

function validatePlacement(itemId: number | null, groupId: number, parentId: number | null) {
  const db = getDb();
  ensureGroupExists(groupId);
  if (!parentId) return;

  let cursor: number | null = parentId;
  let first = true;
  while (cursor) {
    if (itemId && cursor === itemId) throw new Error("navigation_cycle");
    const row = db.prepare(
      "SELECT id, group_id AS groupId, parent_id AS parentId, type FROM nav_items WHERE id = ? LIMIT 1"
    ).get(cursor) as { id: number; groupId: number; parentId: number | null; type: NavItemType } | undefined;
    if (!row) throw new Error("parent_not_found");
    if (row.groupId !== groupId) throw new Error("parent_group_mismatch");
    if (first && row.type !== "folder") throw new Error("parent_not_folder");
    first = false;
    cursor = row.parentId;
  }
}

function nextItemSort(groupId: number, parentId: number | null) {
  const row = getDb().prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS value FROM nav_items WHERE group_id = ? AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)"
  ).get(groupId, parentId, parentId) as { value: number };
  return row.value + 1;
}

function moveDescendantsToGroup(itemId: number, groupId: number) {
  const sql =
    "WITH RECURSIVE descendants(id) AS (" +
    " SELECT id FROM nav_items WHERE parent_id = ?" +
    " UNION ALL" +
    " SELECT nav_items.id FROM nav_items JOIN descendants ON nav_items.parent_id = descendants.id" +
    ")" +
    " UPDATE nav_items SET group_id = ?, updated_at = ? WHERE id IN (SELECT id FROM descendants)";
  getDb().prepare(sql).run(itemId, groupId, Date.now());
}

export function createItem(input: ItemInput) {
  const db = getDb();
  const now = Date.now();
  const parentId = input.parentId ?? null;
  const type = input.type ?? "link";
  const name = input.name.trim();
  const url = input.url?.trim() ?? "";
  const iconUrl = input.iconUrl?.trim() ?? "";

  if (!name) throw new Error("item_name_required");
  validateNavUrl(url);
  validateIconUrl(iconUrl);
  validatePlacement(null, input.groupId, parentId);

  const browserLocal = input.browserLocal ?? isBrowserLocalUrl(url);
  const result = db.prepare(
    "INSERT INTO nav_items " +
    "(external_id, group_id, parent_id, type, name, url, icon_url, icon_text, background_color, size, visit_count, sort_order, visibility, browser_local, extra_json, created_at, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    input.externalId ?? null, input.groupId, parentId, type, name, url,
    iconUrl, input.iconText?.trim() ?? "", input.backgroundColor?.trim() ?? "", input.size ?? "1x1",
    input.visitCount ?? 0, input.sortOrder ?? nextItemSort(input.groupId, parentId), input.visibility ?? "private",
    browserLocal ? 1 : 0, JSON.stringify(input.extra ?? {}), now, now
  );
  return Number(result.lastInsertRowid);
}

export function updateItem(id: number, input: Partial<ItemInput>) {
  const db = getDb();
  const current = db.prepare(
    "SELECT external_id AS externalId, group_id AS groupId, parent_id AS parentId, type, name, url, icon_url AS iconUrl, " +
    "icon_text AS iconText, background_color AS backgroundColor, size, visit_count AS visitCount, sort_order AS sortOrder, " +
    "visibility, browser_local AS browserLocal, extra_json AS extraJson FROM nav_items WHERE id = ?"
  ).get(id) as ItemRow | undefined;
  if (!current) return false;

  const groupId = input.groupId ?? current.groupId;
  const parentId = input.parentId === undefined ? current.parentId : input.parentId;
  const type = input.type ?? current.type;
  const name = input.name === undefined ? current.name : input.name.trim();
  const url = input.url === undefined ? current.url : input.url.trim();
  const iconUrl = input.iconUrl === undefined ? current.iconUrl : input.iconUrl.trim();

  if (!name) throw new Error("item_name_required");
  validateNavUrl(url);
  validateIconUrl(iconUrl);
  validatePlacement(id, groupId, parentId);

  if (current.type === "folder" && type !== "folder") {
    const child = db.prepare("SELECT 1 FROM nav_items WHERE parent_id = ? LIMIT 1").get(id);
    if (child) throw new Error("folder_has_children");
  }

  const moved = groupId !== current.groupId || parentId !== current.parentId;
  const sortOrder = input.sortOrder ?? (moved ? nextItemSort(groupId, parentId) : current.sortOrder);
  const browserLocal = input.browserLocal === undefined
    ? (input.url === undefined ? current.browserLocal === 1 : isBrowserLocalUrl(url))
    : input.browserLocal;

  db.transaction(() => {
    db.prepare(
      "UPDATE nav_items SET external_id = ?, group_id = ?, parent_id = ?, type = ?, name = ?, url = ?, icon_url = ?, icon_text = ?, " +
      "background_color = ?, size = ?, visit_count = ?, sort_order = ?, visibility = ?, browser_local = ?, extra_json = ?, updated_at = ? " +
      "WHERE id = ?"
    ).run(
      input.externalId === undefined ? current.externalId : input.externalId,
      groupId, parentId, type, name, url, iconUrl,
      input.iconText === undefined ? current.iconText : input.iconText.trim(),
      input.backgroundColor === undefined ? current.backgroundColor : input.backgroundColor.trim(),
      input.size ?? current.size, input.visitCount ?? current.visitCount, sortOrder,
      input.visibility ?? current.visibility, browserLocal ? 1 : 0,
      JSON.stringify(input.extra ?? parseExtra(current.extraJson)), Date.now(), id
    );

    if (groupId !== current.groupId && current.type === "folder") {
      moveDescendantsToGroup(id, groupId);
    }
  })();

  return true;
}

export function deleteItem(id: number) {
  return getDb().prepare("DELETE FROM nav_items WHERE id = ?").run(id).changes > 0;
}

export function reorderGroups(ids: number[]) {
  const db = getDb();
  const update = db.prepare("UPDATE nav_groups SET sort_order = ?, updated_at = ? WHERE id = ?");
  db.transaction(() => ids.forEach((id, index) => update.run(index, Date.now(), id)))();
}

export function reorderItems(groupId: number, parentId: number | null, ids: number[]) {
  const db = getDb();
  const update = db.prepare("UPDATE nav_items SET group_id = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?");
  db.transaction(() => ids.forEach((id, index) => update.run(groupId, parentId, index, Date.now(), id)))();
}

export function incrementItemVisit(id: number) {
  getDb().prepare("UPDATE nav_items SET visit_count = visit_count + 1, updated_at = ? WHERE id = ?").run(Date.now(), id);
}
