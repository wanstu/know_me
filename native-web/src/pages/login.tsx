import { FormEvent, useEffect, useState } from "react";
import { getAuthSetup, login, registerAdmin } from "../api";
import type { SiteSettings } from "../types";
import { PageFrame } from "../ui";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/admin";
  return value;
}

export function LoginPage({ settings }: { settings: SiteSettings }) {
  const params = new URLSearchParams(window.location.search);
  const next = safeNext(params.get("next"));
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState(params.get("error") ? "登录信息无效，请重试。" : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getAuthSetup()
      .then(({ needsSetup: value }) => setNeedsSetup(value))
      .catch(() => setMessage("无法检查管理员账号状态，请刷新后重试。"));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (needsSetup === null) return;

    setBusy(true);
    setMessage("");
    try {
      if (needsSetup) {
        if (password.length < 10) {
          setMessage("密码至少需要 10 个字符。");
          return;
        }
        if (password !== confirmPassword) {
          setMessage("两次输入的密码不一致。");
          return;
        }
        await registerAdmin(username, password, username);
      } else {
        await login(username, password);
      }
      window.location.href = next;
    } catch (error) {
      const code = error instanceof Error ? error.message : "login_failed";
      if (code === "rate_limited") {
        setMessage("尝试次数过多，请稍后再试。");
      } else if (code === "already_initialized") {
        setNeedsSetup(false);
        setConfirmPassword("");
        setMessage("管理员账号已经创建，请直接登录。");
      } else if (code === "password_too_short") {
        setMessage("密码至少需要 10 个字符。");
      } else if (code === "username_required") {
        setMessage("请输入管理员用户名。");
      } else {
        setMessage(needsSetup ? "管理员注册失败，请重试。" : "用户名或密码不正确。");
      }
    } finally {
      setBusy(false);
    }
  }

  const setupMode = needsSetup === true;

  return (
    <PageFrame settings={settings} className="km-login-page">
      <div className="km-login-wrap">
        <section className="km-panel km-login-card">
          <span className="km-eyebrow">ADMIN</span>
          <h1>{setupMode ? "创建管理员" : "登录 Know Me"}</h1>
          <p>
            {setupMode
              ? "当前还没有管理员账号。注册的第一个账号将成为管理员。"
              : "登录后可以管理导航、文章、媒体与站点设置。"}
          </p>
          <form onSubmit={submit} className="km-form-stack">
            <label className="dk-field">
              用户名
              <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label className="dk-field">
              密码
              <input
                autoComplete={setupMode ? "new-password" : "current-password"}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={setupMode ? 10 : undefined}
                autoFocus
              />
            </label>
            {setupMode ? (
              <>
                <label className="dk-field">
                  确认密码
                  <input
                    autoComplete="new-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    minLength={10}
                  />
                </label>
                <div className="dk-message">密码至少需要 10 个字符。注册完成后将直接进入管理后台。</div>
              </>
            ) : null}
            {message ? <div className="dk-message is-danger">{message}</div> : null}
            <button
              className="dk-button dk-button-primary km-full-button"
              disabled={busy || needsSetup === null || !username || !password || (setupMode && !confirmPassword)}
            >
              {busy ? (setupMode ? "注册中…" : "登录中…") : (setupMode ? "注册管理员" : "登录")}
            </button>
          </form>
        </section>
      </div>
    </PageFrame>
  );
}
