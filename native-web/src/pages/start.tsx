import { FormEvent, useEffect, useMemo, useState, type CSSProperties } from "react";
import { getSession, requestJSON } from "../api";
import type { NavGroup, NavItem, SessionUser, SiteSettings } from "../types";
import { ErrorCard, LoadingCard, PageFrame } from "../ui";

function flattenItems(groups: NavGroup[]) {
  const result: Array<{ item: NavItem; group: string; folder?: string }> = [];
  const visit = (items: NavItem[], group: string, folder?: string) => {
    for (const item of items) {
      result.push({ item, group, folder });
      if (item.children?.length) visit(item.children, group, item.name);
    }
  };
  groups.forEach((group) => visit(group.items ?? [], group.name));
  return result;
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

export function StartPage({ settings }: { settings: SiteSettings }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [groups, setGroups] = useState<NavGroup[]>([]);
  const [activeGroup, setActiveGroup] = useState<number | null>(null);
  const [folder, setFolder] = useState<NavItem | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void getSession()
      .then(async (session) => {
        setUser(session);
        if (!session && !settings.startPublic) return;
        const payload = await requestJSON<{ groups: NavGroup[] }>(session ? "/api/navigation" : "/api/navigation/public");
        setGroups(payload.groups ?? []);
        setActiveGroup(payload.groups?.[0]?.id ?? null);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "navigation_failed"));
  }, [settings.startPublic]);

  const flat = useMemo(() => flattenItems(groups), [groups]);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return flat
      .filter(({ item, group, folder }) =>
        [item.name, item.url, group, folder ?? ""].some((value) => value.toLocaleLowerCase().includes(needle))
      )
      .sort((a, b) => b.item.visitCount - a.item.visitCount)
      .slice(0, 30);
  }, [flat, query]);

  const group = groups.find((item) => item.id === activeGroup) ?? groups[0];
  const visibleItems = query.trim() ? matches.map((item) => item.item) : group?.items ?? [];

  async function openItem(item: NavItem) {
    if (item.type === "folder") {
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
    if (item.browserLocal) {
      window.location.href = item.url;
      return;
    }
    window.open(item.url, "_blank", "noopener,noreferrer");
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    if (matches.length === 1) {
      void openItem(matches[0].item);
      return;
    }
    window.location.href = looksLikeURL(value) ? value : searchURL(settings.defaultSearchEngine, value);
  }

  const style = {
    "--km-start-card-alpha": String(Math.max(30, Math.min(95, settings.startCardOpacity)) / 100),
    "--km-start-radius": Math.max(12, Math.min(32, settings.startCardRadius)) + "px",
    "--km-start-dim": String(Math.max(0, Math.min(90, settings.startBackgroundDim)) / 100),
    ...(settings.startBackgroundUrl ? { backgroundImage: `linear-gradient(rgba(5,10,20,var(--km-start-dim)), rgba(5,10,20,var(--km-start-dim))), url("${settings.startBackgroundUrl.replace(/"/g, "%22")}")` } : {})
  } as CSSProperties;

  if (user === undefined) {
    return <PageFrame settings={settings}><LoadingCard text="正在加载起始页…" /></PageFrame>;
  }
  if (error) {
    return <PageFrame settings={settings}><ErrorCard message={"导航加载失败：" + error} /></PageFrame>;
  }
  if (!user && !settings.startPublic) {
    return (
      <PageFrame settings={settings}>
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
    <div className={"km-start-page is-" + settings.startDensity} style={style}>
      <aside className="km-start-rail">
        <a className="km-start-logo" href="/">K</a>
        <nav>
          {groups.map((item) => (
            <button key={item.id} className={item.id === group?.id ? "is-active" : ""} onClick={() => { setActiveGroup(item.id); setQuery(""); setFolder(null); }} title={item.name}>
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
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={"搜索所有导航，或使用 " + settings.defaultSearchEngine} autoFocus />
          {query ? <button type="button" onClick={() => setQuery("")}>清除</button> : <kbd>/</kbd>}
        </form>

        {query ? <p className="km-start-result-hint">{matches.length ? "找到 " + matches.length + " 个导航项" : "没有导航匹配，按 Enter 使用搜索引擎"}</p> : null}

        <section className="km-start-grid">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              className={"km-start-card size-" + item.size}
              type="button"
              onClick={() => void openItem(item)}
              style={item.backgroundColor ? { "--km-card-accent": item.backgroundColor } as CSSProperties : undefined}
            >
              <span className="km-start-icon">{icon(item)}</span>
              <span className="km-start-card-copy"><strong>{item.name}</strong><small>{item.type === "folder" ? (item.children?.length ?? 0) + " 个项目" : item.browserLocal ? "浏览器本地" : item.url}</small></span>
              <b>{item.type === "folder" ? "›" : "↗"}</b>
            </button>
          ))}
        </section>

        {!visibleItems.length && !query ? <section className="km-panel km-empty">这个分组还没有导航项。</section> : null}
      </main>

      {folder ? (
        <div className="km-modal-backdrop" onMouseDown={() => setFolder(null)}>
          <section className="km-panel km-folder-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span className="km-eyebrow">FOLDER</span><h2>{folder.name}</h2></div><button onClick={() => setFolder(null)}>×</button></header>
            <div className="km-folder-grid">
              {(folder.children ?? []).map((item) => (
                <button key={item.id} onClick={() => void openItem(item)}>
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
