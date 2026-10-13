import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from "react";
import { requestJSON } from "../api";
import { openExternalBrowser } from "../external-links";
import { replaceLinkOrder, quickSortStandaloneLinks, moveStandaloneLink, type ShortcutSortMode } from "../start-shortcut-order";
import type { NavGroup, NavItem, SessionUser, SiteSettings } from "../types";
import { ErrorCard, LoadingCard, PageFrame, safeHref } from "../ui";

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

function searchURL(engine: SiteSettings["defaultSearchEngine"], query: string) {
  const q = encodeURIComponent(query);
  if (engine === "Google") return "https://www.google.com/search?q=" + q;
  if (engine === "DuckDuckGo") return "https://duckduckgo.com/?q=" + q;
  return "https://www.bing.com/search?q=" + q;
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

function icon(item: NavItem) {
  if (item.type === "folder") {
    return <svg className="km-start-folder-mini-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6.5a2 2 0 0 1 2-2h4.2l2.1 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
  }
  if (item.iconUrl && (/^https?:\/\//i.test(item.iconUrl) || item.iconUrl.startsWith("/media/"))) {
    return <img src={item.iconUrl} alt="" loading="lazy" />;
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

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
    if (!user && !settings.startPublic) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    const endpoint = user ? "/api/navigation" : "/api/navigation/public";
    void requestJSON<{ groups: NavGroup[] }>(endpoint)
      .then((payload) => {
        const nextGroups = payload.groups ?? [];
        setGroups(nextGroups);
        setActiveGroup((current) => current && nextGroups.some((item) => item.id === current) ? current : nextGroups[0]?.id ?? null);
        setLoaded(true);
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "navigation_failed");
        setLoaded(true);
      });
  }, [settings.startPublic, user]);

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

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable);

      if (event.key === "Escape" && contextMenu) {
        event.preventDefault();
        setContextMenu(null);
        return;
      }

      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
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

  async function saveShortcutOrder(ordered: NavItem[]) {
    if (!user || !group || sortBusy) return;
    setSortBusy(true);
    setContextError("");
    try {
      const ids = replaceLinkOrder(group.items ?? [], ordered);
      const result = await requestJSON<{ tree: { groups: NavGroup[] } }>("/api/navigation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reorder_items", data: { groupId: group.id, parentId: null, ids } })
      });
      setGroups(result.tree.groups);
    } catch (reason) {
      setContextError("排序保存失败：" + (reason instanceof Error ? reason.message : "请求失败"));
    } finally {
      setSortBusy(false);
    }
  }

  function quickSortShortcuts(mode: ShortcutSortMode) {
    sortMenuRef.current?.removeAttribute("open");
    if (!group || !user || sortBusy) return;
    void saveShortcutOrder(quickSortStandaloneLinks(group.items ?? [], mode));
  }

  function onShortcutDrop(event: ReactDragEvent<HTMLButtonElement>, target: NavItem) {
    event.preventDefault();
    const sourceID = dragLinkID;
    setDragLinkID(null);
    setDragTargetID(null);
    lastDragAt.current = Date.now();
    if (!group || !user || sortBusy || sourceID == null || sourceID === target.id) return;
    const ordered = moveStandaloneLink(group.items ?? [], sourceID, target.id);
    if (ordered) void saveShortcutOrder(ordered);
  }

  function copyLink(item: NavItem) {
    setContextMenu(null);
    void navigator.clipboard.writeText(item.url)
      .catch(() => setContextError("无法复制链接，请检查浏览器剪贴板权限"));
  }

  function searchWeb() {
    const value = query.trim();
    if (!value) return;
    const target = looksLikeURL(value) ? value : searchURL(settings.defaultSearchEngine, value);
    if (openExternalBrowser(target)) return;
    window.location.href = target;
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    if (matches.length) {
      const match = matches[Math.max(0, Math.min(selectedIndex, matches.length - 1))];
      if (match) void openItem(match.item);
      return;
    }
    searchWeb();
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

  const visibleEntries: Array<{ item: NavItem; meta?: FlatItem; selected?: boolean }> = query.trim()
    ? matches.map((match, index) => ({ item: match.item, meta: match, selected: index === selectedIndex }))
    : (group?.items ?? []).map((item) => ({ item }));

  return (
    <div className={"km-start-page is-" + settings.startDensity} style={style} onContextMenu={(event) => showContextMenu(event)}>
      <aside className="km-start-rail">
        <a className="km-start-logo" href="/">K</a>
        <nav>
          {groups.map((item) => (
            <button key={item.id} className={item.id === group?.id ? "is-active" : ""} onClick={() => { setActiveGroup(item.id); setQuery(""); setFolder(null); setFolderHistory([]); }} title={item.name}>
              <span aria-hidden="true">{groupMark(item)}</span><small>{item.name}</small>
            </button>
          ))}
        </nav>
        <a className="km-start-admin" href={user ? "/admin/navigation" : "/login?next=%2Fstart"}>{user ? "管理" : "登录"}</a>
      </aside>

      <main className="km-start-main">
        <header className="km-start-top">
          <div>
            <span className="km-eyebrow">{query ? "搜索导航" : "我的工作台"}</span>
            <h1>{query ? "全局搜索" : group?.name || "我的导航"}</h1>
          </div>
          <a href="/">返回个人主页 <span aria-hidden="true">↗</span></a>
        </header>

        <form className="km-start-search" onSubmit={submitSearch}>
          <span>⌕</span>
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && matches.length) {
                event.preventDefault();
                setSelectedIndex((value) => (value + 1) % matches.length);
              } else if (event.key === "ArrowUp" && matches.length) {
                event.preventDefault();
                setSelectedIndex((value) => (value - 1 + matches.length) % matches.length);
              } else if (event.key === "Enter" && (event.ctrlKey || event.altKey)) {
                event.preventDefault();
                searchWeb();
              }
            }}
            placeholder={"搜索所有导航，或使用 " + settings.defaultSearchEngine}
            autoComplete="off"
          />
          {query ? (
            <div className="km-start-search-actions">
              <button type="button" onClick={searchWeb}>{settings.defaultSearchEngine}</button>
              <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }}>清除</button>
            </div>
          ) : <kbd>/</kbd>}
        </form>

        {query ? (
          <p className="km-start-result-hint">
            {matches.length
              ? `找到 ${matches.length} 个导航项 · ↑↓ 选择 · Enter 打开 · Ctrl/Alt+Enter 使用 ${settings.defaultSearchEngine}`
              : `没有导航匹配 · Enter 使用 ${settings.defaultSearchEngine}`}
          </p>
        ) : null}

        {contextError ? <div className="dk-message is-danger km-start-context-error" role="alert">{contextError}</div> : null}
        {query.trim() ? (
          <section className="km-start-grid km-start-search-grid" aria-label="搜索结果">
            {visibleEntries.map(({ item, meta, selected }) => (
              <button
                key={item.id}
                className={"km-start-card size-" + item.size + (selected ? " is-selected" : "")}
                type="button"
                onClick={() => void openItem(item)}
                onContextMenu={(event) => showContextMenu(event, item)}
                style={item.backgroundColor ? { "--km-card-accent": item.backgroundColor } as CSSProperties : undefined}
              >
                <span className="km-start-icon">{icon(item)}</span>
                <span className="km-start-card-copy">
                  <strong>{item.name}</strong>
                  <small>{[meta?.group, meta?.folder].filter(Boolean).join(" / ") + (item.url ? " · " + item.url : "")}</small>
                </span>
                <b aria-hidden="true">{item.type === "folder" ? "›" : "↗"}</b>
              </button>
            ))}
          </section>
        ) : (
          <div className="km-start-sections">
            {(group?.items ?? []).filter((item) => item.type === "folder").map((item) => {
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
            {(group?.items ?? []).some((item) => item.type !== "folder") ? (
              <section className="km-start-quick-section" aria-labelledby="km-start-quick-title">
                <header className="km-start-section-head">
                  <div>
                    <h2 id="km-start-quick-title">快捷访问</h2>
                    <p>{user ? "拖动卡片调整顺序 · 右键修改大小" : "点击图标直接打开网站 · 登录后可调整布局"}</p>
                  </div>
                  <div className="km-start-quick-head-actions">
                    <span>{(group?.items ?? []).filter((item) => item.type !== "folder").length} 个快捷入口</span>
                    <details className="km-start-sort-menu" ref={sortMenuRef}>
                      <summary aria-label="快捷排序" aria-haspopup="menu">快捷排序 <span aria-hidden="true">⌄</span></summary>
                      <div className="km-start-sort-options" role="group" aria-label="快捷排序方式">
                        <button type="button" disabled={!user || sortBusy} onClick={() => quickSortShortcuts("name")}>按名称排序 A–Z</button>
                        <button type="button" disabled={!user || sortBusy} onClick={() => quickSortShortcuts("visits")}>按访问次数排序</button>
                        <button type="button" disabled={!user || sortBusy} onClick={() => quickSortShortcuts("reverse")}>反转当前顺序</button>
                        {!user ? <a href="/login?next=%2Fstart">登录后可保存排序</a> : <small>排序结果自动保存</small>}
                      </div>
                    </details>
                  </div>
                </header>
                <div className="km-start-grid km-start-quick-grid">
                  {(group?.items ?? []).filter((item) => item.type !== "folder").map((item) => (
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
                      onDrop={(event) => onShortcutDrop(event, item)}
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
        )}

        {!visibleEntries.length && !query ? <section className="km-panel km-empty">这个分组还没有导航项。</section> : null}
      </main>

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
