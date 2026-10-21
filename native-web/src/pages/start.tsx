import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from "react";
import { requestJSON } from "../api";
import { openExternalBrowser } from "../external-links";
import { siteLinkAllowed } from "../route-access";
import { replaceLinkOrder, quickSortStandaloneLinks, moveStandaloneLink, type ShortcutSortMode } from "../start-shortcut-order";
import { loopEdgeVirtual, nearestLoopVirtual, startLoopSlots, wrapLoopIndex } from "../start-loop-window";
import { START_SEARCH_ENGINES, configuredStartSearchEngines, isStartSearchEngine, nextStartSearchEngine, startSearchURL, type StartSearchEngine } from "../start-search-engines";
import type { SearchEngineConfig } from "../types";
import type { NavGroup, NavItem, SessionUser, SiteSettings } from "../types";
import { ErrorCard, LoadingCard, PageFrame, isExternal, safeHref } from "../ui";

type FlatItem = { item: NavItem; group: string; folder?: string };
type FolderSize = "small" | "medium" | "large";
type StartContextMenu = { item: NavItem | null; x: number; y: number };

function folderSize(item: NavItem): FolderSize {
  return item.extra?.startFolderSize === "small" || item.extra?.startFolderSize === "large"
    ? item.extra.startFolderSize : "medium";
}

function previewCapacity(size: FolderSize, width: number) {
  if (width <= 560) return size === "small" ? 3 : size === "large" ? 12 : 6;
  if (width <= 1190) return size === "small" ? 4 : size === "large" ? 12 : 6;
  return size === "small" ? 5 : size === "large" ? 16 : 8;
}

function flattenItems(groups: NavGroup[]) {
  const result: FlatItem[] = [];
  const visit = (items: NavItem[], group: string, path: string[] = []) => {
    for (const item of items) {
      result.push({ item, group, folder: path.length ? path.join(" / ") : undefined });
      if (item.children?.length) visit(item.children, group, [...path, item.name]);
    }
  };
  groups.forEach((group) => visit(group.items ?? [], group.name));
  return result;
}

function folderTrail(groups: NavGroup[], targetID: number) {
  const visit = (items: NavItem[], ancestors: NavItem[]): NavItem[] | null => {
    for (const item of items) {
      if (item.id === targetID) return ancestors;
      const found = visit(item.children ?? [], item.type === "folder" ? [...ancestors, item] : ancestors);
      if (found) return found;
    }
    return null;
  };
  for (const group of groups) {
    const found = visit(group.items ?? [], []);
    if (found) return found;
  }
  return [];
}

function looksLikeURL(value: string) {
  return /^(https?:\/\/|about:|chrome:|edge:|file:|moz-extension:|chrome-extension:)/i.test(value);
}

function groupMark(group: NavGroup) {
  const marks: Record<string, string> = {
    home: "⌂", code: "⌘", read: "▤", app: "▦",
    entertainment: "◇", office: "▣", tool: "⚙"
  };
  const key = group.icon?.toLowerCase() ?? "";
  return marks[key] ?? (group.icon && group.icon.length <= 2 ? group.icon : group.name.slice(0, 1));
}


function iconTextColor(value: string) {
  const hex = value.trim().replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return undefined;
  const full = hex.length === 3 ? hex.split("").map((ch) => ch + ch).join("") : hex;
  const rgb = [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16) / 255);
  const brightness = rgb.map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return brightness[0] * .2126 + brightness[1] * .7152 + brightness[2] * .0722 > .28 ? "#152033" : "#fff";
}

function FallbackImage({ src, fallback, color, engine = false }: { src: string; fallback: string; color?: string; engine?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed
    ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
    : <span className={engine ? "km-start-engine-letter" : undefined} style={color ? { color } : undefined}>{fallback}</span>;
}

function EngineBadge({ engine }: { engine: SearchEngineConfig }) {
  const iconURL = /^https:\/\//i.test(engine.iconUrl ?? "") ? engine.iconUrl : "";
  const letter = engine.name.trim().slice(0, 1).toUpperCase();
  return <span className={"km-start-engine-mark is-" + engine.id.toLowerCase()} aria-hidden="true"><FallbackImage src={iconURL} fallback={letter} engine /></span>;
}

function icon(item: NavItem) {
  if (item.type === "folder") {
    return <svg className="km-start-folder-mini-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6.5a2 2 0 0 1 2-2h4.2l2.1 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
  }
  if (item.iconUrl && (/^https?:\/\//i.test(item.iconUrl) || item.iconUrl.startsWith("/media/"))) {
    return <FallbackImage src={item.iconUrl} fallback={item.iconText || item.name.slice(0, 1).toUpperCase()} color={item.backgroundColor ? iconTextColor(item.backgroundColor) : undefined} />;
  }
  return <span style={item.backgroundColor ? { color: iconTextColor(item.backgroundColor) } : undefined}>{item.iconText || item.name.slice(0, 1).toUpperCase()}</span>;
}

export function StartPage({ settings, user }: { settings: SiteSettings; user: SessionUser | null }) {
  const [groups, setGroups] = useState<NavGroup[]>([]);
  const [activeGroup, setActiveGroup] = useState<number | null>(null);
  const [folder, setFolder] = useState<NavItem | null>(null);
  const [folderHistory, setFolderHistory] = useState<NavItem[]>([]);
  const [folderSelectedIndex, setFolderSelectedIndex] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [contextMenu, setContextMenu] = useState<StartContextMenu | null>(null);
  const [contextError, setContextError] = useState("");
  const [savingItem, setSavingItem] = useState<number | null>(null);
  const [sortBusy, setSortBusy] = useState(false);
  const [dragLinkID, setDragLinkID] = useState<number | null>(null);
  const [dragTargetID, setDragTargetID] = useState<number | null>(null);
  const sortMenuRef = useRef<HTMLDetailsElement | null>(null);
  const lastDragAt = useRef(0);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [searchFocused, setSearchFocused] = useState(false);
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
  const searchShellRef = useRef<HTMLDivElement | null>(null);
  const engines = configuredStartSearchEngines(settings.searchEngines);
  const [activeEngine, setActiveEngine] = useState<StartSearchEngine>(() => {
    try {
      const stored = window.localStorage.getItem("knowme:start:search-engine");
      return isStartSearchEngine(stored, engines) ? stored : (isStartSearchEngine(settings.defaultSearchEngine, engines) ? settings.defaultSearchEngine : engines[0].id);
    } catch {
      return isStartSearchEngine(settings.defaultSearchEngine, engines) ? settings.defaultSearchEngine : engines[0].id;
    }
  });
  useEffect(() => {
    if (!isStartSearchEngine(activeEngine, engines)) {
      setActiveEngine(isStartSearchEngine(settings.defaultSearchEngine, engines) ? settings.defaultSearchEngine : engines[0].id);
    }
  }, [settings.searchEngines, settings.defaultSearchEngine, activeEngine]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const groupSectionRefs = useRef(new Map<number, HTMLElement>());
  const loopSectionRefs = useRef(new Map<number, HTMLElement>());
  const scrollSyncRAFRef = useRef<number | null>(null);
  const [loopCenterVirtual, setLoopCenterVirtual] = useState<number | null>(null);
  const loopPreserveRef = useRef<{ virtual: number; top: number } | null>(null);
  const loopInitialPositionedRef = useRef(false);
  const loopGroupsKeyRef = useRef("");

  // The Start page owns search shortcuts while mounted.
  // The search input's own keydown handler cycles engines on Tab/Shift+Tab.
  useEffect(() => {
    const focusShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key === "Process") return;
      const search = searchRef.current;
      if (!search) return;
      const find = (event.ctrlKey || event.metaKey) && !event.altKey &&
        !event.shiftKey && event.key.toLowerCase() === "f";
      if (find) {
        event.preventDefault();
        search.focus();
        search.select();
        return;
      }
      if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.metaKey ||
          event.altKey || document.activeElement === search) return;

      // Don't steal focus or Tab navigation from active form elements and dialogs.
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable ||
          target.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']"))) return;
      event.preventDefault();
      search.focus();
    };
    window.addEventListener("keydown", focusShortcut, true);
    return () => window.removeEventListener("keydown", focusShortcut, true);
  }, []);

  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !contextMenuRef.current?.contains(event.target)) setContextMenu(null);
    };
    const close = () => setContextMenu(null);
    document.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    contextMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);


  useEffect(() => {
    setError("");
    setLoaded(false);
    const endpoint = user ? "/api/navigation" : "/api/navigation/public";
    void requestJSON<{ groups: NavGroup[] }>(endpoint)
      .then((payload) => {
        const nextGroups = payload.groups ?? [];
        setGroups(nextGroups);
        setActiveGroup((current) => {
          if (current && nextGroups.some((item) => item.id === current)) return current;
          if (settings.startRememberLastTab) {
            try {
              const stored = Number(window.localStorage.getItem("knowme:start:last-group"));
              if (Number.isInteger(stored) && nextGroups.some((item) => item.id === stored)) return stored;
            } catch { /* Private mode remains usable. */ }
          }
          return nextGroups[0]?.id ?? null;
        });
        setLoaded(true);
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "navigation_failed");
        setLoaded(true);
      });
  }, [settings.startPublic, settings.startRememberLastTab, user]);

  const flat = useMemo(() => flattenItems(groups), [groups]);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return flat
      .filter(({ item, group, folder: parent }) =>
        [item.name, item.url, group, parent ?? ""].some((value) => value.toLocaleLowerCase().includes(needle))
      )
      .sort((a, b) => b.item.visitCount - a.item.visitCount)
      .slice(0, 30);
  }, [flat, query]);
  const searchMatches = matches.slice(0, 6);

  useEffect(() => {
    setSelectedIndex(-1);
  }, [query]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && searchShellRef.current?.contains(event.target)) return;
      setEngineMenuOpen(false);
      setSearchFocused(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable);

      if (event.key === "Escape" && event.target === searchRef.current) return;

      if (event.key === "Escape" && contextMenu) {
        event.preventDefault();
        setContextMenu(null);
        return;
      }

      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
        setSearchFocused(true);
        return;
      }

      if (folder) {
        const children = folder.children ?? [];
        if ((event.key === "ArrowDown" || event.key === "ArrowRight") && children.length) {
          event.preventDefault();
          setFolderSelectedIndex((value) => (value + 1) % children.length);
          return;
        }
        if ((event.key === "ArrowUp" || event.key === "ArrowLeft") && children.length) {
          event.preventDefault();
          setFolderSelectedIndex((value) => (value - 1 + children.length) % children.length);
          return;
        }
        if (event.key === "Enter" && children.length) {
          const child = children[Math.max(0, Math.min(folderSelectedIndex, children.length - 1))];
          if (child) {
            event.preventDefault();
            void openItem(child);
          }
          return;
        }
      }

      if (event.key === "Escape") {
        if (folder) {
          event.preventDefault();
          setFolder(null);
          setFolderHistory([]);
          setFolderSelectedIndex(0);
          return;
        }
        if (query) {
          event.preventDefault();
          setQuery("");
          searchRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [folder, folderSelectedIndex, query, contextMenu]);

  const group = groups.find((item) => item.id === activeGroup) ?? groups[0];

  function resetGroupTransientState() {
    setQuery("");
    setFolder(null);
    setFolderHistory([]);
    setFolderSelectedIndex(0);
    setContextMenu(null);
    setEngineMenuOpen(false);
    setSearchFocused(false);
  }

  const loopEnabled = settings.startWheelSwitchTabs && groups.length > 1;

  useLayoutEffect(() => {
    const className = "km-start-loop-scrollbar-hidden";
    document.documentElement.classList.toggle(className, loopEnabled);
    document.body.classList.toggle(className, loopEnabled);
    return () => {
      document.documentElement.classList.remove(className);
      document.body.classList.remove(className);
    };
  }, [loopEnabled]);

  const loopGroupsKey = groups.map((item) => item.id).join(",");
  const loopCenter = loopCenterVirtual ?? Math.max(0, groups.findIndex((item) => item.id === group?.id));
  const loopEntries = useMemo(() => {
    if (!loopEnabled) return [];
    return startLoopSlots(loopCenter, groups.length).map(({ virtual, index }) => ({
      virtual,
      item: groups[index]
    }));
  }, [groups, loopCenter, loopEnabled]);

  function setGroupSectionRef(groupID: number, node: HTMLElement | null) {
    if (node) groupSectionRefs.current.set(groupID, node);
    else groupSectionRefs.current.delete(groupID);
  }

  function setLoopSectionRef(virtual: number, node: HTMLElement | null) {
    if (node) loopSectionRefs.current.set(virtual, node);
    else loopSectionRefs.current.delete(virtual);
  }

  function scrollByImmediately(delta: number) {
    if (Math.abs(delta) < .5) return;
    const root = document.documentElement;
    const body = document.body;
    const rootBehavior = root.style.scrollBehavior;
    const bodyBehavior = body.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    body.style.scrollBehavior = "auto";
    window.scrollBy(0, delta);
    root.style.scrollBehavior = rootBehavior;
    body.style.scrollBehavior = bodyBehavior;
  }

  function scrollNodeImmediately(node: HTMLElement) {
    const root = document.documentElement;
    const body = document.body;
    const rootBehavior = root.style.scrollBehavior;
    const bodyBehavior = body.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    body.style.scrollBehavior = "auto";
    node.scrollIntoView({ behavior: "auto", block: "start" });
    root.style.scrollBehavior = rootBehavior;
    body.style.scrollBehavior = bodyBehavior;
  }

  function selectGroup(groupID: number) {
    const targetIndex = groups.findIndex((item) => item.id === groupID);
    if (targetIndex < 0) return;
    resetGroupTransientState();
    setActiveGroup(groupID);

    if (loopEnabled) {
      const rendered = [...loopSectionRefs.current.entries()]
        .filter(([virtual]) => groups[wrapLoopIndex(virtual, groups.length)]?.id === groupID)
        .sort(([a], [b]) => Math.abs(a - loopCenter) - Math.abs(b - loopCenter));
      const visibleTarget = rendered[0]?.[1];
      if (visibleTarget) {
        visibleTarget.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      loopPreserveRef.current = null;
      loopInitialPositionedRef.current = false;
      setLoopCenterVirtual(nearestLoopVirtual(loopCenter, targetIndex, groups.length));
      return;
    }

    if (settings.startWheelSwitchTabs) {
      const target = groupSectionRefs.current.get(groupID);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    window.scrollTo({ top: 0, behavior: "auto" });
  }

  useEffect(() => {
    if (!settings.startRememberLastTab) {
      try { window.localStorage.removeItem("knowme:start:last-group"); } catch { /* Private mode remains usable. */ }
      return;
    }
    if (activeGroup == null) return;
    try { window.localStorage.setItem("knowme:start:last-group", String(activeGroup)); } catch { /* Private mode remains usable. */ }
  }, [activeGroup, settings.startRememberLastTab]);

  useEffect(() => {
    if (!loopEnabled) {
      loopGroupsKeyRef.current = "";
      loopInitialPositionedRef.current = false;
      loopPreserveRef.current = null;
      loopSectionRefs.current.clear();
      if (loopCenterVirtual != null) setLoopCenterVirtual(null);
      return;
    }
    if (!loaded || activeGroup == null) return;

    const groupsChanged = loopGroupsKeyRef.current !== loopGroupsKey;
    if (groupsChanged) loopGroupsKeyRef.current = loopGroupsKey;
    if (loopCenterVirtual == null || groupsChanged) {
      const activeIndex = groups.findIndex((item) => item.id === activeGroup);
      loopPreserveRef.current = null;
      loopInitialPositionedRef.current = false;
      setLoopCenterVirtual(activeIndex >= 0 ? activeIndex : 0);
    }
  }, [activeGroup, groups, loaded, loopCenterVirtual, loopEnabled, loopGroupsKey]);

  useLayoutEffect(() => {
    if (!loopEnabled) return;

    const preserve = loopPreserveRef.current;
    if (preserve) {
      const node = loopSectionRefs.current.get(preserve.virtual);
      if (node) {
        const nextTop = node.getBoundingClientRect().top;
        scrollByImmediately(nextTop - preserve.top);
      }
      loopPreserveRef.current = null;
      return;
    }

    if (loopInitialPositionedRef.current) return;
    const target = loopSectionRefs.current.get(loopCenter);
    if (!target) return;
    loopInitialPositionedRef.current = true;
    scrollNodeImmediately(target);
  }, [loopCenter, loopEnabled, loopEntries]);

  useEffect(() => {
    if (!loopEnabled) return;

    const syncActiveGroup = () => {
      scrollSyncRAFRef.current = null;
      const anchor = Math.max(96, Math.min(window.innerHeight * 0.32, 320));
      let candidateVirtual: number | null = null;
      let candidateNode: HTMLElement | null = null;
      let nearest = Number.POSITIVE_INFINITY;

      const scrollingElement = document.scrollingElement ?? document.documentElement;
      const edgeVirtual = loopEdgeVirtual(
        loopCenter,
        window.scrollY,
        window.innerHeight,
        scrollingElement.scrollHeight
      );
      if (edgeVirtual != null) {
        const edgeNode = loopSectionRefs.current.get(edgeVirtual);
        if (edgeNode) {
          candidateVirtual = edgeVirtual;
          candidateNode = edgeNode;
        }
      }

      if (!candidateNode) for (const [virtual, node] of loopSectionRefs.current.entries()) {
        const rect = node.getBoundingClientRect();
        if (rect.top <= anchor && rect.bottom > anchor) {
          candidateVirtual = virtual;
          candidateNode = node;
          break;
        }
        const distance = Math.abs(rect.top - anchor);
        if (distance < nearest) {
          nearest = distance;
          candidateVirtual = virtual;
          candidateNode = node;
        }
      }

      if (candidateVirtual == null || !candidateNode) return;
      const candidateGroup = groups[wrapLoopIndex(candidateVirtual, groups.length)];
      if (candidateGroup && candidateGroup.id !== activeGroup) setActiveGroup(candidateGroup.id);

      if (candidateVirtual !== loopCenter && Math.abs(candidateVirtual - loopCenter) === 1) {
        loopPreserveRef.current = {
          virtual: candidateVirtual,
          top: candidateNode.getBoundingClientRect().top
        };
        setLoopCenterVirtual(candidateVirtual);
      }
    };

    const onScroll = () => {
      if (scrollSyncRAFRef.current != null) return;
      scrollSyncRAFRef.current = window.requestAnimationFrame(syncActiveGroup);
    };

    syncActiveGroup();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scrollSyncRAFRef.current != null) {
        window.cancelAnimationFrame(scrollSyncRAFRef.current);
        scrollSyncRAFRef.current = null;
      }
    };
  }, [activeGroup, groups, loopCenter, loopEnabled]);

  async function openItem(item: NavItem) {
    if (item.type === "folder") {
      setFolderSelectedIndex(0);
      setFolderHistory((current) => folder ? [...current, folder] : folderTrail(groups, item.id));
      setFolder(item);
      return;
    }
    if (!item.url) return;
    if (user) {
      void requestJSON("/api/navigation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "visit", data: { id: item.id } })
      }).catch(() => {});
    }
    if (openExternalBrowser(item.url)) return;
    if (item.browserLocal || item.extra?.openMode === "same_tab") {
      window.location.href = item.url;
      return;
    }
    window.open(item.url, "_blank", "noopener,noreferrer");
  }

  function showContextMenu(event: React.MouseEvent<HTMLElement>, item: NavItem | null = null) {
    const target = event.target;
    if (target instanceof Element && target.closest("input,textarea,select,[contenteditable=true]")) return;
    event.preventDefault();
    event.stopPropagation();
    setContextError("");
    setContextMenu({
      item,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 256)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - (item?.type === "folder" ? 310 : item?.parentId == null && item?.type === "link" ? 365 : 220)))
    });
  }

  async function changeFolderSize(item: NavItem, size: FolderSize) {
    if (!user || savingItem !== null) return;
    setContextMenu(null);
    setSavingItem(item.id);
    setContextError("");
    try {
      const result = await requestJSON<{ tree: { groups: NavGroup[] } }>("/api/navigation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update_item", data: { id: item.id, startFolderSize: size } })
      });
      const nextGroups = result.tree.groups;
      setGroups(nextGroups);
      if (folder) {
        const nextFolder = flattenItems(nextGroups).find(({ item: entry }) => entry.id === folder.id)?.item;
        if (nextFolder) setFolder(nextFolder);
      }
    } catch (reason) {
      setContextError("文件夹大小保存失败：" + (reason instanceof Error ? reason.message : "请求失败"));
    } finally {
      setSavingItem(null);
    }
  }

  async function changeShortcutSize(item: NavItem, size: NavItem["size"]) {
    if (!user || savingItem !== null || item.type !== "link" || item.parentId != null) return;
    setContextMenu(null);
    setContextError("");
    setSavingItem(item.id);
    try {
      const result = await requestJSON<{ tree: { groups: NavGroup[] } }>("/api/navigation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update_item", data: { id: item.id, size } })
      });
      setGroups(result.tree.groups);
    } catch (reason) {
      setContextError("图标大小保存失败：" + (reason instanceof Error ? reason.message : "请求失败"));
    } finally {
      setSavingItem(null);
    }
  }

  async function saveShortcutOrder(targetGroup: NavGroup, ordered: NavItem[]) {
    if (!user || sortBusy) return;
    setSortBusy(true);
    setContextError("");
    try {
      const ids = replaceLinkOrder(targetGroup.items ?? [], ordered);
      const result = await requestJSON<{ tree: { groups: NavGroup[] } }>("/api/navigation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reorder_items", data: { groupId: targetGroup.id, parentId: null, ids } })
      });
      setGroups(result.tree.groups);
    } catch (reason) {
      setContextError("排序保存失败：" + (reason instanceof Error ? reason.message : "请求失败"));
    } finally {
      setSortBusy(false);
    }
  }

  function quickSortShortcuts(targetGroup: NavGroup, mode: ShortcutSortMode) {
    sortMenuRef.current?.removeAttribute("open");
    if (!user || sortBusy) return;
    void saveShortcutOrder(targetGroup, quickSortStandaloneLinks(targetGroup.items ?? [], mode));
  }

  function onShortcutDrop(event: ReactDragEvent<HTMLButtonElement>, targetGroup: NavGroup, target: NavItem) {
    event.preventDefault();
    const sourceID = dragLinkID;
    setDragLinkID(null);
    setDragTargetID(null);
    lastDragAt.current = Date.now();
    if (!user || sortBusy || sourceID == null || sourceID === target.id) return;
    const ordered = moveStandaloneLink(targetGroup.items ?? [], sourceID, target.id);
    if (ordered) void saveShortcutOrder(targetGroup, ordered);
  }

  function copyLink(item: NavItem) {
    setContextMenu(null);
    void navigator.clipboard.writeText(item.url)
      .catch(() => setContextError("无法复制链接，请检查浏览器剪贴板权限"));
  }

  function searchWeb() {
    const value = query.trim();
    if (!value) return;
    setSearchFocused(false);
    const target = looksLikeURL(value) ? value : startSearchURL(activeEngine, value, engines);
    if (openExternalBrowser(target)) return;
    window.location.href = target;
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    if (selectedIndex >= 0 && searchMatches[selectedIndex]) {
      void openItem(searchMatches[selectedIndex].item);
      return;
    }
    searchWeb();
  }

  function chooseEngine(next: StartSearchEngine) {
    setActiveEngine(next);
    setEngineMenuOpen(false);
    setSelectedIndex(-1);
    try { window.localStorage.setItem("knowme:start:search-engine", next); } catch { /* Private mode remains usable. */ }
    searchRef.current?.focus();
    setSearchFocused(true);
  }

  function resetEnginePreference() {
    const next = isStartSearchEngine(settings.defaultSearchEngine, engines) ? settings.defaultSearchEngine : engines[0].id;
    setActiveEngine(next);
    setEngineMenuOpen(false);
    try { window.localStorage.removeItem("knowme:start:search-engine"); } catch { /* Browser storage may be unavailable. */ }
    searchRef.current?.focus();
  }

  const selectedEngine = engines.find((engine) => engine.id === activeEngine) ?? engines[0];

  const homeTags = (settings.socialLinks ?? []).filter((item) =>
    siteLinkAllowed(settings, item.url, item.visibility ?? (item.disabled ? "disabled" : "all"), Boolean(user))
  );

  function renderSearchShell(interactive = true) {
    return (
        <div className="km-start-search-shell" ref={interactive ? searchShellRef : undefined}>
          <form className="km-start-search" onSubmit={submitSearch} role="search">
            <div className="km-start-engine-anchor">
              <button
                type="button"
                className="km-start-engine-trigger"
                aria-label={"选择搜索引擎，当前：" + selectedEngine.name}
                aria-haspopup="menu"
                aria-expanded={interactive && engineMenuOpen}
                onClick={() => { setEngineMenuOpen((value) => !value); setSearchFocused(false); }}
              >
                <EngineBadge engine={selectedEngine} />
                <span className="km-start-engine-name">{selectedEngine.name}</span>
                <span className="km-start-engine-chevron" aria-hidden="true">⌄</span>
              </button>
              {interactive && engineMenuOpen ? (
                <div className="km-start-engine-menu" role="menu" aria-label="搜索引擎">
                  <p>选择搜索引擎</p>
                  {engines.map((engine) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={engine.id === activeEngine}
                      key={engine.id}
                      className={engine.id === activeEngine ? "is-current" : ""}
                      onClick={() => chooseEngine(engine.id)}
                    >
                      <EngineBadge engine={engine} />
                      <span>{engine.name}</span>
                      {engine.id === activeEngine ? <b aria-hidden="true">✓</b> : null}
                    </button>
                  ))}
                  <button type="button" className="km-start-engine-reset" onClick={resetEnginePreference}>恢复站点默认：{engines.find((item) => item.id === settings.defaultSearchEngine)?.name ?? engines[0].name}</button>
                  {user ? <a className="km-start-engine-manage" href="/admin/settings?section=start">管理搜索引擎 <span aria-hidden="true">⚙</span></a> : null}
                  <small>输入搜索内容后，按 Tab 快速切换</small>
                </div>
              ) : null}
            </div>
            <span className="km-start-search-divider" aria-hidden="true" />
            <input
              ref={interactive ? searchRef : undefined}
              value={query}
              aria-label="搜索网站和导航"
              aria-autocomplete="list"
              aria-controls="km-start-search-suggestions"
              aria-expanded={interactive && searchFocused && Boolean(query.trim()) && !engineMenuOpen}
              onFocus={() => { setSearchFocused(true); setEngineMenuOpen(false); }}
              onChange={(event) => { setQuery(event.target.value); setSearchFocused(true); }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.key === "Process") return;
                if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
                  event.preventDefault();
                  chooseEngine(nextStartSearchEngine(activeEngine, event.shiftKey ? -1 : 1, engines));
                } else if (event.key === "ArrowDown" && searchMatches.length) {
                  event.preventDefault();
                  setSelectedIndex((index) => (index + 1) % searchMatches.length);
                } else if (event.key === "ArrowUp" && searchMatches.length) {
                  event.preventDefault();
                  setSelectedIndex((index) => index <= 0 ? searchMatches.length - 1 : index - 1);
                } else if (event.key === "Enter" && (event.ctrlKey || event.altKey)) {
                  event.preventDefault();
                  searchWeb();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setEngineMenuOpen(false);
                  if (searchFocused) setSearchFocused(false);
                  else { setQuery(""); setSelectedIndex(-1); }
                }
              }}
              placeholder="搜索网址、导航或输入关键词…"
              autoComplete="off"
            />
            <div className="km-start-search-actions">
              {query ? (
                <button className="km-start-search-clear" type="button" title="清除搜索内容" aria-label="清除搜索内容" onClick={() => { setQuery(""); setSelectedIndex(-1); searchRef.current?.focus(); }}>×</button>
              ) : <kbd>/</kbd>}
              <button type="submit" className="km-start-search-submit" title={"使用 " + selectedEngine.name + " 搜索"} aria-label={"使用 " + selectedEngine.name + " 搜索"} onClick={(event) => { if (event.detail > 0) { event.preventDefault(); searchWeb(); } }}>搜索 <span aria-hidden="true">↗</span></button>
            </div>
          </form>
          {interactive && searchFocused && query.trim() && !engineMenuOpen ? (
            <div id="km-start-search-suggestions" className="km-start-search-suggestions" role="listbox" aria-label="搜索建议">
              <button type="button" className="km-start-suggestion-web" onClick={searchWeb}>
                <EngineBadge engine={selectedEngine} />
                <span className="km-start-suggestion-copy"><strong>使用 {selectedEngine.name} 搜索</strong><small>{query.trim()}</small></span>
                <span aria-hidden="true">↗</span>
              </button>
              {matches.length ? (
                <>
                  <div className="km-start-suggestion-heading"><span>站内导航</span><small>{matches.length} 个匹配 · ↑↓ 选择</small></div>
                  {searchMatches.map(({ item, group: groupName, folder: parent }, index) => (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={index === selectedIndex}
                      className={"km-start-suggestion-item" + (index === selectedIndex ? " is-selected" : "")}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => { setSearchFocused(false); void openItem(item); }}
                    >
                      <span className="km-start-suggestion-icon">{icon(item)}</span>
                      <span className="km-start-suggestion-copy"><strong>{item.name}</strong><small>{[groupName, parent].filter(Boolean).join(" / ")}{item.url ? " · " + item.url : ""}</small></span>
                      <span aria-hidden="true">{item.type === "folder" ? "›" : "↗"}</span>
                    </button>
                  ))}
                </>
              ) : <p className="km-start-suggestion-empty">没有匹配的站内导航，可以直接搜索网页</p>}
              <footer><span><kbd>Tab</kbd> 切换引擎</span><span><kbd>Enter</kbd> 搜索 · <kbd>Esc</kbd> 收起</span></footer>
            </div>
          ) : null}
          {homeTags.length ? (
            <div className="km-start-home-tags" aria-label="主页快捷标签">
              {homeTags.map((item) => {
                const href = safeHref(item.url);
                return <a key={item.id} href={href} target={isExternal(href) ? "_blank" : undefined} rel={isExternal(href) ? "noreferrer" : undefined}>{item.label}</a>;
              })}
            </div>
          ) : null}
        </div>
    );
  }

  function renderGroupPage(displayGroup: NavGroup, options: { active?: boolean; trackSection?: boolean; instanceKey?: string } = {}) {
    const groupIsActive = options.active ?? displayGroup.id === group?.id;
    const instanceSuffix = options.instanceKey ? "-" + options.instanceKey : "";
    const quickTitleID = "km-start-quick-title-" + displayGroup.id + instanceSuffix;
    return (
      <main className="km-start-main km-start-group-page" ref={options.trackSection === false ? undefined : (node) => setGroupSectionRef(displayGroup.id, node)} data-start-group={displayGroup.id}>
        <header className="km-start-top">
          <div>
            <span className="km-eyebrow">我的工作台</span>
            <h1>{displayGroup.name || "我的导航"}</h1>
          </div>
          <a href="/">返回个人主页 <span aria-hidden="true">↗</span></a>
        </header>

        {!loopEnabled ? renderSearchShell(groupIsActive) : null}

        {contextError ? <div className="dk-message is-danger km-start-context-error" role="alert">{contextError}</div> : null}
        <div className="km-start-sections">
            {(displayGroup.items ?? []).filter((item) => item.type === "folder").map((item) => {
              const children = item.children ?? [];
              const size = folderSize(item);
              const capacity = previewCapacity(size, viewportWidth);
              const preview = children.slice(0, children.length > capacity ? capacity - 1 : capacity);
              const remaining = children.length - preview.length;
              return (
                <section className={"km-start-folder-section is-" + size} key={item.id} aria-label={item.name} onContextMenu={(event) => showContextMenu(event, item)}>
                  <header className="km-start-folder-section-head">
                    <button type="button" className="km-start-folder-title" onClick={() => void openItem(item)} title={"打开 " + item.name}>
                      <span className="km-start-folder-symbol" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6.5a2 2 0 0 1 2-2h4.2l2.1 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        </svg>
                      </span>
                      <span className="km-start-folder-label">
                        <strong>{item.name}</strong>
                        <small>{children.length} 个项目 · 点击标题打开文件夹</small>
                      </span>
                    </button>
                    <button type="button" className="km-start-folder-open" onClick={() => void openItem(item)}>
                      打开文件夹 <span aria-hidden="true">↗</span>
                    </button>
                  </header>
                  {children.length ? (
                    <div className="km-start-folder-links">
                      {preview.map((child) => (
                        <button
                          type="button"
                          key={child.id}
                          className={"km-start-folder-link" + (child.type === "folder" ? " is-folder" : "")}
                          onClick={() => void openItem(child)}
                          onContextMenu={(event) => showContextMenu(event, child)}
                          style={child.backgroundColor ? { "--km-card-accent": child.backgroundColor } as CSSProperties : undefined}
                          title={child.type === "folder" ? "打开文件夹：" + child.name : child.name}
                        >
                          <span className="km-start-icon">{icon(child)}</span>
                          <span className="km-start-folder-link-name">{child.name}</span>
                          {child.type === "folder" ? <span className="km-start-folder-nested" aria-label="子文件夹">›</span> : null}
                        </button>
                      ))}
                      {remaining > 0 ? (
                        <button type="button" className="km-start-folder-more" onClick={() => void openItem(item)}>
                          <span>+{remaining}</span>
                          <small>查看全部</small>
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <button type="button" className="km-start-folder-empty" onClick={() => void openItem(item)}>文件夹暂无内容 · 打开查看</button>
                  )}
                </section>
              );
            })}
            {(displayGroup.items ?? []).some((item) => item.type !== "folder") ? (
              <section className="km-start-quick-section" aria-labelledby={quickTitleID}>
                <header className="km-start-section-head">
                  <div>
                    <h2 id={quickTitleID}>快捷访问</h2>
                    <p>{user ? "拖动卡片调整顺序 · 右键修改大小" : "点击图标直接打开网站 · 登录后可调整布局"}</p>
                  </div>
                  <div className="km-start-quick-head-actions">
                    <span>{(displayGroup.items ?? []).filter((item) => item.type !== "folder").length} 个快捷入口</span>
                    <details className="km-start-sort-menu" ref={groupIsActive ? sortMenuRef : undefined}>
                      <summary aria-label="快捷排序" aria-haspopup="menu">快捷排序 <span aria-hidden="true">⌄</span></summary>
                      <div className="km-start-sort-options" role="group" aria-label="快捷排序方式">
                        <button type="button" disabled={!user || sortBusy} onClick={() => quickSortShortcuts(displayGroup, "name")}>按名称排序 A–Z</button>
                        <button type="button" disabled={!user || sortBusy} onClick={() => quickSortShortcuts(displayGroup, "visits")}>按访问次数排序</button>
                        <button type="button" disabled={!user || sortBusy} onClick={() => quickSortShortcuts(displayGroup, "reverse")}>反转当前顺序</button>
                        {!user ? <a href="/login?next=%2Fstart">登录后可保存排序</a> : <small>排序结果自动保存</small>}
                      </div>
                    </details>
                  </div>
                </header>
                <div className="km-start-grid km-start-quick-grid">
                  {(displayGroup.items ?? []).filter((item) => item.type !== "folder").map((item) => (
                    <button
                      key={item.id}
                      className={"km-start-card size-" + item.size
                        + (dragLinkID === item.id ? " is-dragging" : "")
                        + (dragTargetID === item.id ? " is-drop-target" : "")}
                      type="button"
                      draggable={Boolean(user) && !sortBusy}
                      onDragStart={(event) => {
                        if (!user) return;
                        setDragLinkID(item.id);
                        setDragTargetID(null);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", String(item.id));
                      }}
                      onDragOver={(event) => {
                        if (dragLinkID == null || !user || sortBusy) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDragTargetID(item.id);
                      }}
                      onDragLeave={() => setDragTargetID((current) => current === item.id ? null : current)}
                      onDrop={(event) => onShortcutDrop(event, displayGroup, item)}
                      onDragEnd={() => { setDragLinkID(null); setDragTargetID(null); lastDragAt.current = Date.now(); }}
                      onClick={() => { if (Date.now() - lastDragAt.current > 250) void openItem(item); }}
                      onContextMenu={(event) => showContextMenu(event, item)}
                      style={item.backgroundColor ? { "--km-card-accent": item.backgroundColor } as CSSProperties : undefined}
                      title={item.name}
                    >
                      <span className="km-start-icon">{icon(item)}</span>
                      <span className="km-start-card-copy">
                        <strong>{item.name}</strong>
                        <small>{item.browserLocal ? "浏览器本地" : item.url}</small>
                      </span>
                      <b aria-hidden="true">↗</b>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

          </div>

        {!(displayGroup.items ?? []).length ? <section className="km-panel km-empty">这个分组还没有导航项。</section> : null}
      </main>
    );
  }

  const startBackground = safeHref(settings.startBackgroundUrl);
  const style = {
    "--km-start-card-alpha": String(Math.max(30, Math.min(95, settings.startCardOpacity)) / 100),
    "--km-start-radius": Math.max(12, Math.min(32, settings.startCardRadius)) + "px",
    "--km-start-dim": String(Math.max(0, Math.min(90, settings.startBackgroundDim)) / 100),
    ...(settings.startBackgroundUrl && startBackground !== "#" ? { backgroundImage: `linear-gradient(rgba(5,10,20,var(--km-start-dim)), rgba(5,10,20,var(--km-start-dim))), url("${startBackground.replace(/"/g, "%22")}")` } : {})
  } as CSSProperties;

  if (!loaded) {
    return <PageFrame settings={settings} user={user}><LoadingCard text="正在加载起始页…" /></PageFrame>;
  }
  if (error) {
    return <PageFrame settings={settings} user={user}><ErrorCard message={error} retryLabel="重新加载" onRetry={() => window.location.reload()} /></PageFrame>;
  }
  if (!user && !settings.startPublic) {
    return (
      <PageFrame settings={settings} user={user}>
        <section className="km-panel km-empty km-start-private">
          <span className="km-eyebrow">PRIVATE START</span>
          <h1>这个起始页是私有的</h1>
          <p>登录后可以访问完整导航和浏览器本地链接。</p>
          <a className="dk-button dk-button-primary" href="/login?next=%2Fstart">登录后继续</a>
        </section>
      </PageFrame>
    );
  }

  return (
    <div className={"km-start-page is-" + settings.startDensity} style={style} onContextMenu={(event) => showContextMenu(event)}>
      <aside className="km-start-rail">
        <a className="km-start-logo" href="/">K</a>
        <nav>
          {groups.map((item) => (
            <button key={item.id} className={item.id === group?.id ? "is-active" : ""} onClick={() => selectGroup(item.id)} title={item.name}>
              <span aria-hidden="true">{groupMark(item)}</span><small>{item.name}</small>
            </button>
          ))}
        </nav>
        <a className="km-start-admin" href={user ? "/admin/navigation" : "/login?next=%2Fstart"}>{user ? "管理" : "登录"}</a>
      </aside>

      <div className="km-start-content">
        {loopEnabled ? (
          <div className="km-start-sticky-search">
            <div className="km-start-sticky-search-inner">{renderSearchShell(true)}</div>
          </div>
        ) : null}
        <div className={"km-start-stack" + (settings.startWheelSwitchTabs ? " is-continuous" : " is-single") + (loopEnabled ? " is-loop" : "")}>
        {loopEnabled ? loopEntries.map(({ virtual, item }) => (
          <div
            className="km-start-stack-item"
            key={virtual}
            ref={(node) => setLoopSectionRef(virtual, node)}
            data-start-virtual={virtual}
          >
            {renderGroupPage(item, {
              active: virtual === loopCenter,
              trackSection: false,
              instanceKey: String(virtual)
            })}
          </div>
        )) : (settings.startWheelSwitchTabs ? groups : (group ? [group] : [])).map((item) => (
          <div className="km-start-stack-item" key={item.id}>
            {renderGroupPage(item)}
          </div>
        ))}
        </div>
      </div>

      {folder ? (
        <div className="km-modal-backdrop" onMouseDown={() => { setFolder(null); setFolderHistory([]); setFolderSelectedIndex(0); }}>
          <section className="km-panel km-folder-modal" role="dialog" aria-modal="true" aria-labelledby="km-folder-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="km-eyebrow">FOLDER</span>
                <h2 id="km-folder-title">{folder.name}</h2>
                {folderHistory.length ? <small>{folderHistory.map((item) => item.name).join(" / ")} / {folder.name}</small> : null}
              </div>
              <div className="km-folder-head-actions">
                {folderHistory.length ? (
                  <button type="button" className="is-back" aria-label="返回上一级文件夹" title="返回上一级" onClick={() => {
                    const parent = folderHistory[folderHistory.length - 1];
                    setFolder(parent ?? null);
                    setFolderHistory((current) => current.slice(0, -1));
                    setFolderSelectedIndex(0);
                  }}>←</button>
                ) : null}
                <button type="button" aria-label="关闭文件夹" title="关闭" onClick={() => { setFolder(null); setFolderHistory([]); setFolderSelectedIndex(0); }}>×</button>
              </div>
            </header>
            <div className="km-folder-grid">
              {(folder.children ?? []).map((item, index) => (
                <button
                  key={item.id}
                  autoFocus={index === 0}
                  className={(index === folderSelectedIndex ? "is-selected" : "") + (item.type === "folder" ? " is-folder" : "")}
                  aria-current={index === folderSelectedIndex ? "true" : undefined}
                  style={item.backgroundColor ? { "--km-card-accent": item.backgroundColor } as CSSProperties : undefined}
                  onFocus={() => setFolderSelectedIndex(index)}
                  onMouseEnter={() => setFolderSelectedIndex(index)}
                  onClick={() => void openItem(item)}
                  onContextMenu={(event) => showContextMenu(event, item)}
                >
                  <span className="km-start-icon">{icon(item)}</span>
                  <strong>{item.name}</strong>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
      {contextMenu ? (
        <div
          className="km-start-context-menu"
          role="menu"
          aria-label={contextMenu.item ? contextMenu.item.name + " 的快捷菜单" : "Start 快捷菜单"}
          ref={contextMenuRef}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); setContextMenu(null); return; }
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            const enabled = Array.from(contextMenuRef.current?.querySelectorAll<HTMLElement>(
              '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])'
            ) ?? []);
            if (!enabled.length) return;
            const current = enabled.indexOf(document.activeElement as HTMLElement);
            const next = (current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
            event.preventDefault();
            enabled[next].focus();
          }}
        >
          {contextMenu.item ? (
            <>
              <strong className="km-start-context-caption">{contextMenu.item.name}</strong>
              <button type="button" role="menuitem" onClick={() => { const target = contextMenu.item; setContextMenu(null); if (target) void openItem(target); }}>
                {contextMenu.item.type === "folder" ? "打开文件夹" : "打开链接"} <span aria-hidden="true">↗</span>
              </button>
              {contextMenu.item.type === "folder" ? (
                <>
                  <div className="km-start-context-divider" role="separator" />
                  <span className="km-start-context-label">文件夹大小</span>
                  {([
                    ["small", "小 · 半宽单排"],
                    ["medium", "中 · 通栏单排"],
                    ["large", "大 · 通栏双排"]
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={folderSize(contextMenu.item!) === value}
                      disabled={!user || savingItem !== null}
                      onClick={() => void changeFolderSize(contextMenu.item!, value)}
                    ><span>{label}</span><span aria-hidden="true">{folderSize(contextMenu.item!) === value ? "✓" : ""}</span></button>
                  ))}
                  {!user ? <small className="km-start-context-note">登录后可修改并保存尺寸</small> : null}
                </>
              ) : (
                <>
                  {contextMenu.item.parentId == null ? (
                    <>
                      <div className="km-start-context-divider" role="separator" />
                      <span className="km-start-context-label">图标大小</span>
                      {([
                        ["1x1", "小 · 1×1"],
                        ["2x1", "中 · 2×1"],
                        ["2x2", "大 · 2×2"]
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          role="menuitemradio"
                          aria-checked={contextMenu.item!.size === value}
                          disabled={!user || savingItem !== null}
                          onClick={() => void changeShortcutSize(contextMenu.item!, value)}
                        ><span>{label}</span><span aria-hidden="true">{contextMenu.item!.size === value ? "✓" : ""}</span></button>
                      ))}
                      {!user ? <small className="km-start-context-note">登录后可修改并保存大小</small> : null}
                    </>
                  ) : null}
                  <div className="km-start-context-divider" role="separator" />
                  <button type="button" role="menuitem" onClick={() => copyLink(contextMenu.item!)}>复制链接</button>
                </>
              )}
              <div className="km-start-context-divider" role="separator" />
              {user ? <a role="menuitem" href={"/admin/navigation?editItem=" + contextMenu.item.id}>编辑导航</a>
                : <a role="menuitem" href="/login?next=%2Fstart">登录后编辑</a>}
            </>
          ) : (
            <>
              <strong className="km-start-context-caption">Start</strong>
              <button type="button" role="menuitem" onClick={() => window.location.reload()}>刷新导航</button>
              <a role="menuitem" href={user ? "/admin/navigation" : "/login?next=%2Fstart"}>{user ? "管理导航" : "登录后管理"}</a>
              <a role="menuitem" href="/">返回个人主页</a>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
