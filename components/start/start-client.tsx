"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LiveClock } from "@/components/live-clock";
import type { NavGroup, NavItem, NavigationTree } from "@/lib/navigation/types";
import type { StartDensity } from "@/lib/settings/repository";

const groupMarks: Record<string, string> = {
  home: "⌂",
  code: "</>",
  read: "文",
  app: "◇",
  entertainment: "游",
  office: "工",
  tool: "⌘"
};

const engines = {
  Bing: "https://www.bing.com/search?q=",
  Google: "https://www.google.com/search?q=",
  DuckDuckGo: "https://duckduckgo.com/?q="
} as const;

type SearchEntry = {
  item: NavItem;
  group: NavGroup;
  parent: NavItem | null;
};

type ContextMenuState = {
  x: number;
  y: number;
  item: NavItem;
} | null;

function groupMark(group: NavGroup) {
  return groupMarks[group.icon] ?? group.icon?.slice(0, 2) ?? group.name.slice(0, 1);
}

function tileMark(item: NavItem) {
  if (item.iconText) return item.iconText.slice(0, 6);
  if (item.name) return item.name.slice(0, 2);
  return "↗";
}

function contrastText(background: string) {
  const value = background.trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match) return "#ffffff";
  const hex = match[1].length === 3 ? match[1].split("").map((ch) => ch + ch).join("") : match[1];
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.68 ? "#172033" : "#ffffff";
}

function isNavigable(url: string) {
  return /^(https?:|about:|chrome:|moz-extension:|chrome-extension:|edge:|file:)/i.test(url);
}

function isWebUrl(url: string) {
  return /^https?:/i.test(url);
}

function safeIconUrl(url: string) {
  const value = url.trim();
  if (/^https?:\/\//i.test(value) || value.startsWith("/media/")) return value;
  return "";
}

function faviconUrl(url: string) {
  if (!isWebUrl(url)) return "";
  try {
    const parsed = new URL(url);
    return parsed.origin + "/favicon.ico";
  } catch {
    return "";
  }
}

function flattenNavigation(groups: NavGroup[]): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const visit = (items: NavItem[], group: NavGroup, parent: NavItem | null) => {
    for (const item of items) {
      entries.push({ item, group, parent });
      if (item.children.length) visit(item.children, group, item);
    }
  };
  for (const group of groups) visit(group.items, group, null);
  return entries;
}

function searchScore(entry: SearchEntry, query: string) {
  const name = entry.item.name.toLocaleLowerCase();
  const url = entry.item.url.toLocaleLowerCase();
  const group = entry.group.name.toLocaleLowerCase();
  const parent = entry.parent?.name.toLocaleLowerCase() ?? "";

  let score = 0;
  if (name === query) score += 100;
  else if (name.startsWith(query)) score += 70;
  else if (name.includes(query)) score += 50;
  if (url.includes(query)) score += 24;
  if (group.includes(query)) score += 16;
  if (parent.includes(query)) score += 12;
  score += Math.min(entry.item.visitCount, 30) / 10;
  return score;
}

function NavIcon({ item, compact = false }: { item: NavItem; compact?: boolean }) {
  const fallbackFavicon = faviconUrl(item.url);
  const preferredIcon = safeIconUrl(item.iconUrl);
  const [source, setSource] = useState(preferredIcon || fallbackFavicon);

  useEffect(() => {
    setSource(preferredIcon || fallbackFavicon);
  }, [item.id, preferredIcon, fallbackFavicon]);

  if (!source) {
    return <span className={compact ? "tile-mark tile-mark--compact" : "tile-mark"}>{tileMark(item)}</span>;
  }

  return (
    <span className={compact ? "tile-icon-image tile-icon-image--compact" : "tile-icon-image"}>
      <img
        src={source}
        alt=""
        loading="lazy"
        onError={() => {
          if (source !== fallbackFavicon && fallbackFavicon) setSource(fallbackFavicon);
          else setSource("");
        }}
      />
    </span>
  );
}

function FolderPreview({ item }: { item: NavItem }) {
  const children = item.children.slice(0, 4);
  return (
    <span className="folder-preview folder-preview--real" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => {
        const child = children[index];
        return child ? (
          <span className="folder-preview-cell" key={child.id}>
            <NavIcon item={child} compact />
          </span>
        ) : (
          <i key={"empty-" + index} />
        );
      })}
    </span>
  );
}

export function StartClient({
  initialTree,
  defaultEngine = "Bing",
  authenticated = true,
  density = "comfortable"
}: {
  initialTree: NavigationTree;
  defaultEngine?: keyof typeof engines;
  authenticated?: boolean;
  density?: StartDensity;
}) {
  const [activeGroupId, setActiveGroupId] = useState(initialTree.groups[0]?.id ?? 0);
  const [folder, setFolder] = useState<NavItem | null>(null);
  const [query, setQuery] = useState("");
  const [engine, setEngine] = useState<keyof typeof engines>(defaultEngine);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [toast, setToast] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const activeGroup = initialTree.groups.find((group) => group.id === activeGroupId) ?? initialTree.groups[0];
  const allEntries = useMemo(() => flattenNavigation(initialTree.groups), [initialTree.groups]);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return allEntries
      .map((entry) => ({ entry, score: searchScore(entry, normalizedQuery) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.item.visitCount - a.entry.item.visitCount)
      .slice(0, 80)
      .map((result) => result.entry);
  }, [allEntries, normalizedQuery]);

  const visibleEntries = normalizedQuery
    ? searchResults
    : (activeGroup?.items ?? []).map((item) => ({ item, group: activeGroup!, parent: null }));

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (!editing && event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === "Escape") {
        if (contextMenu) {
          setContextMenu(null);
        } else if (folder) {
          setFolder(null);
        } else if (query) {
          setQuery("");
          searchInputRef.current?.focus();
        }
        return;
      }

      if (event.altKey && /^[1-9]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        const group = initialTree.groups[index];
        if (group) {
          event.preventDefault();
          setActiveGroupId(group.id);
          setQuery("");
          setFolder(null);
        }
      }
    }

    function closeContextMenu() {
      setContextMenu(null);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("pointerdown", closeContextMenu);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("pointerdown", closeContextMenu);
    };
  }, [contextMenu, folder, initialTree.groups, query]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function recordVisit(item: NavItem) {
    if (!authenticated) return;
    void fetch("/api/navigation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "visit", data: { id: item.id } })
    });
  }

  function openItem(item: NavItem, currentTab = false) {
    if (!item.url || !isNavigable(item.url)) return;
    recordVisit(item);

    if (item.browserLocal) {
      setToast("这是浏览器内部地址；如果网页无法直接打开，可以右键复制后粘贴到地址栏。");
    }

    if (currentTab && isWebUrl(item.url)) {
      window.location.assign(item.url);
      return;
    }

    window.open(item.url, "_blank", "noopener,noreferrer");
  }

  function activate(item: NavItem) {
    setContextMenu(null);
    if (item.type === "folder") {
      setFolder(item);
      return;
    }
    openItem(item);
  }

  async function copyUrl(item: NavItem) {
    if (!item.url) return;
    try {
      await navigator.clipboard.writeText(item.url);
      setToast("地址已复制");
    } catch {
      window.prompt("复制地址", item.url);
    }
    setContextMenu(null);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;

    const exact = searchResults.find(
      ({ item }) => item.name.toLocaleLowerCase() === value.toLocaleLowerCase()
    );
    if (exact) return activate(exact.item);

    if (/^https?:\/\//i.test(value)) {
      window.open(value, "_blank", "noopener,noreferrer");
      return;
    }
    if (!value.includes(" ") && value.includes(".")) {
      window.open("https://" + value, "_blank", "noopener,noreferrer");
      return;
    }
    window.open(engines[engine] + encodeURIComponent(value), "_blank", "noopener,noreferrer");
  }

  function openContextMenu(event: React.MouseEvent, item: NavItem) {
    event.preventDefault();
    event.stopPropagation();
    const width = 220;
    const height = item.type === "folder" ? 112 : 188;
    const x = Math.min(event.clientX, window.innerWidth - width - 12);
    const y = Math.min(event.clientY, window.innerHeight - height - 12);
    setContextMenu({ x: Math.max(12, x), y: Math.max(12, y), item });
  }

  return (
    <>
      <aside className="glass-card start-rail" aria-label="导航分组">
        {initialTree.groups.map((group, index) => (
          <button
            key={group.id}
            className={group.id === activeGroup?.id && !normalizedQuery ? "is-active" : ""}
            type="button"
            title={group.name + (index < 9 ? " · Alt+" + (index + 1) : "")}
            aria-label={group.name}
            onClick={() => {
              setActiveGroupId(group.id);
              setQuery("");
              setFolder(null);
            }}
          >
            {groupMark(group)}
          </button>
        ))}
        {authenticated ? (
          <Link className="start-rail-admin" href="/admin/navigation" title="管理导航">⚙</Link>
        ) : (
          <Link className="start-rail-admin" href="/login?next=%2Fstart" title="登录">⇥</Link>
        )}
      </aside>

      <section className="start-content">
        <div className="start-hero">
          <LiveClock compact />
          <form className="glass-card search-box" onSubmit={submitSearch}>
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索全部导航，或输入网址 / 关键词…"
              autoComplete="off"
              aria-label="搜索导航或网页"
            />
            {!query ? <kbd className="search-shortcut">Ctrl K</kbd> : (
              <button className="search-clear" type="button" onClick={() => {
                setQuery("");
                searchInputRef.current?.focus();
              }} aria-label="清空搜索">×</button>
            )}
            <select
              value={engine}
              onChange={(event) => setEngine(event.target.value as keyof typeof engines)}
              aria-label="搜索引擎"
            >
              {Object.keys(engines).map((name) => <option key={name}>{name}</option>)}
            </select>
            <button type="submit" aria-label="搜索网页">↗</button>
          </form>
        </div>

        <div className="start-toolbar">
          <div>
            <span className="eyebrow">{normalizedQuery ? "Global Search" : "Navigation"}</span>
            <h1>{normalizedQuery ? "搜索结果 · " + searchResults.length : activeGroup?.name ?? "我的起始页"}</h1>
          </div>
          <div className="toolbar-buttons">
            {authenticated ? <Link href="/admin/navigation" title="编辑导航">✎</Link> : null}
            {authenticated ? <Link href="/admin" title="管理后台">⚙</Link> : <Link href="/login?next=%2Fstart" title="登录">⇥</Link>}
          </div>
        </div>

        {initialTree.groups.length === 0 ? (
          <div className="glass-card start-state-card start-empty">
            <h2>还没有导航数据</h2>
            <p>可以从管理后台导入 iTab 备份，或手动添加第一个分组。</p>
            {authenticated ? <Link href="/admin/navigation">管理导航</Link> : null}
          </div>
        ) : visibleEntries.length ? (
          <div className={normalizedQuery ? "tile-grid tile-grid--search" : "tile-grid start-density-" + density}>
            {visibleEntries.map(({ item, group, parent }) => {
              const className = [
                "start-tile",
                "glass-card",
                item.size === "2x1" && !normalizedQuery ? "start-tile--wide" : "",
                item.size === "2x2" && !normalizedQuery ? "start-tile--large" : "",
                item.type === "folder" ? "start-tile--folder" : "",
                normalizedQuery ? "start-tile--search-result" : ""
              ].filter(Boolean).join(" ");

              return (
                <button
                  className={className}
                  key={group.id + ":" + item.id}
                  type="button"
                  onClick={() => activate(item)}
                  onContextMenu={(event) => openContextMenu(event, item)}
                  style={item.backgroundColor ? {
                    background: item.backgroundColor,
                    color: contrastText(item.backgroundColor)
                  } : undefined}
                  title={item.browserLocal ? "浏览器内部地址，能否打开取决于当前浏览器权限" : item.url || item.name}
                >
                  {item.type === "folder" ? <FolderPreview item={item} /> : <NavIcon item={item} />}
                  <span className="start-tile-copy">
                    <strong>{item.name}</strong>
                    {normalizedQuery ? (
                      <small>{group.name}{parent ? " / " + parent.name : ""}</small>
                    ) : null}
                  </span>
                  {item.browserLocal ? <span className="browser-local-badge" title="浏览器内部地址">浏览器</span> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="glass-card start-state-card start-search-empty">
            <strong>没有匹配的导航</strong>
            <p>按 Enter 使用 {engine} 搜索“{query.trim()}”，或换一个关键词。</p>
          </div>
        )}

        <p className="start-keyboard-hint">
          <kbd>/</kbd> 或 <kbd>Ctrl K</kbd> 搜索 · <kbd>Alt 1–9</kbd> 切换分组 · <kbd>Esc</kbd> 关闭 / 清空 · 右键导航查看更多操作
        </p>
      </section>

      {folder ? (
        <div className="folder-dialog-backdrop" role="presentation" onMouseDown={() => setFolder(null)}>
          <section
            className="glass-card folder-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={folder.name}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="folder-dialog-head">
              <div>
                <div className="eyebrow">Folder · {folder.children.length} items</div>
                <h2>{folder.name}</h2>
              </div>
              <button type="button" onClick={() => setFolder(null)} aria-label="关闭">×</button>
            </div>
            <div className="folder-dialog-grid">
              {folder.children.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => activate(item)}
                  onContextMenu={(event) => openContextMenu(event, item)}
                  title={item.url || item.name}
                >
                  <NavIcon item={item} compact />
                  <strong>{item.name}</strong>
                  {item.browserLocal ? <small>浏览器内部地址</small> : null}
                </button>
              ))}
              {folder.children.length === 0 ? <p className="muted">这个文件夹还没有内容。</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="start-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
        >
          {contextMenu.item.type === "folder" ? (
            <button type="button" onClick={() => {
              setFolder(contextMenu.item);
              setContextMenu(null);
            }}>打开文件夹</button>
          ) : (
            <>
              <button type="button" onClick={() => openItem(contextMenu.item)}>新标签页打开</button>
              {isWebUrl(contextMenu.item.url) ? (
                <button type="button" onClick={() => openItem(contextMenu.item, true)}>当前页打开</button>
              ) : null}
              <button type="button" disabled={!contextMenu.item.url} onClick={() => void copyUrl(contextMenu.item)}>复制地址</button>
            </>
          )}
          {authenticated ? <Link href="/admin/navigation">管理这个导航</Link> : null}
        </div>
      ) : null}

      {toast ? <div className="start-toast" role="status">{toast}</div> : null}
    </>
  );
}
