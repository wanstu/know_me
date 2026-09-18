"use client";

import { useState } from "react";
import type { SearchEngineName, SiteSettings, ThemeMode, StartDensity } from "@/lib/settings/repository";

export function SettingsManager({ initialSettings }: { initialSettings: SiteSettings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function update<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
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
          <h2>个人主页</h2>
          <p className="muted">这些内容会直接显示在公开个人主页。</p>
        </div>

        <div className="settings-grid">
          <label>显示名称<input value={settings.profileName} onChange={(event) => update("profileName", event.target.value)} /></label>
          <label>一句话简介<input value={settings.profileTagline} onChange={(event) => update("profileTagline", event.target.value)} /></label>
          <label className="span-2">个人介绍<textarea value={settings.profileBio} onChange={(event) => update("profileBio", event.target.value)} /></label>
          <label>头像 URL<input value={settings.avatarUrl} onChange={(event) => update("avatarUrl", event.target.value)} placeholder="/media/... 或 https://..." /></label>
          <label>GitHub URL<input value={settings.githubUrl} onChange={(event) => update("githubUrl", event.target.value)} /></label>
          <label>邮箱链接<input value={settings.emailUrl} onChange={(event) => update("emailUrl", event.target.value)} placeholder="mailto:you@example.com" /></label>
          <label>About URL<input value={settings.aboutUrl} onChange={(event) => update("aboutUrl", event.target.value)} /></label>
          <label>主页短句<input value={settings.quote} onChange={(event) => update("quote", event.target.value)} /></label>
          <label>短句署名<input value={settings.quoteAuthor} onChange={(event) => update("quoteAuthor", event.target.value)} /></label>
        </div>
      </section>

      <section className="admin-panel settings-section">
        <div>
          <div className="eyebrow">Appearance</div>
          <h2>背景与起始页</h2>
          <p className="muted">可以使用媒体库中的 /media/... 地址，也可以填写外部 HTTPS 图片地址。</p>
        </div>

        <div className="settings-grid">
          <label className="span-2">个人主页背景<input value={settings.homeBackgroundUrl} onChange={(event) => update("homeBackgroundUrl", event.target.value)} placeholder="/media/..." /></label>
          <label className="span-2">浏览器起始页背景<input value={settings.startBackgroundUrl} onChange={(event) => update("startBackgroundUrl", event.target.value)} placeholder="/media/..." /></label>
          <label>
            默认搜索引擎
            <select value={settings.defaultSearchEngine} onChange={(event) => update("defaultSearchEngine", event.target.value as SearchEngineName)}>
              <option value="Bing">Bing</option>
              <option value="Google">Google</option>
              <option value="DuckDuckGo">DuckDuckGo</option>
            </select>
          </label>
          <label>
            主页主题
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
    </div>
  );
}
