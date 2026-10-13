import type { NavItem } from "./types";

export type ShortcutSortMode = "name" | "visits" | "reverse";

/** Reorder only direct links in a group, never its folders or nested items. */
export function replaceLinkOrder(items: NavItem[], sortedLinks: NavItem[]): number[] {
  const links = items.filter((item) => item.type === "link");
  const originalIDs = new Set(links.map((item) => item.id));
  const sortedIDs = sortedLinks.map((item) => item.id);
  if (sortedIDs.length !== originalIDs.size || new Set(sortedIDs).size !== originalIDs.size ||
      sortedIDs.some((id) => !originalIDs.has(id))) {
    throw new Error("invalid_shortcut_order");
  }
  let index = 0;
  return items.map((item) => item.type === "folder" ? item.id : sortedIDs[index++]);
}

export function quickSortStandaloneLinks(items: NavItem[], mode: ShortcutSortMode): NavItem[] {
  const links = items.filter((item) => item.type === "link");
  if (mode === "name") links.sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || a.id - b.id);
  else if (mode === "visits") links.sort((a, b) => b.visitCount - a.visitCount || a.name.localeCompare(b.name, "zh-CN"));
  else links.reverse();
  return links;
}

export function moveStandaloneLink(items: NavItem[], sourceID: number, targetID: number): NavItem[] | null {
  const links = items.filter((item) => item.type === "link");
  const sourceIndex = links.findIndex((item) => item.id === sourceID);
  const targetIndex = links.findIndex((item) => item.id === targetID);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null;
  const [moved] = links.splice(sourceIndex, 1);
  links.splice(targetIndex, 0, moved);
  return links;
}
