import { FormEvent, useEffect, useMemo, useState } from "react";
import { logout, requestAPI, requestJSON } from "../api";
import { applyTheme, loadThemeCatalog, type ThemeCatalog } from "../kit";
import { validateMediaFile } from "../media";
import type { MediaRecord, NavGroup, NavItem, PostRecord, SessionUser, SiteSettings } from "../types";
import { AdminShell, AdminTitle, ConfirmDialog, ErrorCard, LoadingCard, Toast, errorText } from "../ui";
import { MediaManager } from "./admin/media-manager";
import { NavigationManager } from "./admin/navigation-manager";
import { PostEditor } from "./admin/post-editor";
import { TaxonomyManager } from "./admin/taxonomy-manager";

export function AdminPage({
  settings,
  user,
  path,
  onSettingsChange
}: {
  settings: SiteSettings;
  user: SessionUser | null;
  path: string;
  onSettingsChange: (settings: SiteSettings) => void;
}) {
  useEffect(() => {
    if (!user) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace("/login?next=" + next);
    }
  }, [user]);

  if (!user) return <main className="km-boot"><LoadingCard text="正在跳转到登录页…" /></main>;

  const postMatch = path.match(/^\/admin\/posts\/(\d+)$/);
  let content;
  let current = path;
  if (path === "/admin/settings") content = <SettingsAdmin settings={settings} onChange={onSettingsChange} />;
  else if (path === "/admin/navigation") content = <NavigationManager />;
  else if (path === "/admin/posts/new") {
    current = "/admin/posts";
    content = <PostEditor />;
  } else if (postMatch) {
    current = "/admin/posts";
    content = <PostEditor id={Number(postMatch[1])} />;
  } else if (path === "/admin/posts") content = <PostsAdmin />;
  else if (path === "/admin/taxonomy") content = <TaxonomyManager />;
  else if (path === "/admin/media") content = <MediaManager />;
  else if (path === "/admin/backup") content = <BackupAdmin />;
  else if (path === "/admin") content = <DashboardAdmin />;
  else content = <AdminNotFound />;

  return (
    <AdminShell settings={settings} user={user} current={current}>
      <div className="km-admin-top-actions">
        <button className="dk-button" type="button" onClick={() => void logout().finally(() => { window.location.href = "/"; })}>退出登录</button>
      </div>
      {content}
    </AdminShell>
  );
}

type BackupActivity = {
  lastExportAt: string;
  lastRestoreAt: string;
  lastRestoreSourceAt: string;
  lastRestoreVersion: number;
  lastRestorePosts: number;
  lastRestoreMedia: number;
};

function DashboardAdmin() {
  const [data, setData] = useState<{
    posts: PostRecord[];
    media: MediaRecord[];
    groups: NavGroup[];
    tags: Array<{ id: number; name: string; count: number }>;
    categories: Array<{ id: number; name: string; count: number }>;
    version: string;
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([
      requestJSON<{ posts: PostRecord[] }>("/api/posts?summary=1"),
      requestJSON<{ media: MediaRecord[] }>("/api/media"),
      requestJSON<{ groups: NavGroup[] }>("/api/navigation"),
      requestJSON<{ tags: Array<{ id: number; name: string; count: number }>; categories: Array<{ id: number; name: string; count: number }> }>("/api/taxonomy"),
      requestJSON<{ version: string }>("/api/health")
    ]).then(([posts, media, navigation, taxonomy, health]) => {
      setData({
        posts: posts.posts ?? [],
        media: media.media ?? [],
        groups: navigation.groups ?? [],
        tags: taxonomy.tags ?? [],
        categories: taxonomy.categories ?? [],
        version: health.version || "dev"
      });
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "dashboard_failed"));
  }, []);

  function countItems(items: NavItem[]): number {
    return items.reduce((total, item) => total + 1 + countItems(item.children ?? []), 0);
  }

  if (error) return <><AdminTitle eyebrow="DASHBOARD" title="管理总览" /><ErrorCard message={error} /></>;
  if (!data) return <><AdminTitle eyebrow="DASHBOARD" title="管理总览" /><LoadingCard text="正在读取站点状态…" /></>;

  const published = data.posts.filter((post) => post.status === "published").length;
  const drafts = data.posts.filter((post) => post.status === "draft").length;
  const scheduled = data.posts.filter((post) => post.status === "scheduled").length;
  const navigationItems = data.groups.reduce((total, group) => total + countItems(group.items ?? []), 0);
  const recentPosts = data.posts.slice(0, 5);
  const recentMedia = [...data.media].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);

  return (
    <>
      <AdminTitle eyebrow="DASHBOARD" title="管理总览" description={"Know Me " + data.version + " · 内容、导航与媒体状态"} />
      <section className="km-stat-row km-dashboard-stats">
        <a className="km-panel" href="/admin/posts"><span>已发布</span><strong>{published}</strong><small>草稿 {drafts} · 定时 {scheduled}</small></a>
        <a className="km-panel" href="/admin/navigation"><span>导航</span><strong>{navigationItems}</strong><small>{data.groups.length} 个分组</small></a>
        <a className="km-panel" href="/admin/media"><span>媒体</span><strong>{data.media.length}</strong><small>图片资源</small></a>
        <a className="km-panel" href="/admin/taxonomy"><span>分类与标签</span><strong>{data.categories.length + data.tags.length}</strong><small>{data.categories.length} 分类 · {data.tags.length} 标签</small></a>
      </section>

      <div className="km-dashboard-columns">
        <section className="km-panel km-dashboard-list">
          <header><div><span className="km-eyebrow">RECENT POSTS</span><h2>最近文章</h2></div><a href="/admin/posts">查看全部</a></header>
          {recentPosts.map((post) => (
            <a key={post.id} href={"/admin/posts/" + post.id}>
              <span><strong>{post.title}</strong><small>{post.status === "published" ? "已发布" : post.status === "scheduled" ? "定时" : "草稿"} · {new Date(post.updatedAt).toLocaleString("zh-CN")}</small></span>
              <b>›</b>
            </a>
          ))}
          {!recentPosts.length ? <p className="km-muted">还没有文章。</p> : null}
        </section>

        <section className="km-panel km-dashboard-list">
          <header><div><span className="km-eyebrow">RECENT MEDIA</span><h2>最近媒体</h2></div><a href="/admin/media">查看全部</a></header>
          {recentMedia.map((item) => (
            <a key={item.id} href="/admin/media">
              <span><strong>{item.originalName}</strong><small>{Math.ceil(item.size / 1024)} KB · {new Date(item.createdAt).toLocaleString("zh-CN")}</small></span>
              <b>›</b>
            </a>
          ))}
          {!recentMedia.length ? <p className="km-muted">还没有媒体。</p> : null}
        </section>
      </div>

      <section className="km-admin-card-grid km-dashboard-shortcuts">
        {[
          ["/admin/navigation", "起始页导航", "管理分组、链接和文件夹"],
          ["/admin/posts/new", "新建文章", "直接进入 Markdown 编辑器"],
          ["/admin/settings", "站点设置", "主页、Start 与主题"],
          ["/admin/backup", "备份与恢复", "导出或恢复完整站点数据"]
        ].map(([href, title, description]) => (
          <a className="km-panel km-admin-card" href={href} key={href}>
            <span>OPEN</span><strong>{title}</strong><p>{description}</p><b>→</b>
          </a>
        ))}
      </section>
    </>
  );
}

function AdminNotFound() {
  return (
    <>
      <AdminTitle eyebrow="404" title="后台页面不存在" description="这个管理地址不存在，可能已经被移动或删除。" />
      <section className="km-panel km-empty">
        <strong>找不到页面</strong>
        <p>返回管理总览继续操作。</p>
        <a className="dk-button dk-button-primary" href="/admin">返回管理总览</a>
      </section>
    </>
  );
}

type SettingsSection = "profile" | "start" | "theme" | "content" | "footer";

function reorderValues<T>(values: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= values.length || to >= values.length) return values;
  const next = [...values];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function MediaField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [media, setMedia] = useState<MediaRecord[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function openPicker() {
    setOpen(true);
    setError("");
    if (media) return;
    try {
      const payload = await requestJSON<{ media: MediaRecord[] }>("/api/media");
      setMedia(payload.media ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "media_failed");
    }
  }

  async function upload(file: File) {
    const validationError = validateMediaFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("alt", file.name.replace(/\.[^.]+$/, ""));
      const response = await requestAPI("/api/media", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "upload_failed");
      const item = payload.media as MediaRecord;
      setMedia((current) => [item, ...(current ?? []).filter((value) => value.id !== item.id)]);
      onChange(item.url);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "upload_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dk-field km-media-field">
      <span>{label}</span>
      <div className="km-media-field-row">
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="/media/... 或 https://..." />
        <button type="button" className="dk-button" onClick={() => void openPicker()}>媒体库</button>
        {value ? <button type="button" className="dk-button" onClick={() => onChange("")}>清除</button> : null}
      </div>
      {value ? <div className="km-media-field-preview"><img src={value} alt="" /></div> : null}
      {open ? (
        <div className="km-modal-backdrop" onMouseDown={() => { if (!busy) setOpen(false); }}>
          <section className="km-panel km-media-picker" role="dialog" aria-modal="true" aria-label={label + "媒体选择"} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span className="km-eyebrow">MEDIA</span><h2>选择{label}</h2></div>
              <button type="button" aria-label="关闭" onClick={() => setOpen(false)}>×</button>
            </header>
            <div className="km-media-picker-actions">
              <label className="dk-button dk-button-primary">
                {busy ? "上传中…" : "上传新图片"}
                <input hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.currentTarget.value = "";
                }} />
              </label>
              <small>也可以从已有媒体中选择。</small>
            </div>
            {error ? <div className="dk-message is-danger">{errorText(error)}</div> : null}
            {!media && !error ? <LoadingCard text="正在读取媒体库…" /> : null}
            {media ? (
              <div className="km-media-picker-grid">
                {media.map((item) => (
                  <button type="button" key={item.id} className={item.url === value ? "is-selected" : ""} onClick={() => { onChange(item.url); setOpen(false); }}>
                    <img src={item.url} alt={item.alt || item.originalName} />
                    <span>{item.originalName}</span>
                  </button>
                ))}
                {!media.length ? <p className="km-muted">媒体库还是空的，可以先上传一张图片。</p> : null}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function SettingsAdmin({ settings, onChange }: { settings: SiteSettings; onChange: (settings: SiteSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [section, setSection] = useState<SettingsSection>("profile");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<ThemeCatalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [themePalette, setThemePalette] = useState<string[]>([]);
  const [collectionDrag, setCollectionDrag] = useState<{ kind: "social" | "entry" | "project"; index: number } | null>(null);

  useEffect(() => {
    void loadThemeCatalog(false)
      .then((value) => {
        setCatalog(value);
        setCatalogError(value.last_error ?? "");
        if (value.source === "builtin" || value.stale) {
          void loadThemeCatalog(true)
            .then((fresh) => {
              setCatalog(fresh);
              setCatalogError(fresh.last_error ?? "");
            })
            .catch((reason) => setCatalogError(reason instanceof Error ? reason.message : value.last_error ?? "theme_catalog_refresh_failed"));
        }
      })
      .catch((reason) => setCatalogError(reason instanceof Error ? reason.message : "theme_catalog_failed"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void applyTheme(draft.themeMode, draft.themePreset).then(() => {
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        const style = window.getComputedStyle(document.documentElement);
        setThemePalette([
          style.getPropertyValue("--dk-primary").trim() || "#6366f1",
          style.getPropertyValue("--dk-bg-app").trim() || "#f5f7fb",
          style.getPropertyValue("--dk-bg-elevated").trim() || "#ffffff",
          style.getPropertyValue("--dk-text").trim() || "#172033"
        ]);
      });
    });
    return () => { cancelled = true; };
  }, [draft.themeMode, draft.themePreset]);

  async function refreshThemes() {
    setCatalogError("");
    try {
      const value = await loadThemeCatalog(true);
      setCatalog(value);
      setCatalogError(value.last_error ?? "");
    } catch (reason) {
      setCatalogError(reason instanceof Error ? reason.message : "theme_catalog_failed");
    }
  }

  function update<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const fallbackThemePacks = [
    { name: "aurora", display_name: "极光", description: "离线默认主题" },
    { name: "ocean", display_name: "海洋", description: "离线默认主题" },
    { name: "forest", display_name: "森林", description: "离线默认主题" },
    { name: "sunset", display_name: "落日", description: "离线默认主题" }
  ];
  const themePacks = catalog?.packs?.length ? catalog.packs : fallbackThemePacks;
  const selectedTheme = themePacks.find((pack) => pack.name === draft.themePreset);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function discardChanges() {
    setDraft(settings);
    setMessage("");
    void applyTheme(settings.themeMode, settings.themePreset);
  }

  function reorderCollection(kind: "social" | "entry" | "project", targetIndex: number) {
    if (!collectionDrag || collectionDrag.kind !== kind) return;
    setDraft((current) => {
      if (kind === "social") return { ...current, socialLinks: reorderValues(current.socialLinks, collectionDrag.index, targetIndex) };
      if (kind === "entry") return { ...current, homeEntries: reorderValues(current.homeEntries, collectionDrag.index, targetIndex) };
      return { ...current, projects: reorderValues(current.projects, collectionDrag.index, targetIndex) };
    });
    setCollectionDrag(null);
  }

  function moveCollection(kind: "social" | "entry" | "project", index: number, delta: -1 | 1) {
    const target = index + delta;
    setDraft((current) => {
      if (kind === "social") {
        if (target < 0 || target >= current.socialLinks.length) return current;
        return { ...current, socialLinks: reorderValues(current.socialLinks, index, target) };
      }
      if (kind === "entry") {
        if (target < 0 || target >= current.homeEntries.length) return current;
        return { ...current, homeEntries: reorderValues(current.homeEntries, index, target) };
      }
      if (target < 0 || target >= current.projects.length) return current;
      return { ...current, projects: reorderValues(current.projects, index, target) };
    });
  }


  function updateSocial(index: number, key: "label" | "url", value: string) {
    setDraft((current) => ({
      ...current,
      socialLinks: current.socialLinks.map((item, i) => i === index ? { ...item, [key]: value } : item)
    }));
  }

  function updateHomeEntry(index: number, key: "name" | "description" | "url", value: string) {
    setDraft((current) => ({
      ...current,
      homeEntries: current.homeEntries.map((item, i) => i === index ? { ...item, [key]: value } : item)
    }));
  }

  function updateProject(index: number, key: "name" | "description" | "url" | "tag", value: string) {
    setDraft((current) => ({
      ...current,
      projects: current.projects.map((item, i) => i === index ? { ...item, [key]: value } : item)
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setMessageTone("success");
    try {
      const payload = await requestJSON<{ settings: SiteSettings }>("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft)
      });
      setDraft(payload.settings);
      onChange(payload.settings);
      setMessage("已保存");
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "save_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminTitle eyebrow="SETTINGS" title="站点设置" description="管理主页、Start、主题以及对外展示的内容入口。" />
      <nav className="km-settings-tabs" aria-label="站点设置分区">
        {([
          ["profile", "主页"],
          ["start", "Start"],
          ["theme", "主题"],
          ["content", "链接与项目"],
          ["footer", "页脚"]
        ] as const).map(([value, label]) => (
          <button type="button" key={value} className={section === value ? "is-active" : ""} onClick={() => setSection(value)}>
            {label}
          </button>
        ))}
        <span className={dirty ? "is-dirty" : ""}>{dirty ? "有未保存修改" : "已保存"}</span>
      </nav>

      <form className="km-panel km-admin-form km-settings-form" onSubmit={save}>
        {section === "profile" ? (
          <section className="km-settings-pane">
            <header><span className="km-eyebrow">PROFILE</span><h2>主页内容</h2><p>设置个人主页的名称、简介、头像和背景。</p></header>
            <div className="km-form-grid">
              <label className="dk-field">名称<input value={draft.profileName} onChange={(event) => update("profileName", event.target.value)} /></label>
              <label className="dk-field">短描述<input value={draft.profileTagline} onChange={(event) => update("profileTagline", event.target.value)} /></label>
              <label className="dk-field km-span-2">简介<textarea rows={4} value={draft.profileBio} onChange={(event) => update("profileBio", event.target.value)} /></label>
              <MediaField label="头像" value={draft.avatarUrl} onChange={(value) => update("avatarUrl", value)} />
              <MediaField label="主页背景" value={draft.homeBackgroundUrl} onChange={(value) => update("homeBackgroundUrl", value)} />
              <label className="dk-field">今日短句<input value={draft.quote} onChange={(event) => update("quote", event.target.value)} /></label>
              <label className="dk-field">短句署名<input value={draft.quoteAuthor} onChange={(event) => update("quoteAuthor", event.target.value)} /></label>
              <label className="km-check"><input type="checkbox" checked={draft.quoteEnabled} onChange={(event) => update("quoteEnabled", event.target.checked)} /><span><strong>显示今日短句</strong><small>关闭后主页不显示短句卡片。</small></span></label>
              <label className="km-check"><input type="checkbox" checked={draft.quoteAuthorEnabled} onChange={(event) => update("quoteAuthorEnabled", event.target.checked)} /><span><strong>显示短句署名</strong><small>仅控制署名，不影响短句正文。</small></span></label>
            </div>
            <div className={"km-settings-quote-preview" + (!draft.quoteEnabled ? " is-disabled" : "")} aria-live="polite">
              <div>
                <span className="km-eyebrow">主页即时预览</span>
                <small>{draft.quoteEnabled ? "保存前即可确认短句卡片效果" : "短句卡片已关闭"}</small>
              </div>
              {draft.quoteEnabled ? (
                <blockquote>
                  <p>{draft.quote.trim() || "留空后，主页会从内置短句中选择一条显示。"}</p>
                  {draft.quoteAuthorEnabled ? <cite>— {draft.quoteAuthor.trim() || "默认署名"}</cite> : null}
                </blockquote>
              ) : (
                <p className="km-muted">主页将隐藏今日短句卡片。</p>
              )}
            </div>
          </section>
        ) : null}

        {section === "start" ? (
          <section className="km-settings-pane">
            <header><span className="km-eyebrow">START</span><h2>浏览器起始页</h2><p>控制背景、搜索方式、卡片密度和公开策略。</p></header>
            <div className="km-form-grid">
              <MediaField label="Start 背景" value={draft.startBackgroundUrl} onChange={(value) => update("startBackgroundUrl", value)} />
              <label className="dk-field">默认搜索<select value={draft.defaultSearchEngine} onChange={(event) => update("defaultSearchEngine", event.target.value as SiteSettings["defaultSearchEngine"])}><option>Bing</option><option>Google</option><option>DuckDuckGo</option></select></label>
              <label className="dk-field">起始页密度<select value={draft.startDensity} onChange={(event) => update("startDensity", event.target.value as SiteSettings["startDensity"])}><option value="compact">紧凑</option><option value="comfortable">舒适</option><option value="spacious">宽松</option></select></label>
              <label className="dk-field">卡片透明度 <b>{draft.startCardOpacity}%</b><input type="range" min={30} max={95} value={draft.startCardOpacity} onChange={(event) => update("startCardOpacity", Number(event.target.value))} /></label>
              <label className="dk-field">卡片圆角 <b>{draft.startCardRadius}px</b><input type="range" min={12} max={32} value={draft.startCardRadius} onChange={(event) => update("startCardRadius", Number(event.target.value))} /></label>
              <label className="dk-field">背景压暗 <b>{draft.startBackgroundDim}%</b><input type="range" min={0} max={90} value={draft.startBackgroundDim} onChange={(event) => update("startBackgroundDim", Number(event.target.value))} /></label>
              <label className="km-check km-span-2"><input type="checkbox" checked={draft.startPublic} onChange={(event) => update("startPublic", event.target.checked)} /><span><strong>公开起始页</strong><small>关闭后未登录访客无法查看导航。</small></span></label>
            </div>
          </section>
        ) : null}

        {section === "theme" ? (
          <section className="km-settings-pane">
            <header><span className="km-eyebrow">THEME</span><h2>主题与外观</h2><p>修改会立即预览；只有点击保存后才会写入站点配置。</p></header>
            <div className="km-form-grid">
              <label className="dk-field">主题模式<select value={draft.themeMode} onChange={(event) => update("themeMode", event.target.value as SiteSettings["themeMode"])}><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
              <div className="dk-field km-theme-picker">
                <span>主题包</span>
                <div className="km-theme-picker-row">
                  <select value={draft.themePreset} onChange={(event) => update("themePreset", event.target.value)}>
                    {!themePacks.some((pack) => pack.name === draft.themePreset) ? <option value={draft.themePreset}>{draft.themePreset}</option> : null}
                    {themePacks.map((pack) => <option key={pack.name} value={pack.name}>{pack.display_name} · {pack.name}</option>)}
                  </select>
                  <button type="button" className="dk-button" onClick={() => void refreshThemes()}>刷新主题</button>
                </div>
                <div className="km-theme-preview" aria-label="当前主题配色预览">
                  {themePalette.map((color, index) => <span key={index} style={{ background: color }} title={color} />)}
                </div>
                <small>{selectedTheme?.description ?? "由主题系统提供"}</small>
                <small>
                  {catalog ? `来源：${catalog.source} · ${catalog.packs.length} 套${catalog.stale ? " · 缓存待刷新" : ""}` : "正在使用 Kit 内置离线主题"}
                  {catalogError ? " · " + catalogError : ""}
                </small>
              </div>
            </div>
          </section>
        ) : null}

        {section === "content" ? (
          <section className="km-settings-pane">
            <header><span className="km-eyebrow">CONTENT</span><h2>链接与项目</h2><p>管理主页上的社交链接、入口卡片与项目作品。</p></header>

            <section className="km-settings-collection">
              <header><div><span className="km-eyebrow">SOCIAL</span><h3>主页链接</h3></div><button type="button" className="dk-button" onClick={() => setDraft((current) => ({ ...current, socialLinks: [...current.socialLinks, { id: "social-" + Date.now(), label: "", url: "" }] }))}>新增</button></header>
              <div className="km-settings-rows">
                {draft.socialLinks.map((item, index) => (
                  <div
                    key={item.id}
                    className={collectionDrag?.kind === "social" && collectionDrag.index === index ? "is-dragging" : ""}
                    onDragOver={(event) => { if (collectionDrag?.kind === "social") event.preventDefault(); }}
                    onDrop={(event) => { event.preventDefault(); reorderCollection("social", index); }}
                  >
                    <span className="km-settings-drag" draggable onDragStart={() => setCollectionDrag({ kind: "social", index })} onDragEnd={() => setCollectionDrag(null)} title="拖拽排序">⠿</span>
                    <input value={item.label} onChange={(event) => updateSocial(index, "label", event.target.value)} placeholder="名称" />
                    <input value={item.url} onChange={(event) => updateSocial(index, "url", event.target.value)} placeholder="https://..." />
                    <div className="km-settings-row-actions">
                      <button type="button" title="上移" aria-label={"上移“" + (item.label || "链接") + "”"} disabled={index === 0} onClick={() => moveCollection("social", index, -1)}>↑</button>
                      <button type="button" title="下移" aria-label={"下移“" + (item.label || "链接") + "”"} disabled={index === draft.socialLinks.length - 1} onClick={() => moveCollection("social", index, 1)}>↓</button>
                      <button type="button" className="is-danger" onClick={() => setDraft((current) => ({ ...current, socialLinks: current.socialLinks.filter((_, i) => i !== index) }))}>删除</button>
                    </div>
                  </div>
                ))}
                {!draft.socialLinks.length ? <p className="km-muted">没有额外社交链接。</p> : null}
              </div>
            </section>

            <section className="km-settings-collection">
              <header><div><span className="km-eyebrow">EXPLORE</span><h3>主页入口</h3></div><button type="button" className="dk-button" onClick={() => setDraft((current) => ({ ...current, homeEntries: [...current.homeEntries, { id: "entry-" + Date.now(), name: "", description: "", url: "/", newTab: false }] }))}>新增</button></header>
              <div className="km-settings-rows is-entry">
                {draft.homeEntries.map((item, index) => (
                  <div
                    key={item.id}
                    className={collectionDrag?.kind === "entry" && collectionDrag.index === index ? "is-dragging" : ""}
                    onDragOver={(event) => { if (collectionDrag?.kind === "entry") event.preventDefault(); }}
                    onDrop={(event) => { event.preventDefault(); reorderCollection("entry", index); }}
                  >
                    <span className="km-settings-drag" draggable onDragStart={() => setCollectionDrag({ kind: "entry", index })} onDragEnd={() => setCollectionDrag(null)} title="拖拽排序">⠿</span>
                    <input value={item.name} onChange={(event) => updateHomeEntry(index, "name", event.target.value)} placeholder="名称" />
                    <input value={item.description} onChange={(event) => updateHomeEntry(index, "description", event.target.value)} placeholder="说明" />
                    <input value={item.url} onChange={(event) => updateHomeEntry(index, "url", event.target.value)} placeholder="/blog" />
                    <label className="km-settings-checkbox"><input type="checkbox" checked={item.newTab} onChange={(event) => setDraft((current) => ({ ...current, homeEntries: current.homeEntries.map((entry, i) => i === index ? { ...entry, newTab: event.target.checked } : entry) }))} />新窗口</label>
                    <div className="km-settings-row-actions">
                      <button type="button" title="上移" aria-label={"上移“" + (item.name || "主页入口") + "”"} disabled={index === 0} onClick={() => moveCollection("entry", index, -1)}>↑</button>
                      <button type="button" title="下移" aria-label={"下移“" + (item.name || "主页入口") + "”"} disabled={index === draft.homeEntries.length - 1} onClick={() => moveCollection("entry", index, 1)}>↓</button>
                      <button type="button" className="is-danger" onClick={() => setDraft((current) => ({ ...current, homeEntries: current.homeEntries.filter((_, i) => i !== index) }))}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="km-settings-collection">
              <header><div><span className="km-eyebrow">PROJECTS</span><h3>项目与作品</h3></div><button type="button" className="dk-button" onClick={() => setDraft((current) => ({ ...current, projects: [...current.projects, { id: "project-" + Date.now(), name: "", description: "", url: "", tag: "" }] }))}>新增</button></header>
              <div className="km-settings-rows is-project">
                {draft.projects.map((item, index) => (
                  <div
                    key={item.id}
                    className={collectionDrag?.kind === "project" && collectionDrag.index === index ? "is-dragging" : ""}
                    onDragOver={(event) => { if (collectionDrag?.kind === "project") event.preventDefault(); }}
                    onDrop={(event) => { event.preventDefault(); reorderCollection("project", index); }}
                  >
                    <span className="km-settings-drag" draggable onDragStart={() => setCollectionDrag({ kind: "project", index })} onDragEnd={() => setCollectionDrag(null)} title="拖拽排序">⠿</span>
                    <input value={item.name} onChange={(event) => updateProject(index, "name", event.target.value)} placeholder="项目名称" />
                    <input value={item.tag} onChange={(event) => updateProject(index, "tag", event.target.value)} placeholder="标签" />
                    <input value={item.url} onChange={(event) => updateProject(index, "url", event.target.value)} placeholder="https://..." />
                    <input value={item.description} onChange={(event) => updateProject(index, "description", event.target.value)} placeholder="项目说明" />
                    <div className="km-settings-row-actions">
                      <button type="button" title="上移" aria-label={"上移“" + (item.name || "项目") + "”"} disabled={index === 0} onClick={() => moveCollection("project", index, -1)}>↑</button>
                      <button type="button" title="下移" aria-label={"下移“" + (item.name || "项目") + "”"} disabled={index === draft.projects.length - 1} onClick={() => moveCollection("project", index, 1)}>↓</button>
                      <button type="button" className="is-danger" onClick={() => setDraft((current) => ({ ...current, projects: current.projects.filter((_, i) => i !== index) }))}>删除</button>
                    </div>
                  </div>
                ))}
                {!draft.projects.length ? <p className="km-muted">还没有项目卡片。</p> : null}
              </div>
            </section>
          </section>
        ) : null}

        {section === "footer" ? (
          <section className="km-settings-pane">
            <header><span className="km-eyebrow">FOOTER</span><h2>页脚与站点信息</h2><p>配置备案、公安备案、附加说明和友情链接；每一项都可以独立隐藏。</p></header>
            <div className="km-form-grid">
              <label className="km-check km-span-2"><input type="checkbox" checked={draft.showIcp} onChange={(event) => update("showIcp", event.target.checked)} /><span><strong>显示 ICP 备案</strong><small>仅在填写备案号后显示。</small></span></label>
              <label className="dk-field">ICP 备案号<input value={draft.icpNumber} onChange={(event) => update("icpNumber", event.target.value)} placeholder="京ICP备XXXXXXXX号" /></label>
              <label className="dk-field">ICP 链接<input value={draft.icpUrl} onChange={(event) => update("icpUrl", event.target.value)} placeholder="https://beian.miit.gov.cn/" /></label>

              <label className="km-check km-span-2"><input type="checkbox" checked={draft.showPolice} onChange={(event) => update("showPolice", event.target.checked)} /><span><strong>显示公安备案</strong><small>仅在填写公安备案号后显示。</small></span></label>
              <label className="dk-field">公安备案号<input value={draft.policeNumber} onChange={(event) => update("policeNumber", event.target.value)} placeholder="京公网安备 XXXXXXXXXXXXXX号" /></label>
              <label className="dk-field">公安备案链接<input value={draft.policeUrl} onChange={(event) => update("policeUrl", event.target.value)} placeholder="https://www.beian.gov.cn/..." /></label>

              <label className="dk-field km-span-2">页脚附加文字<textarea rows={3} value={draft.footerText} onChange={(event) => update("footerText", event.target.value)} placeholder="例如：Built with Know Me · 内容持续更新中" /></label>
              <label className="km-check km-span-2"><input type="checkbox" checked={draft.showFriendLinks} onChange={(event) => update("showFriendLinks", event.target.checked)} /><span><strong>显示友情链接</strong><small>仅公开显示启用且名称、地址完整的链接。</small></span></label>
            </div>

            <section className="km-settings-collection">
              <header>
                <div><span className="km-eyebrow">FRIENDS</span><h3>友情链接</h3></div>
                <button type="button" className="dk-button" onClick={() => setDraft((current) => ({ ...current, friendLinks: [...current.friendLinks, { id: "friend-" + Date.now(), name: "", url: "", visible: true }] }))}>新增</button>
              </header>
              <div className="km-settings-rows is-friend">
                {draft.friendLinks.map((item, index) => (
                  <div key={item.id}>
                    <span className="km-settings-drag" aria-hidden="true">↗</span>
                    <input value={item.name} onChange={(event) => setDraft((current) => ({ ...current, friendLinks: current.friendLinks.map((link, i) => i === index ? { ...link, name: event.target.value } : link) }))} placeholder="站点名称" />
                    <input value={item.url} onChange={(event) => setDraft((current) => ({ ...current, friendLinks: current.friendLinks.map((link, i) => i === index ? { ...link, url: event.target.value } : link) }))} placeholder="https://..." />
                    <label className="km-settings-checkbox"><input type="checkbox" checked={item.visible} onChange={(event) => setDraft((current) => ({ ...current, friendLinks: current.friendLinks.map((link, i) => i === index ? { ...link, visible: event.target.checked } : link) }))} />显示</label>
                    <div className="km-settings-row-actions">
                      <button type="button" title="上移" disabled={index === 0} onClick={() => setDraft((current) => ({ ...current, friendLinks: reorderValues(current.friendLinks, index, index - 1) }))}>↑</button>
                      <button type="button" title="下移" disabled={index === draft.friendLinks.length - 1} onClick={() => setDraft((current) => ({ ...current, friendLinks: reorderValues(current.friendLinks, index, index + 1) }))}>↓</button>
                      <button type="button" className="is-danger" onClick={() => setDraft((current) => ({ ...current, friendLinks: current.friendLinks.filter((_, i) => i !== index) }))}>删除</button>
                    </div>
                  </div>
                ))}
                {!draft.friendLinks.length ? <p className="km-muted">还没有友情链接。</p> : null}
              </div>
            </section>
          </section>
        ) : null}

        <div className="km-form-actions">
          <span className={"km-settings-dirty" + (dirty ? " is-dirty" : "")}>{dirty ? "有未保存修改" : "已与已保存配置同步"}</span>
          <div>
            <button type="button" className="dk-button" disabled={busy || !dirty} onClick={discardChanges}>放弃修改</button>
            <button className="dk-button dk-button-primary" disabled={busy || !dirty}>{busy ? "保存中…" : "保存设置"}</button>
          </div>
        </div>
      </form>
      {message ? <Toast message={messageTone === "error" ? errorText(message) : message} tone={messageTone} onClose={() => setMessage("")} /> : null}
    </>
  );
}

function PostsAdmin() {
  const [posts, setPosts] = useState<PostRecord[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | PostRecord["status"]>("all");

  useEffect(() => {
    void requestJSON<{ posts: PostRecord[] }>("/api/posts?summary=1")
      .then((value) => setPosts(value.posts))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "blog_failed"));
  }, []);

  const filtered = useMemo(() => {
    if (!posts) return [];
    const needle = query.trim().toLocaleLowerCase();
    return posts.filter((post) => {
      if (status !== "all" && post.status !== status) return false;
      if (!needle) return true;
      return [post.title, post.slug, post.excerpt, ...post.tags, ...post.categories]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [posts, query, status]);

  return (
    <>
      <div className="km-admin-title-with-action">
        <AdminTitle eyebrow="BLOG" title="文章" description="管理 Markdown 文章、草稿、定时发布与历史版本。" />
        <div className="km-admin-title-actions"><a className="dk-button" href="/admin/posts/new?import=1">导入 Markdown</a><a className="dk-button dk-button-primary" href="/admin/posts/new">新建文章</a></div>
      </div>
      {error ? <ErrorCard message={error} /> : !posts ? <LoadingCard /> : (
        <>
          <div className="km-panel km-list-filter km-post-list-filter">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、Slug、标签…" />
            <div className="km-status-filter" aria-label="文章状态筛选">
              {([
                ["all", "全部"], ["published", "已发布"], ["draft", "草稿"], ["scheduled", "定时"]
              ] as const).map(([value, label]) => <button type="button" key={value} className={status === value ? "is-active" : ""} onClick={() => setStatus(value)}>{label}</button>)}
            </div>
            <span>{filtered.length} / {posts.length}</span>
          </div>
          <section className="km-panel km-post-admin-list">
            {filtered.map((post) => (
              <a href={"/admin/posts/" + post.id} key={post.id}>
                <span className={"km-status-dot is-" + post.status} />
                <span><strong>{post.title}</strong><small>{post.slug} · {post.categories.join(" / ") || "未分类"}</small></span>
                {post.pinned ? <em>置顶</em> : null}
                <b>{post.status === "published" ? "已发布" : post.status === "scheduled" ? "定时" : "草稿"}</b>
                <time>{new Date(post.updatedAt).toLocaleString("zh-CN")}</time>
                <i>›</i>
              </a>
            ))}
            {!filtered.length ? (
              <div className="km-post-empty-state">
                <strong>{posts.length ? "没有匹配的文章" : "还没有文章"}</strong>
                <p>{posts.length ? "调整搜索词或状态筛选后再试。" : "可以从空白文章开始，也可以直接导入现有 Markdown。"}</p>
                {!posts.length ? <div><a className="dk-button dk-button-primary" href="/admin/posts/new">新建文章</a><a className="dk-button" href="/admin/posts/new?import=1">导入 Markdown</a></div> : null}
              </div>
            ) : null}
          </section>
        </>
      )}
    </>
  );
}

type BackupPreview = {
  format: string;
  version: number;
  exportedAt: string;
  posts: number;
  navigationItems: number;
  media: number;
  settings: number;
  uploadFiles: number;
  compatible: boolean;
};

function BackupAdmin() {
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error" | "info">("info");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [activity, setActivity] = useState<BackupActivity | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadActivity() {
    const payload = await requestJSON<{ activity: BackupActivity }>("/api/backup/status");
    setActivity(payload.activity);
  }

  useEffect(() => {
    void loadActivity().catch(() => undefined);
  }, []);

  async function exportBackup() {
    setBusy(true);
    setMessage("");
    try {
      const response = await requestAPI("/api/backup/export");
      if (!response.ok) {
        let code = "backup_failed";
        try {
          const payload = await response.json();
          code = payload?.error || code;
        } catch {}
        throw new Error(code);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const filename = filenameMatch?.[1] || "know-me-backup.zip";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      await loadActivity();
      setMessageTone("success");
      setMessage("备份已导出");
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "backup_failed");
    } finally {
      setBusy(false);
    }
  }

  async function inspect(file: File) {
    setBusy(true);
    setMessage("");
    setPreview(null);
    setPendingFile(file);
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await requestAPI("/api/backup/preview", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "restore_failed");
      setPreview(payload.preview as BackupPreview);
    } catch (error) {
      setPendingFile(null);
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "restore_failed");
    } finally {
      setBusy(false);
    }
  }

  async function restore(file: File) {
    setBusy(true);
    setMessageTone("info");
    setMessage("正在恢复…");
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await requestAPI("/api/backup/restore", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "restore_failed");
      setPendingFile(null);
      setPreview(null);
      setMessageTone("success");
      setMessage(`恢复完成：${payload.result.posts} 篇文章，${payload.result.navigationItems} 个导航项，${payload.result.media} 个媒体记录。正在刷新站点状态…`);
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "restore_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminTitle eyebrow="BACKUP" title="备份与恢复" description="完整备份站点内容、设置、导航、博客与媒体；管理员凭据和活动 Session 不包含在备份中。" />
      <section className="km-panel km-backup-activity">
        <div><span>最近导出</span><strong>{activity?.lastExportAt ? new Date(activity.lastExportAt).toLocaleString("zh-CN") : "暂无记录"}</strong></div>
        <div><span>最近恢复</span><strong>{activity?.lastRestoreAt ? new Date(activity.lastRestoreAt).toLocaleString("zh-CN") : "暂无记录"}</strong></div>
        {activity?.lastRestoreSourceAt ? <div><span>恢复来源</span><strong>v{activity.lastRestoreVersion || "?"} · {new Date(activity.lastRestoreSourceAt).toLocaleString("zh-CN")} · {activity.lastRestorePosts} 篇文章 · {activity.lastRestoreMedia} 个媒体</strong></div> : null}
      </section>
      <section className="km-panel km-backup-card">
        <div><strong>完整备份</strong><p>下载当前站点 ZIP。恢复前也建议先导出一次当前状态。</p></div>
        <button type="button" className="dk-button dk-button-primary" disabled={busy} onClick={() => void exportBackup()}>{busy && !pendingFile ? "导出中…" : "下载 ZIP"}</button>
      </section>
      <section className="km-panel km-backup-card">
        <div><strong>恢复备份</strong><p>选择 Know Me ZIP 后会先检查格式、版本和内容数量，不会立即覆盖数据。</p></div>
        <label className="dk-button">{busy && pendingFile && !preview ? "检查中…" : "选择 ZIP"}<input hidden disabled={busy} type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void inspect(file); event.currentTarget.value = ""; }} /></label>
      </section>

      {pendingFile && preview ? (
        <div className="km-modal-backdrop" onMouseDown={() => { if (!busy) { setPendingFile(null); setPreview(null); } }}>
          <section className="km-panel km-backup-preview" role="dialog" aria-modal="true" aria-labelledby="km-backup-preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span className="km-eyebrow">RESTORE PREVIEW</span><h2 id="km-backup-preview-title">恢复前确认</h2><p>{pendingFile.name}</p></div>
              <button type="button" aria-label="关闭" disabled={busy} onClick={() => { setPendingFile(null); setPreview(null); }}>×</button>
            </header>
            <div className={"km-backup-compat " + (preview.compatible ? "is-ok" : "is-error")}>
              <strong>{preview.compatible ? "可以恢复" : "当前版本不兼容"}</strong>
              <span>{preview.format || "未知格式"} · v{preview.version || 0}</span>
            </div>
            <dl className="km-backup-preview-grid">
              <div><dt>导出时间</dt><dd>{preview.exportedAt ? new Date(preview.exportedAt).toLocaleString("zh-CN") : "未知"}</dd></div>
              <div><dt>文章</dt><dd>{preview.posts}</dd></div>
              <div><dt>导航项</dt><dd>{preview.navigationItems}</dd></div>
              <div><dt>媒体记录</dt><dd>{preview.media}</dd></div>
              <div><dt>媒体文件</dt><dd>{preview.uploadFiles}</dd></div>
              <div><dt>设置记录</dt><dd>{preview.settings}</dd></div>
            </dl>
            <div className="dk-message is-danger">恢复会替换当前站点内容、导航、设置和媒体。管理员账号与当前登录会话不会被替换。</div>
            <footer>
              <button type="button" className="dk-button" disabled={busy} onClick={() => { setPendingFile(null); setPreview(null); }}>取消</button>
              <button type="button" className="dk-button km-danger-button" disabled={busy || !preview.compatible} onClick={() => void restore(pendingFile)}>{busy ? "恢复中…" : "确认恢复"}</button>
            </footer>
          </section>
        </div>
      ) : null}
      {message ? <Toast message={messageTone === "error" ? errorText(message) : message} tone={messageTone} onClose={() => setMessage("")} duration={messageTone === "info" ? 12000 : 5000} /> : null}
    </>
  );
}
