import { FormEvent, useEffect, useMemo, useState } from "react";
import { logout, requestAPI, requestJSON } from "../api";
import { applyTheme, loadThemeCatalog, validGradientPacks, type ThemeCatalog } from "../kit";
import { validateMediaFile } from "../media";
import { dailyQuote, enabledQuoteCount } from "../daily-quotes";
import { HOME_ENTRY_LINK_PRESETS, homeEntryPreset, validHomeEntryLink } from "../home-entry-links";
import { START_SEARCH_ENGINES, validSearchEngineURL } from "../start-search-engines";
import { MANAGED_SITE_ROUTES, managedSiteRoute } from "../route-access";
import type { HomeEntryVisibility, MediaRecord, NavGroup, NavItem, PostRecord, SessionUser, SiteSettings } from "../types";
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
  else if (path === "/admin/about") content = <AboutAdmin />;
  else if (path === "/admin") content = <DashboardAdmin />;
  else content = <AdminNotFound />;

  return (
    <AdminShell settings={settings} user={user} current={current} onLogout={() => void logout().finally(() => { window.location.href = "/"; })}>
      <div className="km-admin-top-actions">
        <button className="dk-button" type="button" onClick={() => void logout().finally(() => { window.location.href = "/"; })}>退出登录</button>
      </div>
      {content}
    </AdminShell>
  );
}

type HealthInfo = {
  status: string;
  database: string;
  version: string;
  commit: string;
  build_time: string;
  os: string;
  arch: string;
  uptime_sec: number;
  time: string;
};

function formatUptime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return days + " 天 " + hours + " 小时";
  if (hours) return hours + " 小时 " + minutes + " 分钟";
  return minutes + " 分钟";
}

function formatHealthTime(value: string) {
  if (!value || value === "unknown") return "开发构建 / 未注入";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN");
}

type DesktopUpdateStatus = {
  available: boolean;
  state: string;
  channel: string;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  releaseName?: string;
  releaseUrl?: string;
  publishedAt?: string;
  prerelease: boolean;
  assetName?: string;
  assetSize?: number;
  downloaded?: number;
  total?: number;
  verified: boolean;
  sha256?: string;
  downloadPath?: string;
  installationMode: string;
  canAutoInstall: boolean;
  message?: string;
  error?: string;
};

function formatBytes(value = 0) {
  const bytes = Math.max(0, value || 0);
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2) + " " + unit;
}

function installationModeLabel(mode: string) {
  if (mode === "user") return "Windows 用户安装";
  if (mode === "machine") return "Windows 机器安装";
  if (mode === "portable") return "Portable";
  return mode || "未知安装方式";
}

async function parseDesktopUpdateResponse(response: Response) {
  const payload = await response.json().catch(() => ({})) as {
    status?: DesktopUpdateStatus;
    error?: string;
    detail?: string;
  } & Partial<DesktopUpdateStatus>;
  if (response.ok) {
    return { status: payload as DesktopUpdateStatus, error: "" };
  }
  return {
    status: payload.status ?? null,
    error: payload.detail || payload.error || ("HTTP " + response.status)
  };
}

function AboutAdmin() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null);
  const [updateError, setUpdateError] = useState("");
  const [updateBusy, setUpdateBusy] = useState<"" | "check" | "download" | "install">("");

  async function load(silent = false) {
    if (!silent) setRefreshing(true);
    try {
      const value = await requestJSON<HealthInfo>("/api/health");
      setHealth(value);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "dashboard_failed");
    } finally {
      if (!silent) setRefreshing(false);
    }
  }

  async function loadUpdateStatus(silent = false) {
    try {
      const response = await requestAPI("/api/desktop/update");
      if (response.status === 404) {
        setUpdateStatus(null);
        setUpdateError("");
        return;
      }
      const result = await parseDesktopUpdateResponse(response);
      if (result.status) setUpdateStatus(result.status);
      if (!response.ok) {
        if (!silent) setUpdateError(result.error);
        return;
      }
      setUpdateError("");
    } catch (reason) {
      if (!silent) setUpdateError(reason instanceof Error ? reason.message : "update_status_failed");
    }
  }

  async function runUpdateAction(action: "check" | "download" | "install") {
    setUpdateBusy(action);
    setUpdateError("");
    try {
      const response = await requestAPI("/api/desktop/update/" + action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      const result = await parseDesktopUpdateResponse(response);
      if (result.status) setUpdateStatus(result.status);
      if (!response.ok) {
        setUpdateError(result.error);
        return;
      }
      if (action === "check") {
        setMessage(result.status?.updateAvailable ? "发现可用更新" : "当前已是最新版本");
      } else if (action === "download") {
        setMessage("已开始下载更新");
      } else {
        setMessage("安装程序已启动，Know Me 即将退出并在升级后重新打开");
      }
    } catch (reason) {
      setUpdateError(reason instanceof Error ? reason.message : "update_action_failed");
    } finally {
      setUpdateBusy("");
    }
  }

  useEffect(() => {
    void load(true);
    void loadUpdateStatus(true);
  }, []);

  useEffect(() => {
    if (updateStatus?.state !== "downloading") return;
    const timer = window.setInterval(() => void loadUpdateStatus(true), 500);
    return () => window.clearInterval(timer);
  }, [updateStatus?.state]);

  async function copyDiagnostics() {
    if (!health) return;
    const text = [
      "Know Me diagnostics",
      "version: " + (health.version || "dev"),
      "commit: " + (health.commit || "unknown"),
      "build_time: " + (health.build_time || "unknown"),
      "platform: " + (health.os || "unknown") + "/" + (health.arch || "unknown"),
      "status: " + health.status,
      "database: " + health.database,
      "uptime_sec: " + health.uptime_sec,
      "server_time: " + health.time,
      ...(updateStatus ? [
        "update_state: " + updateStatus.state,
        "update_channel: " + updateStatus.channel,
        "installation_mode: " + updateStatus.installationMode
      ] : [])
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage("诊断信息已复制");
      setError("");
    } catch {
      setError("复制失败，请手动复制版本和 Commit");
    }
  }

  const downloaded = updateStatus?.downloaded || 0;
  const total = updateStatus?.total || 0;
  const progress = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
  const updateLocked = updateBusy !== "" || updateStatus?.state === "downloading" || updateStatus?.state === "installing";

  return (
    <>
      <AdminTitle eyebrow="ABOUT" title="关于" description="查看当前 Know Me 的版本、构建信息、运行状态与桌面更新。" />
      {error && !health ? <ErrorCard message={error} onRetry={() => void load()} /> : !health ? <LoadingCard text="正在读取版本信息…" /> : (
        <>
          <section className="km-panel km-about-hero">
            <div>
              <span className="km-eyebrow">KNOW ME</span>
              <h2>{health.version || "dev"}</h2>
              <p>当前运行实例的版本信息来自实际后端进程，不依赖页面缓存。</p>
            </div>
            <span className={"km-health-badge " + (health.status === "ok" ? "is-ok" : "is-warning")}>
              {health.status === "ok" ? "运行正常" : "状态异常"}
            </span>
          </section>

          <section className="km-about-grid">
            <div className="km-panel"><span>版本</span><strong>{health.version || "dev"}</strong></div>
            <div className="km-panel"><span>Commit</span><strong className="is-mono">{health.commit || "unknown"}</strong></div>
            <div className="km-panel"><span>构建时间</span><strong>{formatHealthTime(health.build_time)}</strong></div>
            <div className="km-panel"><span>运行平台</span><strong className="is-mono">{(health.os || "unknown") + "/" + (health.arch || "unknown")}</strong></div>
            <div className="km-panel"><span>运行时长</span><strong>{formatUptime(health.uptime_sec)}</strong></div>
            <div className="km-panel"><span>数据库</span><strong>{health.database === "ok" ? "正常" : "异常"}</strong></div>
            <div className="km-panel"><span>服务时间</span><strong>{formatHealthTime(health.time)}</strong></div>
          </section>

          {updateStatus ? (
            <section className="km-panel km-update-card">
              <div className="km-update-heading">
                <div>
                  <span className="km-eyebrow">DESKTOP UPDATE</span>
                  <h3>应用更新</h3>
                  <p>{updateStatus.message || "检查 GitHub Release 并下载经过 SHA256 校验的更新。"}</p>
                </div>
                <div className="km-update-badges">
                  <span>{updateStatus.channel === "prerelease" ? "预发布通道" : "稳定通道"}</span>
                  <span>{installationModeLabel(updateStatus.installationMode)}</span>
                </div>
              </div>

              <div className="km-update-version-row">
                <div><span>当前版本</span><strong>{updateStatus.currentVersion || health.version || "dev"}</strong></div>
                <div><span>最新版本</span><strong>{updateStatus.latestVersion || "尚未检查"}</strong></div>
                <div><span>安装方式</span><strong>{updateStatus.canAutoInstall ? "可自动安装并重启" : "需要手动安装"}</strong></div>
              </div>

              {updateStatus.releaseName || updateStatus.publishedAt ? (
                <div className="km-update-release">
                  <div>
                    <strong>{updateStatus.releaseName || updateStatus.latestVersion}</strong>
                    <span>{updateStatus.publishedAt ? formatHealthTime(updateStatus.publishedAt) : ""}</span>
                  </div>
                  {updateStatus.releaseUrl ? <a className="dk-button" href={updateStatus.releaseUrl} target="_blank" rel="noreferrer">查看 Release</a> : null}
                </div>
              ) : null}

              {updateStatus.state === "downloading" ? (
                <div className="km-update-progress-block">
                  <div className="km-update-progress-label">
                    <span>下载并校验</span>
                    <strong>{total > 0 ? progress + "%" : formatBytes(downloaded)}</strong>
                  </div>
                  <div className="km-update-progress" aria-label="更新下载进度">
                    <span style={{ width: progress + "%" }} />
                  </div>
                  <small>{formatBytes(downloaded)}{total > 0 ? " / " + formatBytes(total) : ""}</small>
                </div>
              ) : null}

              {updateStatus.verified ? (
                <div className="km-update-verified">
                  <strong>SHA256 校验通过</strong>
                  <code>{updateStatus.sha256}</code>
                  {updateStatus.downloadPath ? <small>{updateStatus.downloadPath}</small> : null}
                </div>
              ) : null}

              {!updateStatus.canAutoInstall && updateStatus.verified ? (
                <div className="dk-message">
                  已下载并校验完成。{updateStatus.installationMode === "portable"
                    ? "当前是 Portable 版本，请手动运行下载的 Setup 完成升级。"
                    : "当前安装方式暂不自动提权，请手动运行下载文件完成升级。"}
                </div>
              ) : null}

              {updateError ? <div className="dk-message is-danger">{updateError}</div> : null}

              <div className="km-update-actions">
                {updateStatus.available && !updateStatus.verified ? (
                  <button type="button" className="dk-button" disabled={updateLocked} onClick={() => void runUpdateAction("check")}>
                    {updateBusy === "check" ? "检查中…" : "检查更新"}
                  </button>
                ) : null}
                {updateStatus.available && updateStatus.updateAvailable && !updateStatus.verified && updateStatus.state !== "downloading" ? (
                  <button type="button" className="dk-button is-primary" disabled={updateLocked} onClick={() => void runUpdateAction("download")}>
                    {updateBusy === "download" ? "准备下载…" : "下载并校验"}
                  </button>
                ) : null}
                {updateStatus.verified && updateStatus.canAutoInstall ? (
                  <button type="button" className="dk-button is-primary" disabled={updateLocked} onClick={() => void runUpdateAction("install")}>
                    {updateBusy === "install" || updateStatus.state === "installing" ? "正在启动安装程序…" : "安装并重启"}
                  </button>
                ) : null}
                {!updateStatus.available ? <span className="km-update-disabled">{updateStatus.message}</span> : null}
              </div>
            </section>
          ) : null}

          <section className="km-panel km-about-actions">
            <div>
              <strong>诊断信息</strong>
              <p>遇到问题时，版本号和 Commit 可以直接用于确认正在运行的具体构建。</p>
            </div>
            <div className="km-about-action-buttons">
              <button type="button" className="dk-button" onClick={() => void copyDiagnostics()}>复制诊断信息</button>
              <button type="button" className="dk-button" disabled={refreshing} onClick={() => void load()}>
                {refreshing ? "刷新中…" : "刷新状态"}
              </button>
            </div>
          </section>
          {message ? <Toast message={message} onClose={() => setMessage("")} /> : null}
          {error ? <div className="dk-message is-danger">{errorText(error)}</div> : null}
        </>
      )}
    </>
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

  async function load() {
    setError("");
    try {
      const [posts, media, navigation, taxonomy, health] = await Promise.all([
        requestJSON<{ posts: PostRecord[] }>("/api/posts?summary=1"),
        requestJSON<{ media: MediaRecord[] }>("/api/media"),
        requestJSON<{ groups: NavGroup[] }>("/api/navigation"),
        requestJSON<{ tags: Array<{ id: number; name: string; count: number }>; categories: Array<{ id: number; name: string; count: number }> }>("/api/taxonomy"),
        requestJSON<{ version: string }>("/api/health")
      ]);
      setData({
        posts: posts.posts ?? [],
        media: media.media ?? [],
        groups: navigation.groups ?? [],
        tags: taxonomy.tags ?? [],
        categories: taxonomy.categories ?? [],
        version: health.version || "dev"
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "dashboard_failed");
    }
  }

  useEffect(() => { void load(); }, []);

  function countItems(items: NavItem[]): number {
    return items.reduce((total, item) => total + 1 + countItems(item.children ?? []), 0);
  }

  if (error) return <><AdminTitle eyebrow="DASHBOARD" title="管理总览" /><ErrorCard message={error} onRetry={() => void load()} /></>;
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
          {!recentPosts.length ? <div className="km-dashboard-empty"><p>还没有文章，可以从这里开始。</p><a className="dk-button dk-button-primary" href="/admin/posts/new">新建文章</a></div> : null}
        </section>

        <section className="km-panel km-dashboard-list">
          <header><div><span className="km-eyebrow">RECENT MEDIA</span><h2>最近媒体</h2></div><a href="/admin/media">查看全部</a></header>
          {recentMedia.map((item) => (
            <a key={item.id} href="/admin/media">
              <span><strong>{item.originalName}</strong><small>{Math.ceil(item.size / 1024)} KB · {new Date(item.createdAt).toLocaleString("zh-CN")}</small></span>
              <b>›</b>
            </a>
          ))}
          {!recentMedia.length ? <div className="km-dashboard-empty"><p>还没有媒体，可以先上传图片。</p><a className="dk-button" href="/admin/media">打开媒体库</a></div> : null}
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

type SettingsSection = "profile" | "start" | "theme" | "content" | "footer" | "network";

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

type NetworkAccessPolicy = { enabled: boolean; allowedHosts: string[]; allowedIPs: string[] };

function networkAccessError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "保存失败";
  const translated: Record<string, string> = {
    invalid_access_policy: "规则不合法：请填写正确的域名、IP 或 CIDR，启用白名单时至少配置一项。",
    current_connection_not_allowed: "新规则不允许你当前的连接。请先加入当前域名和客户端 IP，避免无法进入后台。",
    save_access_policy_failed: "保存访问规则失败，请检查数据目录权限。",
    unauthorized: "请先登录后再修改访问规则。"
  };
  return translated[message] || message;
}

function NetworkAccessSettings() {
  const [value, setValue] = useState<NetworkAccessPolicy | null>(null);
  const [hosts, setHosts] = useState("");
  const [ips, setIPs] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void requestJSON<{policy: NetworkAccessPolicy}>("/api/admin/network-access")
      .then(({policy}) => {
        setValue(policy);
        setHosts((policy.allowedHosts ?? []).join("\n"));
        setIPs((policy.allowedIPs ?? []).join("\n"));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "无法读取网络访问设置"));
  }, []);

  async function savePolicy() {
    if (!value) return;
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const list = (raw: string) => raw.split(/[\n,;]+/).map((text) => text.trim()).filter(Boolean);
      const next = { enabled: value.enabled, allowedHosts: list(hosts), allowedIPs: list(ips) };
      const result = await requestJSON<{policy: NetworkAccessPolicy}>("/api/admin/network-access", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next)
      });
      setValue(result.policy);
      setHosts(result.policy.allowedHosts.join("\n"));
      setIPs(result.policy.allowedIPs.join("\n"));
      setMessage("已保存，立即生效");
    } catch (reason) {
      setError(networkAccessError(reason));
    } finally {
      setSaving(false);
    }
  }

  if (!value) return <section className="km-panel km-admin-form"><p className="km-muted">{error || "正在读取访问规则…"}</p><button className="dk-button" onClick={() => window.location.reload()}>重试</button></section>;
  return (
    <section className="km-panel km-admin-form km-settings-form">
      <header><span className="km-eyebrow">NETWORK</span><h2>网络访问</h2><p>默认允许通过任意域名或 IP 访问。此处只负责可选访问白名单，不改变服务监听地址。</p></header>
      <label className="km-settings-checkbox">
        <input type="checkbox" checked={value.enabled} onChange={(event) => setValue({ ...value, enabled: event.target.checked })} />
        <span>启用域名 / IP 白名单（默认关闭）</span>
      </label>
      <div className="km-form-grid">
        <label className="dk-field">允许的访问域名
          <textarea rows={5} value={hosts} disabled={!value.enabled} onChange={(event) => setHosts(event.target.value)} placeholder={"example.com\nlocalhost"} />
          <small>按行填写；匹配浏览器实际访问的 Host，忽略端口。留空表示不检查域名。</small>
        </label>
        <label className="dk-field">允许的客户端 IP / 网段
          <textarea rows={5} value={ips} disabled={!value.enabled} onChange={(event) => setIPs(event.target.value)} placeholder={"192.168.1.10\n192.168.1.0/24"} />
          <small>支持 IP 和 CIDR；使用实际连接 IP，不盲目信任 X-Forwarded-For。留空表示不检查客户端 IP。</small>
        </label>
      </div>
      <p className="km-muted">同时填写域名和 IP 时，两项必须都符合。启用前请包含你当前访问的域名和客户端 IP，避免把自己锁在后台之外。规则保存在数据目录 network-access.json。</p>
      {error ? <div className="dk-message is-danger">{error}</div> : null}
      {message ? <div className="dk-message">{message}</div> : null}
      <div className="km-form-actions">
        <span className="km-settings-dirty">{value.enabled ? "白名单已准备启用" : "白名单未启用，所有域名和 IP 均可访问"}</span>
        <button type="button" className="dk-button dk-button-primary" disabled={saving} onClick={() => void savePolicy()}>{saving ? "保存中…" : "保存访问设置"}</button>
      </div>
    </section>
  );
}

function SettingsAdmin({ settings, onChange }: { settings: SiteSettings; onChange: (settings: SiteSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [section, setSection] = useState<SettingsSection>(
    () => new URLSearchParams(window.location.search).get("section") === "start" ? "start" : "profile"
  );
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [busy, setBusy] = useState(false);
  const [quoteEditorOpen, setQuoteEditorOpen] = useState(false);
  const [catalog, setCatalog] = useState<ThemeCatalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [themePalette, setThemePalette] = useState<string[]>([]);
  const [previewWarning, setPreviewWarning] = useState("");
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
    void applyTheme(draft.themeMode, draft.themePreset, draft.themeStyle, draft.themeGradientPacks).then((result) => {
      if (!cancelled) setPreviewWarning(result.warning ?? "");
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
  }, [draft.themeMode, draft.themePreset, draft.themeStyle, draft.themeGradientPacks]);

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
    { name: "aurora", display_name: "极光", description: "离线默认主题", gradient_light: "#6c73d8", gradient_dark: "#8b8df2" },
    { name: "ocean", display_name: "海洋", description: "离线默认主题", gradient_light: "#3279b0", gradient_dark: "#5ba8d2" },
    { name: "forest", display_name: "森林", description: "离线默认主题", gradient_light: "#4e9879", gradient_dark: "#70b890" },
    { name: "sunset", display_name: "落日", description: "离线默认主题", gradient_light: "#e07a67", gradient_dark: "#efa488" }
  ];
  const themePacks = catalog?.packs?.length ? catalog.packs : fallbackThemePacks;
  const selectedTheme = themePacks.find((pack) => pack.name === draft.themePreset);
  const gradientChoices = themePacks.filter((pack) => pack.gradient_light && pack.gradient_dark);
  const gradientNames = draft.themeGradientPacks ?? ["aurora", "ocean"];
  const themeChoices = [
    { label: "极光 · 樱花 · 海洋", packs: ["aurora", "sakura", "ocean"] },
    { label: "森林 · 落日", packs: ["forest", "sunset"] },
    { label: "黑客 · 霓虹", packs: ["terminal", "neon"] }
  ].filter((item) => item.packs.every((name) => gradientChoices.some((pack) => pack.name === name)));
  const gradientStops = gradientNames
    .map((name) => gradientChoices.find((pack) => pack.name === name))
    .map((pack) => draft.themeMode === "dark" ? pack?.gradient_dark : pack?.gradient_light)
    .filter((color): color is string => Boolean(color));
  const gradientSample = gradientStops.length >= 2 ? `linear-gradient(120deg, ${gradientStops.join(", ")})` : undefined;
  function setGradientPacks(names: string[]) {
    update("themeGradientPacks", names);
  }
  const todayQuote = dailyQuote(draft.quotes);
  const quoteCount = enabledQuoteCount(draft.quotes);
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
    void applyTheme(settings.themeMode, settings.themePreset, settings.themeStyle, settings.themeGradientPacks);
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
    if (!draft.searchEngines?.length ||
        draft.searchEngines.some((engine) => !/^[a-z0-9_-]{1,80}$/i.test(engine.id) ||
          !engine.name.trim() || !validSearchEngineURL(engine.url) ||
          Boolean(engine.iconUrl && !/^https:\/\/[^\s]+/i.test(engine.iconUrl))) ||
        new Set(draft.searchEngines.map((item) => item.id)).size !== draft.searchEngines.length ||
        !draft.searchEngines.some((engine) => engine.id === draft.defaultSearchEngine)) {
      setMessageTone("error");
      setMessage("请检查搜索引擎：至少保留一个、名称/ID 不重复，搜索地址必须是 HTTPS 且包含一次 {query}；默认引擎必须有效");
      return;
    }
    if (draft.homeEntries.some((entry) => entry.name.trim() && !validHomeEntryLink(entry.url))) {
      setMessageTone("error");
      setMessage("主页入口链接无效：请选择内置地址，或填写 / 开头的站内路径、#锚点、https:// 外部网址。");
      return;
    }
    if (draft.themeStyle === "gradient" && !validGradientPacks(gradientNames)) {
      setMessageTone("error");
      setMessage("渐变模式需要选择 2～4 个不同的基础主题");
      return;
    }
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
          ["footer", "页脚"],
          ["network", "网络访问"]
        ] as const).map(([value, label]) => (
          <button type="button" key={value} className={section === value ? "is-active" : ""} onClick={() => setSection(value)}>
            {label}
          </button>
        ))}
        <span className={dirty ? "is-dirty" : ""}>{dirty ? "有未保存修改" : "已保存"}</span>
      </nav>

      {section === "network" ? <NetworkAccessSettings /> : <form className="km-panel km-admin-form km-settings-form" onSubmit={save}>
        {section === "profile" ? (
          <section className="km-settings-pane">
            <header><span className="km-eyebrow">PROFILE</span><h2>主页内容</h2><p>设置个人主页的名称、简介、头像和背景。</p></header>
            <div className="km-form-grid">
              <label className="dk-field">名称<input value={draft.profileName} onChange={(event) => update("profileName", event.target.value)} /></label>
              <label className="dk-field">短描述<input value={draft.profileTagline} onChange={(event) => update("profileTagline", event.target.value)} /></label>
              <label className="dk-field km-span-2">简介<textarea rows={4} value={draft.profileBio} onChange={(event) => update("profileBio", event.target.value)} /></label>
              <MediaField label="头像" value={draft.avatarUrl} onChange={(value) => update("avatarUrl", value)} />
              <MediaField label="主页背景" value={draft.homeBackgroundUrl} onChange={(value) => update("homeBackgroundUrl", value)} />
              <label className="km-check"><input type="checkbox" checked={draft.quoteEnabled} onChange={(event) => update("quoteEnabled", event.target.checked)} /><span><strong>显示今日短句</strong><small>关闭后主页不显示短句卡片。</small></span></label>
              <label className="km-check"><input type="checkbox" checked={draft.quoteAuthorEnabled} onChange={(event) => update("quoteAuthorEnabled", event.target.checked)} /><span><strong>显示短句署名</strong><small>仅控制每条短句的署名显示。</small></span></label>
            </div>
            <section className="km-settings-collection km-quote-library">
              <header>
                <div><span className="km-eyebrow">QUOTE LIBRARY</span><h3>短句库</h3>
                  <p className="km-muted">已有短句可单独编辑、停用或排序。主页按访客当地日期依次轮换启用的短句，每天一条、当天刷新不变；不使用 AI。</p>
                  <p className="km-muted">{(draft.quotes ?? []).length} 条短句 · {quoteCount} 条启用</p>
                </div>
                <div className="km-quote-library-top-actions">
                  <button type="button" className="dk-button" aria-expanded={quoteEditorOpen} onClick={() => setQuoteEditorOpen((open) => !open)}>{quoteEditorOpen ? "收起列表" : "管理短句库"}</button>
                  <button type="button" className="dk-button" disabled={(draft.quotes?.length ?? 0) >= 300} onClick={() => {
                    setQuoteEditorOpen(true);
                    setDraft((current) => ({
                      ...current,
                      quotes: [...(current.quotes ?? []), { id: "quote-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6), text: "", author: "", enabled: true }]
                    }));
                  }}>新增短句</button>
                </div>
              </header>
              {quoteEditorOpen ? <div className="km-quote-library-list">
                {(draft.quotes ?? []).map((item, index) => (
                  <div key={item.id} className={"km-quote-library-item" + (!item.enabled ? " is-disabled" : "")}>
                    <div className="km-quote-library-number">{String(index + 1).padStart(2, "0")}</div>
                    <div className="km-quote-library-fields">
                      <label>短句内容
                        <textarea rows={2} maxLength={500} value={item.text} placeholder="输入一句值得记住的话…" onChange={(event) => setDraft((current) => ({
                          ...current, quotes: current.quotes.map((entry, i) => i === index ? { ...entry, text: event.target.value } : entry)
                        }))} />
                      </label>
                      <label>来源 / 署名（可选）
                        <input maxLength={100} value={item.author} placeholder="可留空" onChange={(event) => setDraft((current) => ({
                          ...current, quotes: current.quotes.map((entry, i) => i === index ? { ...entry, author: event.target.value } : entry)
                        }))} />
                      </label>
                    </div>
                    <div className="km-quote-library-actions">
                      <label><input type="checkbox" checked={item.enabled} onChange={(event) => setDraft((current) => ({
                        ...current, quotes: current.quotes.map((entry, i) => i === index ? { ...entry, enabled: event.target.checked } : entry)
                      }))} />启用</label>
                      <button type="button" disabled={index === 0} aria-label={"上移第 " + (index + 1) + " 条短句"} onClick={() => setDraft((current) => {
                        const next = [...current.quotes]; [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        return { ...current, quotes: next };
                      })}>↑</button>
                      <button type="button" disabled={index === draft.quotes.length - 1} aria-label={"下移第 " + (index + 1) + " 条短句"} onClick={() => setDraft((current) => {
                        const next = [...current.quotes]; [next[index], next[index + 1]] = [next[index + 1], next[index]];
                        return { ...current, quotes: next };
                      })}>↓</button>
                      <button type="button" className="is-danger" aria-label={"删除第 " + (index + 1) + " 条短句"} onClick={() => setDraft((current) => ({
                        ...current, quotes: current.quotes.filter((entry) => entry.id !== item.id)
                      }))}>删除</button>
                    </div>
                  </div>
                ))}
                {!(draft.quotes ?? []).length ? <p className="km-muted">短句库为空。新增短句并保存后，主页才会显示今日短句。</p> : null}
              </div> : null}
            </section>
            <div className={"km-settings-quote-preview" + (!(draft.quoteEnabled && todayQuote) ? " is-disabled" : "")} aria-live="polite">
              <div>
                <span className="km-eyebrow">今日短句预览</span>
                <small>{draft.quoteEnabled && todayQuote ? "根据启用列表和当地日期计算，今天保持不变" : "没有可显示的启用短句"}</small>
              </div>
              {draft.quoteEnabled && todayQuote ? (
                <blockquote>
                  <p>{todayQuote.text}</p>
                  {draft.quoteAuthorEnabled && todayQuote.author ? <cite>— {todayQuote.author}</cite> : null}
                </blockquote>
              ) : <p className="km-muted">主页不会显示短句卡片。</p>}
            </div>
          </section>
        ) : null}

        {section === "start" ? (
          <section className="km-settings-pane">
            <header><span className="km-eyebrow">START</span><h2>浏览器起始页</h2><p>控制背景、搜索方式与卡片密度；页面访问权限在「链接与项目」统一管理。</p></header>
            <div className="km-form-grid">
              <MediaField label="Start 背景" value={draft.startBackgroundUrl} onChange={(value) => update("startBackgroundUrl", value)} />
              <label className="dk-field">默认搜索<select value={draft.defaultSearchEngine} onChange={(event) => update("defaultSearchEngine", event.target.value)}>
                {(draft.searchEngines?.length ? draft.searchEngines : START_SEARCH_ENGINES).map((engine) => <option key={engine.id} value={engine.id}>{engine.name || engine.id}</option>)}
              </select></label>
              <label className="dk-field">起始页密度<select value={draft.startDensity} onChange={(event) => update("startDensity", event.target.value as SiteSettings["startDensity"])}><option value="compact">紧凑</option><option value="comfortable">舒适</option><option value="spacious">宽松</option></select></label>
              <label className="dk-field">卡片透明度 <b>{draft.startCardOpacity}%</b><input type="range" min={30} max={95} value={draft.startCardOpacity} onChange={(event) => update("startCardOpacity", Number(event.target.value))} /></label>
              <label className="dk-field">卡片圆角 <b>{draft.startCardRadius}px</b><input type="range" min={12} max={32} value={draft.startCardRadius} onChange={(event) => update("startCardRadius", Number(event.target.value))} /></label>
              <label className="dk-field">背景压暗 <b>{draft.startBackgroundDim}%</b><input type="range" min={0} max={90} value={draft.startBackgroundDim} onChange={(event) => update("startBackgroundDim", Number(event.target.value))} /></label>
            </div>
            <section className="km-settings-collection km-search-engines-editor">
              <header>
                <div><span className="km-eyebrow">SEARCH ENGINES</span><h3>搜索引擎管理</h3>
                  <p className="km-muted">引擎列表与默认项对整个站点生效；Start 会记住当前浏览器的手动选择，可随时恢复站点默认。最多 12 个，搜索地址使用 <code>{"{query}"}</code> 作为关键词占位符。</p>
                </div>
                <button type="button" className="dk-button" disabled={(draft.searchEngines?.length ?? 0) >= 12}
                  onClick={() => setDraft((current) => ({
                    ...current,
                    searchEngines: [...(current.searchEngines ?? []), { id: "custom_" + Date.now().toString(36), name: "", url: "https://example.com/search?q={query}", iconUrl: "" }]
                  }))}>新增引擎</button>
              </header>
              <div className="km-search-engine-list">
                {(draft.searchEngines ?? []).map((engine, index) => (
                  <div className="km-search-engine-entry" key={engine.id}>
                    <div className="km-search-engine-heading">
                      <span className="km-search-engine-glyph" aria-hidden="true">{engine.name?.trim().slice(0, 1) || "⌕"}</span>
                      <strong>{engine.name || "新搜索引擎"}</strong>
                      <label className="km-search-engine-default"><input type="radio" name="defaultSearchEngine" checked={draft.defaultSearchEngine === engine.id} onChange={() => update("defaultSearchEngine", engine.id)} />设为默认</label>
                    </div>
                    <div className="km-search-engine-fields">
                      <label>名称<input aria-label={"搜索引擎 " + index + " 名称"} value={engine.name} onChange={(e) => setDraft((current) => ({
                        ...current, searchEngines: current.searchEngines.map((item, i) => i === index ? { ...item, name: e.target.value } : item)
                      }))} placeholder="如：必应、Google 或公司内搜索" /></label>
                      <label>搜索地址<input aria-label={"搜索引擎 " + index + " 搜索地址"} value={engine.url} onChange={(e) => setDraft((current) => ({
                        ...current, searchEngines: current.searchEngines.map((item, i) => i === index ? { ...item, url: e.target.value } : item)
                      }))} placeholder="https://example.com/search?q={query}" /></label>
                      <label>图标地址（可留空）<input aria-label={"搜索引擎 " + index + " 图标地址"} value={engine.iconUrl ?? ""} onChange={(e) => setDraft((current) => ({
                        ...current, searchEngines: current.searchEngines.map((item, i) => i === index ? { ...item, iconUrl: e.target.value } : item)
                      }))} placeholder="https://example.com/favicon.ico" /></label>
                    </div>
                    <div className="km-search-engine-actions">
                      <button type="button" disabled={index === 0} onClick={() => setDraft((current) => {
                        const next = [...current.searchEngines]; [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        return { ...current, searchEngines: next };
                      })}>上移</button>
                      <button type="button" disabled={index === draft.searchEngines.length - 1} onClick={() => setDraft((current) => {
                        const next = [...current.searchEngines]; [next[index], next[index + 1]] = [next[index + 1], next[index]];
                        return { ...current, searchEngines: next };
                      })}>下移</button>
                      <button type="button" className="is-danger" disabled={draft.searchEngines.length < 2} onClick={() => setDraft((current) => {
                        const next = current.searchEngines.filter((item) => item.id !== engine.id);
                        return { ...current, searchEngines: next, defaultSearchEngine: current.defaultSearchEngine === engine.id ? next[0]?.id ?? "Bing" : current.defaultSearchEngine };
                      })}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </section>
        ) : null}

        {section === "theme" ? (
          <section className="km-settings-pane">
            <header><span className="km-eyebrow">THEME</span><h2>主题与外观</h2><p>修改会立即预览；只有点击保存后才会写入站点配置。</p></header>
            <div className="km-form-grid">
              <label className="dk-field">主题模式<select value={draft.themeMode} onChange={(event) => update("themeMode", event.target.value as SiteSettings["themeMode"])}><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
              <div className="dk-field km-theme-picker">
                <span>主题风格</span>
                <div className="km-theme-style-switch" role="group" aria-label="选择主题风格">
                  <button type="button" className={draft.themeStyle !== "gradient" ? "is-active" : ""} aria-pressed={draft.themeStyle !== "gradient"}
                    onClick={() => update("themeStyle", "solid")}>普通主题</button>
                  <button type="button" className={draft.themeStyle === "gradient" ? "is-active" : ""} aria-pressed={draft.themeStyle === "gradient"}
                    onClick={() => update("themeStyle", "gradient")}>渐变主题</button>
                </div>
                <div className="km-theme-picker-row">
                  {draft.themeStyle !== "gradient" ? (
                    <select aria-label="选择普通主题" value={draft.themePreset} onChange={(event) => update("themePreset", event.target.value)}>
                      {!themePacks.some((pack) => pack.name === draft.themePreset) ? <option value={draft.themePreset}>{draft.themePreset}</option> : null}
                      {themePacks.map((pack) => <option key={pack.name} value={pack.name}>{pack.display_name} · {pack.name}</option>)}
                    </select>
                  ) : <span className="km-theme-mode-hint">组合 2～4 个主题，按选择顺序渐变</span>}
                  <button type="button" className="dk-button" onClick={() => void refreshThemes()}>刷新主题</button>
                </div>
                {draft.themeStyle === "gradient" ? (
                  <div className="km-theme-gradient-editor">
                    {themeChoices.length ? (
                      <div className="km-theme-gradient-presets" role="group" aria-label="推荐渐变组合">
                        {themeChoices.map((preset) => (
                          <button type="button" key={preset.label} className="km-theme-preset"
                            aria-pressed={preset.packs.join(",") === gradientNames.join(",")}
                            onClick={() => setGradientPacks([...preset.packs])}>{preset.label}</button>
                        ))}
                      </div>
                    ) : null}
                    <div className="km-theme-gradient-list" aria-label="渐变主题顺序">
                      {gradientNames.map((name, index) => (
                        <div className="km-theme-gradient-item" key={name + "-" + index}>
                          <span className="km-theme-gradient-index">{index + 1}</span>
                          <select aria-label={`第 ${index + 1} 个基础主题`} value={name}
                            onChange={(event) => setGradientPacks(gradientNames.map((pack, i) => i === index ? event.target.value : pack))}
                          >
                            {!gradientChoices.some((pack) => pack.name === name) ? <option value={name}>{name}（不可用）</option> : null}
                            {gradientChoices.map((pack) => (
                              <option key={pack.name} value={pack.name} disabled={gradientNames.includes(pack.name) && pack.name !== name}>
                                {pack.display_name} · {pack.name}
                              </option>
                            ))}
                          </select>
                          <button type="button" title="上移" aria-label={`上移 ${name}`} disabled={index === 0} onClick={() => setGradientPacks(gradientNames.map((pack, i) => i === index ? gradientNames[i - 1] : i === index - 1 ? name : pack))}>↑</button>
                          <button type="button" title="下移" aria-label={`下移 ${name}`} disabled={index === gradientNames.length - 1} onClick={() => setGradientPacks(gradientNames.map((pack, i) => i === index ? gradientNames[i + 1] : i === index + 1 ? name : pack))}>↓</button>
                          <button type="button" title="移除" aria-label={`移除 ${name}`} disabled={gradientNames.length <= 2} onClick={() => setGradientPacks(gradientNames.filter((_, i) => i !== index))}>×</button>
                        </div>
                      ))}
                    </div>
                    {gradientNames.length < 4 ? (
                      <select aria-label="添加基础主题" value="" onChange={(event) => { if (event.target.value) setGradientPacks([...gradientNames, event.target.value]); }}>
                        <option value="">＋ 添加基础主题</option>
                        {gradientChoices.filter((pack) => !gradientNames.includes(pack.name)).map((pack) => (
                          <option key={pack.name} value={pack.name}>{pack.display_name} · {pack.name}</option>
                        ))}
                      </select>
                    ) : null}
                    <div className="km-theme-gradient-demo" style={gradientSample ? { background: gradientSample } : undefined} aria-label="渐变配色预览">
                      <span>背景 · 卡片 · 导航</span><strong>渐变效果预览</strong>
                    </div>
                    <small>页面可组合全部颜色；主按钮由 Kit 仅使用首尾双色，其他按钮保持原样。</small>
                    {previewWarning ? <small role="status" className="km-theme-preview-warning">预览已回退：{previewWarning}</small> : null}
                  </div>
                ) : (
                  <>
                    <div className="km-theme-preview" aria-label="当前主题配色预览">
                      {themePalette.map((color, index) => <span key={index} style={{ background: color }} title={color} />)}
                    </div>
                    <small>{selectedTheme?.description ?? "由主题系统提供"}</small>
                  </>
                )}
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
            <header><span className="km-eyebrow">CONTENT</span><h2>链接与项目</h2><p>统一管理内置页面的实际访问权限，以及首页展示的快捷标签和入口。</p></header>

            <section className="km-settings-collection">
              <header><div><span className="km-eyebrow">ACCESS</span><h3>页面访问权限</h3><p className="km-muted">Go 服务端同时检查页面 URL 和公开 API。Start 包括导航数据，Blog 包括文章页与查询 API；RSS 不得突破 Blog 权限。后台始终要求登录，外部网站不受本站控制。</p></div></header>
              <div className="km-form-grid">
                {MANAGED_SITE_ROUTES.map(({ path, label }) => (
                  <label className="dk-field" key={path}>{label} · {path}
                    <select value={draft.routeAccess[path] ?? "all"} aria-label={label + "访问权限"} onChange={(event) => setDraft((current) => ({ ...current, routeAccess: { ...current.routeAccess, [path]: event.target.value as HomeEntryVisibility } }))}>
                      <option value="all">公开访问</option><option value="authenticated">仅登录访问</option><option value="guest">仅未登录访问</option><option value="disabled">禁用（无法访问）</option>
                    </select>
                  </label>
                ))}
              </div>
            </section>

            <section className="km-settings-collection">
              <header><div><span className="km-eyebrow">SOCIAL</span><h3>主页快捷标签</h3><p className="km-muted">头像下方的小标签统一在这里管理。Blog、RSS 也可以改名和排序。内置页面访问权限以上面的统一规则为准；外部标签的显示条件仅影响展示。</p></div><button type="button" className="dk-button" onClick={() => setDraft((current) => ({ ...current, socialLinks: [...current.socialLinks, { id: "social-" + Date.now(), label: "", url: "", disabled: false, visibility: "all" }] }))}>新增</button></header>
              <div className="km-settings-rows is-social">
                {draft.socialLinks.map((item, index) => (
                  <div
                    key={item.id}
                    className={((item.visibility === "disabled" || item.disabled) ? "is-link-disabled " : "") + (collectionDrag?.kind === "social" && collectionDrag.index === index ? "is-dragging" : "")}
                    onDragOver={(event) => { if (collectionDrag?.kind === "social") event.preventDefault(); }}
                    onDrop={(event) => { event.preventDefault(); reorderCollection("social", index); }}
                  >
                    <span className="km-settings-drag" draggable onDragStart={() => setCollectionDrag({ kind: "social", index })} onDragEnd={() => setCollectionDrag(null)} title="拖拽排序">⠿</span>
                    <input value={item.label} onChange={(event) => updateSocial(index, "label", event.target.value)} placeholder="名称" />
                    <input value={item.url} onChange={(event) => updateSocial(index, "url", event.target.value)} placeholder="https://..." />
                    <label className="km-entry-visibility">显示条件<select aria-label={(item.label || "快捷标签") + "显示条件"} value={managedSiteRoute(item.url) ? (draft.routeAccess[managedSiteRoute(item.url)!] ?? "all") : (item.visibility ?? (item.disabled ? "disabled" : "all"))} onChange={(event) => setDraft((current) => { const route = managedSiteRoute(item.url); return route ? { ...current, routeAccess: { ...current.routeAccess, [route]: event.target.value as HomeEntryVisibility } } : { ...current, socialLinks: current.socialLinks.map((link, i) => i === index ? { ...link, visibility: event.target.value as HomeEntryVisibility, disabled: event.target.value === "disabled" } : link) }; })}><option value="all">始终显示</option><option value="authenticated">仅登录显示</option><option value="guest">仅未登录显示</option><option value="disabled">禁用</option></select></label>
                    <div className="km-settings-row-actions">
                      <button type="button" title="上移" aria-label={"上移“" + (item.label || "链接") + "”"} disabled={index === 0} onClick={() => moveCollection("social", index, -1)}>↑</button>
                      <button type="button" title="下移" aria-label={"下移“" + (item.label || "链接") + "”"} disabled={index === draft.socialLinks.length - 1} onClick={() => moveCollection("social", index, 1)}>↓</button>
                      <button type="button" className="is-danger" onClick={() => setDraft((current) => ({ ...current, socialLinks: current.socialLinks.filter((_, i) => i !== index) }))}>删除</button>
                    </div>
                  </div>
                ))}
                {!draft.socialLinks.length ? <p className="km-muted">当前没有主页标签。可点击「新增」添加 Blog、RSS 或其他地址。</p> : null}
              </div>
            </section>

            <section className="km-settings-collection">
              <header><div><span className="km-eyebrow">EXPLORE</span><h3>主页入口</h3><p className="km-muted">内置 Start、Blog 等页面的显示条件与实际访问权限使用同一规则；其他链接仅控制首页显示。支持站内路径与外部完整网址。</p></div><button type="button" className="dk-button" onClick={() => setDraft((current) => ({ ...current, homeEntries: [...current.homeEntries, { id: "entry-" + Date.now(), name: "", description: "", url: "/", newTab: false, visibility: "all" }] }))}>新增</button></header>
              <div className="km-settings-rows is-entry">
                {draft.homeEntries.map((item, index) => (
                  <div
                    key={item.id}
                    className={(item.visibility === "disabled" ? "is-entry-disabled " : "") + (collectionDrag?.kind === "entry" && collectionDrag.index === index ? "is-dragging" : "")}
                    onDragOver={(event) => { if (collectionDrag?.kind === "entry") event.preventDefault(); }}
                    onDrop={(event) => { event.preventDefault(); reorderCollection("entry", index); }}
                  >
                    <span className="km-settings-drag" draggable onDragStart={() => setCollectionDrag({ kind: "entry", index })} onDragEnd={() => setCollectionDrag(null)} title="拖拽排序">⠿</span>
                    <input value={item.name} onChange={(event) => updateHomeEntry(index, "name", event.target.value)} placeholder="名称" />
                    <input value={item.description} onChange={(event) => updateHomeEntry(index, "description", event.target.value)} placeholder="说明" />
                    <label className="km-entry-link-field">
                      <span className="km-entry-link-control">
                        <input aria-label={(item.name || "主页入口") + "链接地址"} value={item.url} onChange={(event) => updateHomeEntry(index, "url", event.target.value)} placeholder="/blog、#about 或 https://example.com" />
                        <select aria-label={(item.name || "主页入口") + "选择内置地址"} value={homeEntryPreset(item.url)} onChange={(event) => {
                          if (event.target.value) updateHomeEntry(index, "url", event.target.value);
                        }}>
                          <option value="">选择内置地址…</option>
                          {["站内页面", "主页区块", "管理功能"].map((group) => (
                            <optgroup key={group} label={group}>
                              {HOME_ENTRY_LINK_PRESETS.filter((entry) => entry.group === group).map((entry) => (
                                <option key={entry.url} value={entry.url}>{entry.label} · {entry.url}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </span>
                      <small className="km-entry-link-help">可选内置页面；也可手填站内路径（/…）、主页锚点（#…）或完整外部网址。</small>
                      {/^https?:\/\//i.test(item.url.trim()) ? <small className="km-entry-external-hint">↗ 外部网站会在新标签页打开</small> : null}
                      {item.url.trim() && !validHomeEntryLink(item.url) ? <small className="km-entry-link-error">地址无效，请输入完整 https:// 网址或选择内置地址</small> : null}
                    </label>
                    <label className="km-entry-visibility">显示条件<select aria-label={(item.name || "主页入口") + "的显示条件"} value={item.visibility ?? "all"} onChange={(event) => setDraft((current) => ({ ...current, homeEntries: current.homeEntries.map((entry, i) => i === index ? { ...entry, visibility: event.target.value as "all" | "authenticated" | "guest" | "disabled" } : entry) }))}><option value="all">始终显示</option><option value="authenticated">仅登录显示</option><option value="guest">仅未登录显示</option><option value="disabled">禁用（不显示）</option></select></label>
                    <label className="km-settings-checkbox"><input type="checkbox" checked={item.newTab} onChange={(event) => setDraft((current) => ({ ...current, homeEntries: current.homeEntries.map((entry, i) => i === index ? { ...entry, newTab: event.target.checked } : entry) }))} />新标签页</label>
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
      </form>}
      {message ? <Toast message={messageTone === "error" ? errorText(message) : message} tone={messageTone} onClose={() => setMessage("")} /> : null}
    </>
  );
}

function PostsAdmin() {
  const [posts, setPosts] = useState<PostRecord[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | PostRecord["status"]>("all");

  async function load() {
    setError("");
    try {
      const value = await requestJSON<{ posts: PostRecord[] }>("/api/posts?summary=1");
      setPosts(value.posts);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "blog_failed");
    }
  }

  useEffect(() => {
    void load();
    try {
      const flash = window.sessionStorage.getItem("know-me:post-list-flash");
      if (flash) {
        setMessage(flash);
        window.sessionStorage.removeItem("know-me:post-list-flash");
      }
    } catch {}
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
      <AdminTitle eyebrow="BLOG" title="文章" description="管理 Markdown 文章、草稿、定时发布与历史版本。" />
      {error ? <ErrorCard message={error} onRetry={() => void load()} /> : !posts ? <LoadingCard /> : (
        <>
          <div className="km-panel km-post-list-toolbar">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、Slug、分类或标签…" aria-label="搜索文章" />
            <div className="km-status-filter" aria-label="文章状态筛选">
              {([
                ["all", "全部"], ["published", "已发布"], ["draft", "草稿"], ["scheduled", "定时"]
              ] as const).map(([value, label]) => <button type="button" key={value} className={status === value ? "is-active" : ""} onClick={() => setStatus(value)}>{label}</button>)}
            </div>
            <span className="km-post-list-count">{filtered.length} / {posts.length}</span>
            <div className="km-post-list-actions"><a className="dk-button" href="/admin/posts/new?import=1">导入 Markdown</a><a className="dk-button dk-button-primary" href="/admin/posts/new">＋ 新建文章</a></div>
          </div>
          <section className="km-panel km-post-admin-list">
            {filtered.map((post) => (
              <a href={"/admin/posts/" + post.id} key={post.id}>
                <span className={"km-status-dot is-" + post.status} />
                <span><strong>{post.title}</strong><small>/{post.slug}{post.categories.length ? " · " + post.categories.join(" / ") : ""}{post.tags.length ? " · " + post.tags.map((tag) => "#" + tag).join(" ") : ""}</small></span>
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
      {message ? <Toast message={message} onClose={() => setMessage("")} /> : null}
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
