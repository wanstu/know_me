"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { LiveClock } from "@/components/live-clock";
import type { NavGroup, NavItem, NavigationTree } from "@/lib/navigation/types";

const groupMarks: Record<string, string> = {
  home: "⌂", code: "</>", read: "文", app: "◇", entertainment: "游", office: "工", tool: "⌘"
};

const engines = {
  Bing: "https://www.bing.com/search?q=",
  Google: "https://www.google.com/search?q=",
  DuckDuckGo: "https://duckduckgo.com/?q="
} as const;

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

function openTarget(url: string) {
  if (!url) return;
  if (isNavigable(url)) window.open(url, "_blank", "noopener,noreferrer");
}

export function StartClient({ initialTree, defaultEngine = "Bing", authenticated = true }: { initialTree: NavigationTree; defaultEngine?: keyof typeof engines; authenticated?: boolean }) {
  const [activeGroupId, setActiveGroupId] = useState(initialTree.groups[0]?.id ?? 0);
  const [folder, setFolder] = useState<NavItem | null>(null);
  const [query, setQuery] = useState("");
  const [engine, setEngine] = useState<keyof typeof engines>(defaultEngine);

  const activeGroup = initialTree.groups.find((group) => group.id === activeGroupId) ?? initialTree.groups[0];
  const filtered = useMemo(() => {
    if (!activeGroup) return [];
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return activeGroup.items;
    return activeGroup.items.filter((item) =>
      item.name.toLocaleLowerCase().includes(needle) || item.url.toLocaleLowerCase().includes(needle)
    );
  }, [activeGroup, query]);

  function recordVisit(item: NavItem) {
    if (!authenticated) return;
    void fetch("/api/navigation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "visit", data: { id: item.id } })
    });
  }

  function activate(item: NavItem) {
    if (item.type === "folder") {
      setFolder(item);
      return;
    }
    recordVisit(item);
    openTarget(item.url);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    const exact = activeGroup?.items.find((item) => item.name.toLocaleLowerCase() === value.toLocaleLowerCase());
    if (exact) return activate(exact);
    if (/^https?:\/\//i.test(value)) return openTarget(value);
    if (!value.includes(" ") && value.includes(".")) return openTarget(`https://${value}`);
    window.open(engines[engine] + encodeURIComponent(value), "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <aside className="glass-card start-rail" aria-label="导航分组">
        {initialTree.groups.map((group) => (
          <button
            key={group.id}
            className={group.id === activeGroup?.id ? "is-active" : ""}
            type="button"
            title={group.name}
            onClick={() => { setActiveGroupId(group.id); setQuery(""); }}
          >
            {groupMark(group)}
          </button>
        ))}
        {authenticated ? <Link className="start-rail-admin" href="/admin/navigation" title="管理导航">⚙</Link> : <Link className="start-rail-admin" href="/login?next=%2Fstart" title="登录">⇥</Link>}
      </aside>

      <section className="start-content">
        <div className="start-hero">
          <LiveClock compact />
          <form className="glass-card search-box" onSubmit={submitSearch}>
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索常用链接，或输入网址 / 关键词…"
              autoComplete="off"
            />
            <select value={engine} onChange={(event) => setEngine(event.target.value as keyof typeof engines)} aria-label="搜索引擎">
              {Object.keys(engines).map((name) => <option key={name}>{name}</option>)}
            </select>
            <button type="submit">↗</button>
          </form>
        </div>

        <div className="start-toolbar">
          <div>
            <span className="eyebrow">Navigation</span>
            <h1>{activeGroup?.name ?? "我的起始页"}</h1>
          </div>
          <div className="toolbar-buttons">
            {authenticated ? <Link href="/admin/navigation" title="编辑导航">✎</Link> : null}
            {authenticated ? <Link href="/admin" title="管理后台">⚙</Link> : <Link href="/login?next=%2Fstart" title="登录">⇥</Link>}
          </div>
        </div>

        {initialTree.groups.length === 0 ? (
          <div className="glass-card start-empty">
            <h2>还没有导航数据</h2>
            <p>可以从管理后台导入 iTab 备份，或手动添加第一个分组。</p>
            <Link href="/admin/navigation">管理导航</Link>
          </div>
        ) : (
          <div className="tile-grid">
            {filtered.map((item) => {
              const className = [
                "start-tile", "glass-card",
                item.size === "2x1" ? "start-tile--wide" : "",
                item.size === "2x2" ? "start-tile--large" : "",
                item.type === "folder" ? "start-tile--folder" : ""
              ].filter(Boolean).join(" ");
              return (
                <button
                  className={className}
                  key={item.id}
                  type="button"
                  onClick={() => activate(item)}
                  style={item.backgroundColor ? { background: item.backgroundColor, color: contrastText(item.backgroundColor) } : undefined}
                  title={item.browserLocal ? "浏览器内部地址，能否打开取决于当前浏览器权限" : item.url || item.name}
                >
                  {item.type === "folder" ? (
                    <span className="folder-preview">
                      {Array.from({ length: 4 }).map((_, index) => <i key={index} />)}
                    </span>
                  ) : item.iconUrl ? (
                    <span className="tile-icon-image"><img src={item.iconUrl} alt="" /></span>
                  ) : (
                    <span className="tile-mark">{tileMark(item)}</span>
                  )}
                  <strong>{item.name}</strong>
                </button>
              );
            })}
          </div>
        )}

        {query && filtered.length === 0 ? <p className="prototype-note">当前分组没有匹配项，按回车可使用 {engine} 搜索。</p> : null}
      </section>

      {folder ? (
        <div className="folder-dialog-backdrop" role="presentation" onMouseDown={() => setFolder(null)}>
          <section className="glass-card folder-dialog" role="dialog" aria-modal="true" aria-label={folder.name} onMouseDown={(event) => event.stopPropagation()}>
            <div className="folder-dialog-head">
              <div><div className="eyebrow">Folder</div><h2>{folder.name}</h2></div>
              <button type="button" onClick={() => setFolder(null)}>×</button>
            </div>
            <div className="folder-dialog-grid">
              {folder.children.map((item) => (
                <button key={item.id} type="button" onClick={() => activate(item)}>
                  {item.iconUrl ? <img src={item.iconUrl} alt="" /> : <span>{tileMark(item)}</span>}
                  <strong>{item.name}</strong>
                </button>
              ))}
              {folder.children.length === 0 ? <p className="muted">这个文件夹还没有内容。</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
