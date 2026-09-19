import type { ReactNode } from "react";
import type { SessionUser, SiteSettings } from "./types";

export function safeHref(value: string) {
  const url = value.trim();
  if (!url) return "#";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (url.startsWith("#")) return url;
  try {
    const parsed = new URL(url);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) return url;
  } catch {}
  return "#";
}

export function isExternal(value: string) {
  return /^https?:\/\//i.test(value);
}

export function LoadingCard({ text = "正在加载…" }: { text?: string }) {
  return <section className="km-panel km-empty"><span className="km-spinner" />{text}</section>;
}

export function ErrorCard({ message }: { message: string }) {
  return <section className="km-panel km-empty is-error">{message}</section>;
}

export function SiteHeader({ settings, user }: { settings: SiteSettings; user?: SessionUser | null }) {
  return (
    <header className="km-header">
      <a className="km-brand" href="/">
        <span className="km-brand-mark">K</span>
        <span><strong>{settings.profileName || "Know Me"}</strong><small>Native</small></span>
      </a>
      <nav className="km-header-nav" aria-label="主要导航">
        <a href="/">主页</a>
        <a href="/start">Start</a>
        <a href="/blog">Blog</a>
        <a href="/admin">{user ? "后台" : "登录"}</a>
      </nav>
    </header>
  );
}

export function PageFrame({
  settings,
  user,
  children,
  className = ""
}: {
  settings: SiteSettings;
  user?: SessionUser | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={"km-page " + className}>
      <SiteHeader settings={settings} user={user} />
      <main className="km-main">{children}</main>
      <footer className="km-footer">Know Me · Go Native Runtime</footer>
    </div>
  );
}

const adminMenu = [
  ["/admin", "总览"],
  ["/admin/navigation", "起始页"],
  ["/admin/posts", "文章"],
  ["/admin/taxonomy", "分类与标签"],
  ["/admin/media", "媒体库"],
  ["/admin/settings", "站点设置"],
  ["/admin/backup", "备份与恢复"]
] as const;

export function AdminShell({
  settings,
  user,
  current,
  children
}: {
  settings: SiteSettings;
  user: SessionUser;
  current: string;
  children: ReactNode;
}) {
  return (
    <div className="km-admin-layout">
      <aside className="km-admin-sidebar">
        <a className="km-admin-brand" href="/"><span>K</span><strong>Know Me</strong></a>
        <nav className="km-admin-nav">
          {adminMenu.map(([href, label]) => (
            <a key={href} href={href} aria-current={current === href ? "page" : undefined}>{label}</a>
          ))}
        </nav>
        <div className="km-admin-user">
          <strong>{user.displayName || user.username}</strong>
          <small>@{user.username}</small>
          <a href="/">返回站点</a>
        </div>
      </aside>
      <main className="km-admin-main">{children}</main>
    </div>
  );
}

export function AdminTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <header className="km-admin-title">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
    </header>
  );
}
