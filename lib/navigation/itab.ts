import { getDb } from "@/lib/db";
import { getNavigationTree } from "./repository";
import type { NavGroup, NavItem, NavItemSize } from "./types";

type JsonObject = Record<string, unknown>;

type ImportedItem = {
  externalId: string | null;
  name: string;
  url: string;
  type: "link" | "folder";
  iconUrl: string;
  iconText: string;
  backgroundColor: string;
  size: NavItemSize;
  visitCount: number;
  browserLocal: boolean;
  extra: JsonObject;
  children: ImportedItem[];
};

type ImportedGroup = {
  externalId: string | null;
  name: string;
  icon: string;
  extra: JsonObject;
  items: ImportedItem[];
};

export type ItabImportPreview = {
  groups: number;
  items: number;
  folders: number;
  browserLocal: number;
  conflicts: number;
};

export type ItabImportResult = ItabImportPreview & {
  addedGroups: number;
  addedItems: number;
  updatedGroups: number;
  updatedItems: number;
  skippedGroups: number;
  skippedItems: number;
};

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function integer(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function extraFields(source: JsonObject, known: string[]) {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(source)) {
    if (!known.includes(key)) result[key] = value;
  }
  return result;
}

function browserLocal(url: string) {
  return /^(about|moz-extension|chrome|chrome-extension|edge|file):/i.test(url.trim());
}

function importSize(value: unknown): NavItemSize {
  if (value === "2x4") return "2x1";
  if (value === "4x4" || value === "4x2") return "2x2";
  return "1x1";
}

function exportSize(value: NavItemSize) {
  if (value === "2x1") return "2x4";
  if (value === "2x2") return "4x4";
  return "2x2";
}

function parseItem(value: unknown): ImportedItem {
  const source = object(value);
  const rawChildren = Array.isArray(source.children) ? source.children : [];
  const originalType = text(source.type, rawChildren.length ? "folder" : "text");
  const type = originalType === "folder" || rawChildren.length > 0 ? "folder" : "link";
  const rawSize = typeof source.size === "string" ? source.size : null;
  const rawView = typeof source.view === "number" ? source.view : null;
  const url = text(source.url);
  const extra = extraFields(source, [
    "id", "url", "type", "name", "src", "iconText", "backgroundColor", "view", "size", "children"
  ]);
  extra.__knowMeItab = {
    originalType,
    originalSize: rawSize,
    hadView: rawView !== null
  };

  return {
    externalId: text(source.id) || null,
    name: text(source.name, "未命名"),
    url,
    type,
    iconUrl: text(source.src),
    iconText: text(source.iconText),
    backgroundColor: text(source.backgroundColor),
    size: importSize(source.size),
    visitCount: integer(source.view),
    browserLocal: browserLocal(url),
    extra,
    children: rawChildren.map(parseItem)
  };
}

function parseGroup(value: unknown): ImportedGroup {
  const source = object(value);
  const items = Array.isArray(source.children) ? source.children.map(parseItem) : [];
  return {
    externalId: text(source.id) || null,
    name: text(source.name, "未命名分组"),
    icon: text(source.icon),
    extra: extraFields(source, ["id", "name", "icon", "children"]),
    items
  };
}

export function parseItab(textValue: string): ImportedGroup[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(textValue);
  } catch {
    throw new Error("itab_invalid_json");
  }

  const root = object(parsed);
  if (!Array.isArray(root.navConfig)) throw new Error("itab_missing_nav_config");
  return root.navConfig.map(parseGroup);
}

function flatten(items: ImportedItem[]) {
  const output: ImportedItem[] = [];
  const visit = (item: ImportedItem) => {
    output.push(item);
    item.children.forEach(visit);
  };
  items.forEach(visit);
  return output;
}

function groupMatches(imported: ImportedGroup, existing: NavGroup) {
  if (imported.externalId && existing.externalId === imported.externalId) return true;
  return existing.name.trim().toLocaleLowerCase() === imported.name.trim().toLocaleLowerCase();
}

function itemMatches(imported: ImportedItem, existing: NavItem) {
  if (imported.externalId && existing.externalId === imported.externalId) return true;
  if (imported.url && existing.url === imported.url) return true;
  return existing.name.trim().toLocaleLowerCase() === imported.name.trim().toLocaleLowerCase();
}

function countItemConflicts(imported: ImportedItem[], existing: NavItem[]): number {
  let conflicts = 0;
  for (const item of imported) {
    const match = existing.find((candidate) => itemMatches(item, candidate));
    if (match) {
      conflicts += 1;
      conflicts += countItemConflicts(item.children, match.children);
    }
  }
  return conflicts;
}

export function previewItabImport(textValue: string): ItabImportPreview {
  const groups = parseItab(textValue);
  const existing = getNavigationTree(true).groups;
  let items = 0;
  let folders = 0;
  let local = 0;
  let conflicts = 0;

  for (const group of groups) {
    const all = flatten(group.items);
    items += all.length;
    folders += all.filter((item) => item.type === "folder").length;
    local += all.filter((item) => item.browserLocal).length;
    const match = existing.find((candidate) => groupMatches(group, candidate));
    if (match) {
      conflicts += 1;
      conflicts += countItemConflicts(group.items, match.items);
    }
  }

  return { groups: groups.length, items, folders, browserLocal: local, conflicts };
}

function findGroup(imported: ImportedGroup) {
  const db = getDb();
  if (imported.externalId) {
    const row = db.prepare("SELECT id FROM nav_groups WHERE external_id = ? LIMIT 1").get(imported.externalId) as { id: number } | undefined;
    if (row) return row.id;
  }
  const row = db.prepare("SELECT id FROM nav_groups WHERE name = ? COLLATE NOCASE LIMIT 1").get(imported.name) as { id: number } | undefined;
  return row?.id ?? null;
}

function findItem(groupId: number, parentId: number | null, imported: ImportedItem) {
  const db = getDb();
  const parentClause = "((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)";
  if (imported.externalId) {
    const row = db.prepare(`SELECT id FROM nav_items WHERE group_id = ? AND ${parentClause} AND external_id = ? LIMIT 1`)
      .get(groupId, parentId, parentId, imported.externalId) as { id: number } | undefined;
    if (row) return row.id;
  }
  if (imported.url) {
    const row = db.prepare(`SELECT id FROM nav_items WHERE group_id = ? AND ${parentClause} AND url = ? LIMIT 1`)
      .get(groupId, parentId, parentId, imported.url) as { id: number } | undefined;
    if (row) return row.id;
  }
  const row = db.prepare(`SELECT id FROM nav_items WHERE group_id = ? AND ${parentClause} AND name = ? COLLATE NOCASE LIMIT 1`)
    .get(groupId, parentId, parentId, imported.name) as { id: number } | undefined;
  return row?.id ?? null;
}

function insertGroup(group: ImportedGroup, sortOrder: number) {
  const now = Date.now();
  const result = getDb().prepare(
    "INSERT INTO nav_groups (external_id, name, icon, sort_order, visibility, extra_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(group.externalId, group.name, group.icon, sortOrder, "private", JSON.stringify(group.extra), now, now);
  return Number(result.lastInsertRowid);
}

function updateGroupFromImport(id: number, group: ImportedGroup, sortOrder: number) {
  getDb().prepare(
    "UPDATE nav_groups SET external_id = ?, name = ?, icon = ?, sort_order = ?, extra_json = ?, updated_at = ? WHERE id = ?"
  ).run(group.externalId, group.name, group.icon, sortOrder, JSON.stringify(group.extra), Date.now(), id);
}

function insertItem(groupId: number, parentId: number | null, item: ImportedItem, sortOrder: number) {
  const now = Date.now();
  const result = getDb().prepare(
    `INSERT INTO nav_items
      (external_id, group_id, parent_id, type, name, url, icon_url, icon_text, background_color, size, visit_count, sort_order, visibility, browser_local, extra_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    item.externalId, groupId, parentId, item.type, item.name, item.url, item.iconUrl, item.iconText,
    item.backgroundColor, item.size, item.visitCount, sortOrder, "private", item.browserLocal ? 1 : 0,
    JSON.stringify(item.extra), now, now
  );
  return Number(result.lastInsertRowid);
}

function updateItemFromImport(id: number, groupId: number, parentId: number | null, item: ImportedItem, sortOrder: number) {
  getDb().prepare(
    `UPDATE nav_items SET external_id = ?, group_id = ?, parent_id = ?, type = ?, name = ?, url = ?, icon_url = ?, icon_text = ?,
      background_color = ?, size = ?, visit_count = ?, sort_order = ?, browser_local = ?, extra_json = ?, updated_at = ? WHERE id = ?`
  ).run(
    item.externalId, groupId, parentId, item.type, item.name, item.url, item.iconUrl, item.iconText,
    item.backgroundColor, item.size, item.visitCount, sortOrder, item.browserLocal ? 1 : 0, JSON.stringify(item.extra), Date.now(), id
  );
}

type MutableCounts = { addedGroups: number; addedItems: number; updatedGroups: number; updatedItems: number; skippedGroups: number; skippedItems: number };

function mergeItems(groupId: number, parentId: number | null, items: ImportedItem[], overwrite: boolean, counts: MutableCounts) {
  items.forEach((item, index) => {
    const existingId = findItem(groupId, parentId, item);
    let itemId: number;
    if (existingId) {
      itemId = existingId;
      if (overwrite) {
        updateItemFromImport(existingId, groupId, parentId, item, index);
        counts.updatedItems += 1;
      } else {
        counts.skippedItems += 1;
      }
    } else {
      itemId = insertItem(groupId, parentId, item, index);
      counts.addedItems += 1;
    }
    if (item.children.length) mergeItems(groupId, itemId, item.children, overwrite, counts);
  });
}

export function applyItabImport(textValue: string, strategy: "merge" | "replace", overwrite = false): ItabImportResult {
  const groups = parseItab(textValue);
  const preview = previewItabImport(textValue);
  const counts: MutableCounts = { addedGroups: 0, addedItems: 0, updatedGroups: 0, updatedItems: 0, skippedGroups: 0, skippedItems: 0 };
  const db = getDb();

  db.transaction(() => {
    if (strategy === "replace") db.prepare("DELETE FROM nav_groups").run();

    groups.forEach((group, groupIndex) => {
      const existingId = strategy === "replace" ? null : findGroup(group);
      let groupId: number;
      if (existingId) {
        groupId = existingId;
        if (overwrite) {
          updateGroupFromImport(existingId, group, groupIndex);
          counts.updatedGroups += 1;
        } else {
          counts.skippedGroups += 1;
        }
      } else {
        groupId = insertGroup(group, groupIndex);
        counts.addedGroups += 1;
      }
      mergeItems(groupId, null, group.items, overwrite || strategy === "replace", counts);
    });
  })();

  return { ...preview, ...counts };
}

function splitExtra(extra: Record<string, unknown>) {
  const copy = { ...extra };
  const meta = object(copy.__knowMeItab);
  delete copy.__knowMeItab;
  return { copy, meta };
}

function exportItem(item: NavItem): JsonObject {
  const { copy, meta } = splitExtra(item.extra);
  const originalType = text(meta.originalType);
  const type = item.type === "folder" ? "folder" : originalType === "icon" || originalType === "text"
    ? originalType
    : item.iconUrl ? "icon" : "text";

  const result: JsonObject = {
    ...copy,
    id: item.externalId ?? `know_me_${item.id}`,
    url: item.url,
    name: item.name,
    src: item.iconUrl,
    type,
    iconText: item.iconText,
    backgroundColor: item.backgroundColor,
    size: exportSize(item.size)
  };
  if (Boolean(meta.hadView) || item.visitCount > 0) result.view = item.visitCount;
  if (item.type === "folder") result.children = item.children.map(exportItem);
  return result;
}

function exportGroup(group: NavGroup): JsonObject {
  return {
    ...group.extra,
    id: group.externalId ?? `know_me_group_${group.id}`,
    name: group.name,
    icon: group.icon,
    children: group.items.map(exportItem)
  };
}

export function exportItab() {
  return JSON.stringify({ navConfig: getNavigationTree(true).groups.map(exportGroup) }, null, 2);
}
