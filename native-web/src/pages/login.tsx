import { FormEvent, useState } from "react";
import { login } from "../api";
import type { SiteSettings } from "../types";
import { PageFrame } from "../ui";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/admin";
  return value;
}

export function LoginPage({ settings }: { settings: SiteSettings }) {
  const params = new URLSearchParams(window.location.search);
  const next = safeNext(params.get("next"));
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(params.get("error") ? "登录信息无效，请重试。" : "");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await login(username, password);
      window.location.href = next;
    } catch (error) {
      const code = error instanceof Error ? error.message : "login_failed";
      setMessage(code === "rate_limited" ? "尝试次数过多，请稍后再试。" : "用户名或密码不正确。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageFrame settings={settings} className="km-login-page">
      <div className="km-login-wrap">
        <section className="km-panel km-login-card">
          <span className="km-eyebrow">ADMIN</span>
          <h1>登录 Know Me</h1>
          <p>登录后可以管理导航、文章、媒体与站点设置。</p>
          <form onSubmit={submit} className="km-form-stack">
            <label className="dk-field">用户名<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label className="dk-field">密码<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus /></label>
            {message ? <div className="dk-message is-danger">{message}</div> : null}
            <button className="dk-button dk-button-primary km-full-button" disabled={busy || !username || !password}>{busy ? "登录中…" : "登录"}</button>
          </form>
        </section>
      </div>
    </PageFrame>
  );
}
