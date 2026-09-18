"use client";

import { useEffect, useState } from "react";
import type { MediaRecord } from "@/lib/media/repository";
import type {
  HomeEntry,
  ProjectEntry,
  SearchEngineName,
  SiteSettings,
  SocialLink,
  StartDensity,
  ThemeMode,
  ThemePreset
} from "@/lib/settings/repository";

type MediaTarget = "avatarUrl" | "homeBackgroundUrl" | "startBackgroundUrl" | null;

const themePresets: Array<{
  id: ThemePreset;
  name: string;
  description: string;
  swatches: [string, string, string];
}> = [
  { id: "aurora", name: "极光", description: "默认 · 蓝紫渐变，冷静但不压暗", swatches: ["#6d7cff", "#8c7cf6", "#42c7d9"] },
  { id: "ocean", name: "海洋", description: "蓝青色调，清爽明亮", swatches: ["#0ea5e9", "#38bdf8", "#22d3ee"] },
  { id: "forest", name: "森林", description: "绿色系，柔和自然", swatches: ["#34d399", "#22c55e", "#84cc16"] },
  { id: "sunset", name: "落日", description: "橙粉暖色，更有生活感", swatches: ["#fb7185", "#f97316", "#f59e0b"] }
];

function id(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return prefix + "-" + crypto.randomUUID();
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function move<T>(items: T[], from: number, to: number) {
  if (to < 0 || to >= items.length || from === to) return items;
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export function SettingsManager({
  initialSettings,
  media
}: {
  initialSettings: SiteSettings;
  media: MediaRecord[];
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [mediaTarget, setMediaTarget] = useState<MediaTarget>(null);

  useEffect(() => {
    const root = document.querySelector(".admin-page");
    if (!root) return;
    root.classList.remove("theme-auto", "theme-dark", "theme-light", "theme-preset-aurora", "theme-preset-ocean", "theme-preset-forest", "theme-preset-sunset");
    root.classList.add("theme-" + settings.themeMode, "theme-preset-" + settings.themePreset);
  }, [settings.themeMode, settings.themePreset]);

  function update<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updateSocial(index: number, patch: Partial<SocialLink>) {
    update("socialLinks", settings.socialLinks.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function updateEntry(index: number, patch: Partial<HomeEntry>) {
    update("homeEntries", settings.homeEntries.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function updateProject(index: number, patch: Partial<ProjectEntry>) {
    update("projects", settings.projects.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function chooseMedia(url: string) {
    if (!mediaTarget) return;
    update(mediaTarget, url);
    setMediaTarget(null);
  }

  async function restoreBackup(file: File | null) {
    if (!file) return;
    if (!window.confirm("恢复备份会替换当前博客、导航、媒体和站点设置，但不会改管理员账号。确定继续？")) return;
    setBusy(true);
    setMessage("正在恢复备份…");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/backup/restore", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "恢复失败");
      setMessage("恢复完成，正在刷新…");
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "恢复失败");
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMessage("正在保存…");
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存失败");
      setSettings(payload.settings);
      setMessage("已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-layout">
      <section className="admin-panel settings-section">
        <div>
          <div className="eyebrow">Profile</div>
          <h2>个人资料</h2>
          <p className="muted">公开主页顶部的头像、名称和介绍。</p>
        </div>

        <div className="settings-grid">
          <label>显示名称<input value={settings.profileName} onChange={(event) => update("profileName", event.target.value)} /></label>
          <label>一句话简介<input value={settings.profileTagline} onChange={(event) => update("profileTagline", event.target.value)} /></label>
          <label className="span-2">个人介绍<textarea value={settings.profileBio} onChange={(event) => update("profileBio", event.target.value)} /></label>

          <label className="span-2">
            头像
            <div className="settings-inline-field">
              <input value={settings.avatarUrl} onChange={(event) => update("avatarUrl", event.target.value)} placeholder="/media/... 或 https://..." />
              <button type="button" onClick={() => setMediaTarget("avatarUrl")}>从媒体库选择</button>
              {settings.avatarUrl ? <button type="button" onClick={() => update("avatarUrl", "")}>清除</button> : null}
            </div>
          </label>

          <label>主页短句<input value={settings.quote} onChange={(event) => update("quote", event.target.value)} /></label>
          <label>短句署名<input value={settings.quoteAuthor} onChange={(event) => update("quoteAuthor", event.target.value)} /></label>
        </div>
      </section>

      <section className="admin-panel settings-section">
        <div>
          <div className="eyebrow">Social</div>
          <h2>社交入口</h2>
          <p className="muted">显示在个人介绍下方。支持 HTTPS、mailto: 和站内路径。</p>
        </div>

        <div className="settings-collection">
          {settings.socialLinks.map((item, index) => (
            <div className="settings-collection-row settings-collection-row--social" key={item.id}>
              <input value={item.label} onChange={(event) => updateSocial(index, { label: event.target.value })} placeholder="名称，如 GitHub" />
              <input value={item.url} onChange={(event) => updateSocial(index, { url: event.target.value })} placeholder="https://... 或 mailto:..." />
              <div className="settings-row-actions">
                <button type="button" disabled={index === 0} onClick={() => update("socialLinks", move(settings.socialLinks, index, index - 1))}>↑</button>
                <button type="button" disabled={index === settings.socialLinks.length - 1} onClick={() => update("socialLinks", move(settings.socialLinks, index, index + 1))}>↓</button>
                <button type="button" className="danger-text" onClick={() => update("socialLinks", settings.socialLinks.filter((_, itemIndex) => itemIndex !== index))}>删除</button>
              </div>
            </div>
          ))}
          {settings.socialLinks.length === 0 ? <div className="settings-collection-empty">还没有社交入口。</div> : null}
          <button
            type="button"
            className="secondary-button settings-add-button"
            onClick={() => update("socialLinks", [...settings.socialLinks, { id: id("social"), label: "", url: "" }])}
          >
            ＋ 添加社交入口
          </button>
        </div>
      </section>

      <section className="admin-panel settings-section">
        <div>
          <div className="eyebrow">Explore</div>
          <h2>主页入口卡片</h2>
          <p className="muted">控制主页 Explore 区域的入口、文案、顺序和打开方式。</p>
        </div>

        <div className="settings-collection">
          {settings.homeEntries.map((item, index) => (
            <div className="settings-collection-row settings-collection-row--entry" key={item.id}>
              <input value={item.name} onChange={(event) => updateEntry(index, { name: event.target.value })} placeholder="名称" />
              <input value={item.description} onChange={(event) => updateEntry(index, { description: event.target.value })} placeholder="说明" />
              <input value={item.url} onChange={(event) => updateEntry(index, { url: event.target.value })} placeholder="/blog、#projects 或 https://..." />
              <label className="settings-inline-check">
                <input type="checkbox" checked={item.newTab} onChange={(event) => updateEntry(index, { newTab: event.target.checked })} />
                新标签页
              </label>
              <div className="settings-row-actions">
                <button type="button" disabled={index === 0} onClick={() => update("homeEntries", move(settings.homeEntries, index, index - 1))}>↑</button>
                <button type="button" disabled={index === settings.homeEntries.length - 1} onClick={() => update("homeEntries", move(settings.homeEntries, index, index + 1))}>↓</button>
                <button type="button" className="danger-text" onClick={() => update("homeEntries", settings.homeEntries.filter((_, itemIndex) => itemIndex !== index))}>删除</button>
              </div>
            </div>
          ))}
          {settings.homeEntries.length === 0 ? <div className="settings-collection-empty">主页暂时没有入口卡片。</div> : null}
          <button
            type="button"
            className="secondary-button settings-add-button"
            onClick={() => update("homeEntries", [...settings.homeEntries, { id: id("entry"), name: "", description: "", url: "/", newTab: false }])}
          >
            ＋ 添加主页入口
          </button>
        </div>
      </section>

      <section className="admin-panel settings-section">
        <div>
          <div className="eyebrow">Projects</div>
          <h2>项目与作品</h2>
          <p className="muted">项目会显示在公开主页的 Projects 区域。</p>
        </div>

        <div className="settings-collection">
          {settings.projects.map((item, index) => (
            <div className="settings-collection-row settings-collection-row--project" key={item.id}>
              <input value={item.name} onChange={(event) => updateProject(index, { name: event.target.value })} placeholder="项目名称" />
              <input value={item.tag} onChange={(event) => updateProject(index, { tag: event.target.value })} placeholder="标签，如 Go / Wails" />
              <input value={item.description} onChange={(event) => updateProject(index, { description: event.target.value })} placeholder="一句话说明" />
              <input value={item.url} onChange={(event) => updateProject(index, { url: event.target.value })} placeholder="项目地址，可留空" />
              <div className="settings-row-actions">
                <button type="button" disabled={index === 0} onClick={() => update("projects", move(settings.projects, index, index - 1))}>↑</button>
                <button type="button" disabled={index === settings.projects.length - 1} onClick={() => update("projects", move(settings.projects, index, index + 1))}>↓</button>
                <button type="button" className="danger-text" onClick={() => update("projects", settings.projects.filter((_, itemIndex) => itemIndex !== index))}>删除</button>
              </div>
            </div>
          ))}
          {settings.projects.length === 0 ? <div className="settings-collection-empty">还没有项目。可以先添加常用或想展示的作品。</div> : null}
          <button
            type="button"
            className="secondary-button settings-add-button"
            onClick={() => update("projects", [...settings.projects, { id: id("project"), name: "", description: "", url: "", tag: "" }])}
          >
            ＋ 添加项目
          </button>
        </div>
      </section>

      <section className="admin-panel settings-section">
        <div>
          <div className="eyebrow">Appearance</div>
          <h2>主题与背景</h2>
          <p className="muted">主题控制整站色彩和明暗；背景图片只影响个人主页与起始页。</p>
        </div>

        <div className="theme-preset-grid span-2">
          {themePresets.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className={"theme-preset-card " + (settings.themePreset === preset.id ? "is-active" : "")}
              onClick={() => update("themePreset", preset.id)}
            >
              <span className="theme-preset-swatches" aria-hidden="true">
                {preset.swatches.map((value) => <i key={value} style={{ background: value }} />)}
              </span>
              <span className="theme-preset-copy">
                <strong>{preset.name}</strong>
                <small>{preset.description}</small>
              </span>
              <span className="theme-preset-check">{settings.themePreset === preset.id ? "✓" : ""}</span>
            </button>
          ))}
        </div>

        <div className="settings-grid">
          <label className="span-2">
            个人主页背景
            <div className="settings-inline-field">
              <input value={settings.homeBackgroundUrl} onChange={(event) => update("homeBackgroundUrl", event.target.value)} placeholder="/media/..." />
              <button type="button" onClick={() => setMediaTarget("homeBackgroundUrl")}>从媒体库选择</button>
              {settings.homeBackgroundUrl ? <button type="button" onClick={() => update("homeBackgroundUrl", "")}>清除</button> : null}
            </div>
          </label>
          <label className="span-2">
            浏览器起始页背景
            <div className="settings-inline-field">
              <input value={settings.startBackgroundUrl} onChange={(event) => update("startBackgroundUrl", event.target.value)} placeholder="/media/..." />
              <button type="button" onClick={() => setMediaTarget("startBackgroundUrl")}>从媒体库选择</button>
              {settings.startBackgroundUrl ? <button type="button" onClick={() => update("startBackgroundUrl", "")}>清除</button> : null}
            </div>
          </label>

          <label>
            默认搜索引擎
            <select value={settings.defaultSearchEngine} onChange={(event) => update("defaultSearchEngine", event.target.value as SearchEngineName)}>
              <option value="Bing">Bing</option>
              <option value="Google">Google</option>
              <option value="DuckDuckGo">DuckDuckGo</option>
            </select>
          </label>
          <label>
            明暗模式
            <select value={settings.themeMode} onChange={(event) => update("themeMode", event.target.value as ThemeMode)}>
              <option value="auto">跟随系统</option>
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </label>
          <label>
            起始页卡片密度
            <select value={settings.startDensity} onChange={(event) => update("startDensity", event.target.value as StartDensity)}>
              <option value="compact">紧凑</option>
              <option value="comfortable">舒适</option>
              <option value="spacious">宽松</option>
            </select>
          </label>
          <label className="range-setting">
            <span>卡片透明度 <strong>{settings.startCardOpacity}%</strong></span>
            <input type="range" min="30" max="95" value={settings.startCardOpacity} onChange={(event) => update("startCardOpacity", Number(event.target.value))} />
          </label>
          <label className="range-setting">
            <span>卡片圆角 <strong>{settings.startCardRadius}px</strong></span>
            <input type="range" min="12" max="32" value={settings.startCardRadius} onChange={(event) => update("startCardRadius", Number(event.target.value))} />
          </label>
          <label className="range-setting">
            <span>背景遮罩 <strong>{settings.startBackgroundDim}%</strong></span>
            <input type="range" min="0" max="90" value={settings.startBackgroundDim} onChange={(event) => update("startBackgroundDim", Number(event.target.value))} />
          </label>
          <label className="settings-check">
            <input type="checkbox" checked={settings.startPublic} onChange={(event) => update("startPublic", event.target.checked)} />
            <span>
              <strong>允许未登录访问起始页</strong>
              <small>只会显示标记为“公开”的导航分组和入口；私有链接不会下发给访客。</small>
            </span>
          </label>
        </div>
      </section>

      <section className="admin-panel settings-section">
        <div>
          <div className="eyebrow">Backup</div>
          <h2>备份与恢复</h2>
          <p className="muted">备份包含博客、导航、媒体文件和站点设置；管理员密码与登录 Session 不会被导出。</p>
        </div>
        <div className="backup-actions">
          <a className="secondary-button" href="/api/backup/export">下载完整备份 ZIP</a>
          <label className="file-picker">
            <span>从 ZIP 恢复</span>
            <input type="file" accept=".zip,application/zip" disabled={busy} onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              void restoreBackup(file);
              event.currentTarget.value = "";
            }} />
          </label>
        </div>
        <p className="muted backup-note">恢复前建议先下载一次当前备份。恢复使用事务更新数据库，并整体替换媒体目录。</p>
      </section>

      <div className="settings-savebar">
        <span className="muted">{message}</span>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? "保存中…" : "保存设置"}
        </button>
      </div>

      {mediaTarget ? (
        <div className="admin-modal-backdrop" onMouseDown={() => setMediaTarget(null)}>
          <section className="admin-modal admin-modal-wide media-picker-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <div className="eyebrow">Media Library</div>
                <h3>选择图片</h3>
              </div>
              <button type="button" onClick={() => setMediaTarget(null)}>×</button>
            </div>

            {media.length ? (
              <div className="settings-media-grid">
                {media.map((item) => (
                  <button type="button" key={item.id} onClick={() => chooseMedia(item.url)} title={item.originalName}>
                    <img src={item.url} alt={item.alt || item.originalName} loading="lazy" />
                    <span>{item.originalName}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="settings-collection-empty">
                媒体库还是空的。先到媒体库上传图片，再回来选择。
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
