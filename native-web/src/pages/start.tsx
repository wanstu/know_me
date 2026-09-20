import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { requestJSON } from "../api";
import type { NavGroup, NavItem, SessionUser, SiteSettings } from "../types";
import { ErrorCard, LoadingCard, PageFrame, safeHref } from "../ui";

type FlatItem = { item: NavItem; group: string; folder?: string };

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

function icon(item: NavItem) {
  if (item.iconUrl && (/^https?:\/\//i.test(item.iconUrl) || item.iconUrl.startsWith("/media/"))) {
    return <img src={item.iconUrl} alt="" loading="lazy" />;
  }
  return <span>{item.iconText || item.name.slice(0, 1).toUpperCase()}</span>;
}

export function StartPage({ settings, user }: { settings: SiteSettings; user: SessionUser | null }) {
  const [groups, setGroups] = useState<NavGroup[]>([]);
  const [activeGroup, setActiveGroup] = useState<number | null>(null);
  const [folder, setFolder] = useState<NavItem | null>(null);
  const [folderHistory, setFolderHistory] = useState<NavItem[]>([]);
  const [folderSelectedIndex, setFolderSelectedIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

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
  }, [folder, folderSelectedIndex, query]);

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
    if (item.browserLocal || item.extra?.openMode === "same_tab") {
      window.location.href = item.url;
      return;
    }
    window.open(item.url, "_blank", "noopener,noreferrer");
  }

  function searchWeb() {
    const value = query.trim();
    if (!value) return;
    window.location.href = looksLikeURL(value) ? value : searchURL(settings.defaultSearchEngine, value);
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
    return <PageFrame settings={settings} user={user}><ErrorCard message={error} /></PageFrame>;
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
    <div className={"km-start-page is-" + settings.startDensity} style={style}>
      <aside className="km-start-rail">
        <a className="km-start-logo" href="/">K</a>
        <nav>
          {groups.map((item) => (
            <button key={item.id} className={item.id === group?.id ? "is-active" : ""} onClick={() => { setActiveGroup(item.id); setQuery(""); setFolder(null); setFolderHistory([]); }} title={item.name}>
              <span>{item.icon || item.name.slice(0, 1)}</span><small>{item.name}</small>
            </button>
          ))}
        </nav>
        <a className="km-start-admin" href={user ? "/admin/navigation" : "/login?next=%2Fstart"}>{user ? "管理" : "登录"}</a>
      </aside>

      <main className="km-start-main">
        <header className="km-start-top">
          <div>
            <span className="km-eyebrow">{query ? "SEARCH" : "START"}</span>
            <h1>{query ? "全局搜索" : group?.name || "我的导航"}</h1>
          </div>
          <a href="/">返回主页</a>
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
            autoFocus
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

        <section className="km-start-grid">
          {visibleEntries.map(({ item, meta, selected }) => (
            <button
              key={item.id}
              className={"km-start-card size-" + item.size + (selected ? " is-selected" : "")}
              type="button"
              onClick={() => void openItem(item)}
              style={item.backgroundColor ? { "--km-card-accent": item.backgroundColor } as CSSProperties : undefined}
            >
              <span className="km-start-icon">{icon(item)}</span>
              <span className="km-start-card-copy">
                <strong>{item.name}</strong>
                <small>
                  {meta
                    ? [meta.group, meta.folder].filter(Boolean).join(" / ") + (item.url ? " · " + item.url : "")
                    : item.type === "folder"
                      ? (item.children?.length ?? 0) + " 个项目"
                      : item.browserLocal ? "浏览器本地" : item.url}
                </small>
              </span>
              <b>{item.type === "folder" ? "›" : "↗"}</b>
            </button>
          ))}
        </section>

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
                  className={index === folderSelectedIndex ? "is-selected" : ""}
                  aria-current={index === folderSelectedIndex ? "true" : undefined}
                  onFocus={() => setFolderSelectedIndex(index)}
                  onMouseEnter={() => setFolderSelectedIndex(index)}
                  onClick={() => void openItem(item)}
                >
                  <span className="km-start-icon">{icon(item)}</span>
                  <strong>{item.name}</strong>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
