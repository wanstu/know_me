"use client";

import { useState } from "react";
import type { SearchEngineName, SiteSettings } from "@/lib/settings/repository";

export function SettingsManager({ initialSettings }: { initialSettings: SiteSettings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function update<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
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
          <label className="settings-check">
            <input type="checkbox" checked={settings.startPublic} onChange={(event) => update("startPublic", event.target.checked)} />
            <span>
              <strong>允许未登录访问起始页</strong>
              <small>只会显示标记为“公开”的导航分组和入口；私有链接不会下发给访客。</small>
            </span>
          </label>
        </div>
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
