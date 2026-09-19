import { FormEvent, useEffect, useMemo, useState } from "react";
import { getSession, logout, requestJSON } from "../api";
import type { PostRecord, SessionUser, SiteSettings } from "../types";
import { AdminShell, AdminTitle, ErrorCard, LoadingCard } from "../ui";
import { MediaManager } from "./admin/media-manager";
import { NavigationManager } from "./admin/navigation-manager";
import { PostEditor } from "./admin/post-editor";
import { TaxonomyManager } from "./admin/taxonomy-manager";

export function AdminPage({
  settings,
  path,
  onSettingsChange
}: {
  settings: SiteSettings;
  path: string;
  onSettingsChange: (settings: SiteSettings) => void;
}) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    void getSession()
      .then((value) => {
        setUser(value);
        if (!value) {
          const next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.replace("/login?next=" + next);
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "auth_failed"));
  }, []);

  if (error) return <main className="km-boot"><ErrorCard message={error} /></main>;
  if (!user) return <main className="km-boot"><LoadingCard text="正在验证管理会话…" /></main>;

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
  else content = <DashboardAdmin />;

  return (
    <AdminShell settings={settings} user={user} current={current}>
      <div className="km-admin-top-actions">
        <span>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}</span>
        <button className="dk-button" type="button" onClick={() => void logout().finally(() => { window.location.href = "/"; })}>退出登录</button>
      </div>
      {content}
    </AdminShell>
  );
}

function DashboardAdmin() {
  return (
    <>
      <AdminTitle eyebrow="DASHBOARD" title="管理总览" description="Native Runtime 已接管数据和 API，后台入口现在都是独立路由。" />
      <section className="km-admin-card-grid">
        {[
          ["/admin/navigation", "起始页导航", "管理分组、链接、文件夹与 iTab 数据"],
          ["/admin/posts", "博客文章", "Markdown 编辑、历史版本与发布"],
          ["/admin/taxonomy", "分类与标签", "独立维护文章分类和标签"],
          ["/admin/media", "媒体库", "图片上传、复制地址与删除"],
          ["/admin/settings", "站点设置", "主页、主题与公开策略"],
          ["/admin/backup", "备份恢复", "完整内容和媒体 ZIP"]
        ].map(([href, title, text]) => (
          <a className="km-panel km-admin-card" href={href} key={href}>
            <span>OPEN</span><strong>{title}</strong><p>{text}</p><b>→</b>
          </a>
        ))}
      </section>
      <section className="km-panel km-admin-note">
        <strong>Native Web</strong>
        <p>左侧菜单现在每项都是独立 URL；不会再通过同一个长页面滚动定位。刷新任意后台地址也会由 Go SPA fallback 正常恢复。</p>
      </section>
    </>
  );
}

function SettingsAdmin({ settings, onChange }: { settings: SiteSettings; onChange: (settings: SiteSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function update<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
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
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminTitle eyebrow="SETTINGS" title="站点设置" description="个人主页、起始页、主题和入口配置都保存在 SQLite；CLI 运行配置单独位于 ~/.config/know-me。" />
      <form className="km-panel km-admin-form" onSubmit={save}>
        <div className="km-form-grid">
          <label className="dk-field">名称<input value={draft.profileName} onChange={(e) => update("profileName", e.target.value)} /></label>
          <label className="dk-field">短描述<input value={draft.profileTagline} onChange={(e) => update("profileTagline", e.target.value)} /></label>
          <label className="dk-field km-span-2">简介<textarea rows={4} value={draft.profileBio} onChange={(e) => update("profileBio", e.target.value)} /></label>
          <label className="dk-field">头像 URL<input value={draft.avatarUrl} onChange={(e) => update("avatarUrl", e.target.value)} /></label>
          <label className="dk-field">主页背景 URL<input value={draft.homeBackgroundUrl} onChange={(e) => update("homeBackgroundUrl", e.target.value)} /></label>
          <label className="dk-field">起始页背景 URL<input value={draft.startBackgroundUrl} onChange={(e) => update("startBackgroundUrl", e.target.value)} /></label>
          <label className="dk-field">今日短句<input value={draft.quote} onChange={(e) => update("quote", e.target.value)} /></label>
          <label className="dk-field">短句署名<input value={draft.quoteAuthor} onChange={(e) => update("quoteAuthor", e.target.value)} /></label>
          <label className="dk-field">主题模式<select value={draft.themeMode} onChange={(e) => update("themeMode", e.target.value as SiteSettings["themeMode"])}><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
          <label className="dk-field">主题包<select value={draft.themePreset} onChange={(e) => update("themePreset", e.target.value as SiteSettings["themePreset"])}><option value="aurora">极光</option><option value="ocean">海洋</option><option value="forest">森林</option><option value="sunset">落日</option></select></label>
          <label className="dk-field">默认搜索<select value={draft.defaultSearchEngine} onChange={(e) => update("defaultSearchEngine", e.target.value as SiteSettings["defaultSearchEngine"])}><option>Bing</option><option>Google</option><option>DuckDuckGo</option></select></label>
          <label className="dk-field">起始页密度<select value={draft.startDensity} onChange={(e) => update("startDensity", e.target.value as SiteSettings["startDensity"])}><option value="compact">紧凑</option><option value="comfortable">舒适</option><option value="spacious">宽松</option></select></label>
          <label className="dk-field">卡片透明度 <b>{draft.startCardOpacity}%</b><input type="range" min={30} max={95} value={draft.startCardOpacity} onChange={(e) => update("startCardOpacity", Number(e.target.value))} /></label>
          <label className="dk-field">卡片圆角 <b>{draft.startCardRadius}px</b><input type="range" min={12} max={32} value={draft.startCardRadius} onChange={(e) => update("startCardRadius", Number(e.target.value))} /></label>
          <label className="dk-field">背景压暗 <b>{draft.startBackgroundDim}%</b><input type="range" min={0} max={90} value={draft.startBackgroundDim} onChange={(e) => update("startBackgroundDim", Number(e.target.value))} /></label>
          <label className="km-check"><input type="checkbox" checked={draft.startPublic} onChange={(e) => update("startPublic", e.target.checked)} /><span><strong>公开起始页</strong><small>关闭后未登录访客无法查看导航。</small></span></label>
        </div>

        <section className="km-settings-collection">
          <header><div><span className="km-eyebrow">SOCIAL</span><h3>主页链接</h3></div><button type="button" className="dk-button" onClick={() => setDraft((current) => ({ ...current, socialLinks: [...current.socialLinks, { id: "social-" + Date.now(), label: "", url: "" }] }))}>新增</button></header>
          <div className="km-settings-rows">
            {draft.socialLinks.map((item, index) => (
              <div key={item.id}>
                <input value={item.label} onChange={(e) => updateSocial(index, "label", e.target.value)} placeholder="名称" />
                <input value={item.url} onChange={(e) => updateSocial(index, "url", e.target.value)} placeholder="https://..." />
                <button type="button" onClick={() => setDraft((current) => ({ ...current, socialLinks: current.socialLinks.filter((_, i) => i !== index) }))}>删除</button>
              </div>
            ))}
            {!draft.socialLinks.length ? <p className="km-muted">没有额外社交链接。</p> : null}
          </div>
        </section>

        <section className="km-settings-collection">
          <header><div><span className="km-eyebrow">EXPLORE</span><h3>主页入口</h3></div><button type="button" className="dk-button" onClick={() => setDraft((current) => ({ ...current, homeEntries: [...current.homeEntries, { id: "entry-" + Date.now(), name: "", description: "", url: "/", newTab: false }] }))}>新增</button></header>
          <div className="km-settings-rows is-entry">
            {draft.homeEntries.map((item, index) => (
              <div key={item.id}>
                <input value={item.name} onChange={(e) => updateHomeEntry(index, "name", e.target.value)} placeholder="名称" />
                <input value={item.description} onChange={(e) => updateHomeEntry(index, "description", e.target.value)} placeholder="说明" />
                <input value={item.url} onChange={(e) => updateHomeEntry(index, "url", e.target.value)} placeholder="/blog" />
                <label className="km-settings-checkbox"><input type="checkbox" checked={item.newTab} onChange={(e) => setDraft((current) => ({ ...current, homeEntries: current.homeEntries.map((entry, i) => i === index ? { ...entry, newTab: e.target.checked } : entry) }))} />新窗口</label>
                <button type="button" onClick={() => setDraft((current) => ({ ...current, homeEntries: current.homeEntries.filter((_, i) => i !== index) }))}>删除</button>
              </div>
            ))}
          </div>
        </section>

        <section className="km-settings-collection">
          <header><div><span className="km-eyebrow">PROJECTS</span><h3>项目与作品</h3></div><button type="button" className="dk-button" onClick={() => setDraft((current) => ({ ...current, projects: [...current.projects, { id: "project-" + Date.now(), name: "", description: "", url: "", tag: "" }] }))}>新增</button></header>
          <div className="km-settings-rows is-project">
            {draft.projects.map((item, index) => (
              <div key={item.id}>
                <input value={item.name} onChange={(e) => updateProject(index, "name", e.target.value)} placeholder="项目名称" />
                <input value={item.tag} onChange={(e) => updateProject(index, "tag", e.target.value)} placeholder="标签" />
                <input value={item.url} onChange={(e) => updateProject(index, "url", e.target.value)} placeholder="https://..." />
                <input value={item.description} onChange={(e) => updateProject(index, "description", e.target.value)} placeholder="项目说明" />
                <button type="button" onClick={() => setDraft((current) => ({ ...current, projects: current.projects.filter((_, i) => i !== index) }))}>删除</button>
              </div>
            ))}
            {!draft.projects.length ? <p className="km-muted">还没有项目卡片。</p> : null}
          </div>
        </section>

        <div className="km-form-actions"><button className="dk-button dk-button-primary" disabled={busy}>{busy ? "保存中…" : "保存设置"}</button>{message ? <span>{message}</span> : null}</div>
      </form>
    </>
  );
}

function PostsAdmin() {
  const [posts, setPosts] = useState<PostRecord[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    void requestJSON<{ posts: PostRecord[] }>("/api/posts")
      .then((value) => setPosts(value.posts))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "blog_failed"));
  }, []);

  const filtered = useMemo(() => {
    if (!posts) return [];
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return posts;
    return posts.filter((post) =>
      [post.title, post.slug, post.excerpt, ...post.tags, ...post.categories]
        .some((value) => value.toLocaleLowerCase().includes(needle))
    );
  }, [posts, query]);

  return (
    <>
      <div className="km-admin-title-with-action">
        <AdminTitle eyebrow="BLOG" title="文章" description="Markdown 编辑器、发布、定时发布和历史版本都已经迁到 Native Web。" />
        <a className="dk-button dk-button-primary" href="/admin/posts/new">新建文章</a>
      </div>
      {error ? <ErrorCard message={error} /> : !posts ? <LoadingCard /> : (
        <>
          <div className="km-panel km-list-filter"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、Slug、标签…" /><span>{filtered.length} / {posts.length}</span></div>
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
            {!filtered.length ? <p className="km-muted">没有匹配的文章。</p> : null}
          </section>
        </>
      )}
    </>
  );
}

function BackupAdmin() {
  const [message, setMessage] = useState("");

  async function restore(file: File) {
    if (!window.confirm("恢复备份会替换站点内容、导航和媒体，管理员账号与当前会话不会被替换。继续？")) return;
    setMessage("正在恢复…");
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await fetch("/api/backup/restore", { method: "POST", body: form, credentials: "same-origin" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "restore_failed");
      setMessage(`恢复完成：${payload.result.posts} 篇文章，${payload.result.navigationItems} 个导航项，${payload.result.media} 个媒体记录。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "恢复失败");
    }
  }

  return (
    <>
      <AdminTitle eyebrow="BACKUP" title="备份与恢复" description="备份格式保持 know_me_backup v1，与原 Node 版本兼容。" />
      <section className="km-panel km-backup-card">
        <div><strong>完整备份</strong><p>包含站点内容、设置、导航、博客数据和媒体，不包含管理员凭据与活动 Session。</p></div>
        <a className="dk-button dk-button-primary" href="/api/backup/export">下载 ZIP</a>
      </section>
      <section className="km-panel km-backup-card">
        <div><strong>恢复备份</strong><p>选择已有 Know Me ZIP。恢复前建议先下载一次当前备份。</p></div>
        <label className="dk-button">选择 ZIP<input hidden type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void restore(file); event.currentTarget.value = ""; }} /></label>
      </section>
      {message ? <div className="dk-message">{message}</div> : null}
    </>
  );
}
