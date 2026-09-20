import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SessionUser, SiteSettings } from "./types";

export function safeHref(value: string) {
  const url = value.trim();
  if (!url) return "#";
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) return url;
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

const errorMessages: Record<string, string> = {
  site_failed: "站点配置加载失败，请稍后重试。",
  auth_failed: "无法验证登录状态，请刷新后重试。",
  session_expired: "登录已过期，请重新登录。",
  login_failed: "用户名或密码不正确。",
  invalid_credentials: "用户名或密码不正确。",
  rate_limited: "尝试次数过多，请稍后再试。",
  navigation_failed: "导航数据加载失败，请稍后重试。",
  taxonomy_failed: "分类与标签加载失败，请稍后重试。",
  media_failed: "媒体库加载失败，请稍后重试。",
  media_reference_failed: "媒体引用检查失败，请稍后重试。",
  backup_size_invalid: "备份文件过大或为空。",
  invalid_backup_zip: "这不是有效的 ZIP 备份文件。",
  backup_manifest_missing: "备份中缺少 backup.json。",
  unsupported_backup: "备份格式或版本不受当前 Know Me 支持。",
  blog_failed: "文章数据加载失败，请稍后重试。",
  post_failed: "文章加载失败，请稍后重试。",
  save_failed: "保存失败，请稍后重试。",
  delete_failed: "删除失败，请稍后重试。",
  upload_failed: "上传失败，请检查文件后重试。",
  import_failed: "导入失败，请检查文件格式后重试。",
  restore_failed: "恢复失败，请检查备份文件后重试。",
  settings_failed: "站点设置读取失败，请稍后重试。",
  dashboard_failed: "管理总览加载失败，请稍后重试。",
  forbidden: "当前请求不允许执行。",
  not_found: "请求的内容不存在。",
  already_initialized: "管理员账号已经创建。",
  password_too_short: "密码至少需要 10 个字符。",
  username_required: "请输入管理员用户名。",
  backup_failed: "备份操作失败，请稍后重试。",
  invalid_backup_path: "备份中包含不安全的文件路径，已拒绝处理。",
  duplicate_backup_path: "备份中包含重复文件路径，已拒绝恢复。",
  backup_too_many_files: "备份中的媒体文件数量异常，已拒绝恢复。",
  backup_upload_file_too_large: "备份中包含异常大的媒体文件，已拒绝恢复。",
  backup_expanded_size_invalid: "备份解压后的媒体数据过大，已拒绝恢复。",
  title_required: "请输入文章标题。",
  scheduled_time_required: "定时发布必须选择发布时间。",
  markdown_import_failed: "Markdown 导入失败。",
  frontmatter_missing: "没有找到有效的 YAML Front Matter，请确认文件以 --- 开始并正确结束。",
  frontmatter_invalid: "YAML Front Matter 格式无法解析，请检查头信息。",
  frontmatter_date_invalid: "Front Matter 的 date 不是可识别的日期格式。",
  revision_not_found: "这个历史版本已经不存在。",
  taxonomy_name_required: "请输入分类或标签名称。",
  taxonomy_name_exists: "已经存在同名分类或标签。",
  taxonomy_not_found: "分类或标签不存在，可能已被删除。",
  invalid_taxonomy_merge: "请选择另一个分类或标签作为合并目标。",
  unsupported_media_type: "仅支持 JPEG、PNG、WebP 或 GIF 图片。",
  media_size_invalid: "图片为空或超过 10 MB 限制。",
  invalid_media_file: "文件内容不是有效的图片，已拒绝上传。",
  group_name_required: "请输入分组名称。",
  item_name_required: "请输入导航名称。",
  folder_has_children: "这个文件夹还有子项目，不能直接改成普通链接。",
  item_not_found: "导航项不存在，可能已被删除。",
  navigation_cycle: "不能把文件夹移动到自己或自己的子文件夹中。",
  parent_not_found: "目标文件夹不存在。",
  parent_group_mismatch: "目标文件夹不属于当前分组。",
  parent_not_folder: "目标位置不是文件夹。",
  group_not_found: "导航分组不存在。",
  unsupported_nav_url: "这个导航地址类型不受支持。",
  unsupported_icon_url: "这个图标地址类型不受支持。",
  itab_invalid_json: "iTab 文件内容不是有效 JSON。",
  itab_missing_nav_config: "iTab 文件中没有找到导航配置。"
};

export function errorText(value: string) {
  const code = value.trim();
  if (!code) return "操作失败，请稍后重试。";
  if (errorMessages[code]) return errorMessages[code];
  if (/^HTTP 5\d\d$/.test(code)) return "服务器暂时无法处理请求，请稍后重试。";
  if (/^HTTP 4\d\d$/.test(code)) return "请求未能完成，请检查后重试。";
  return code.includes("_") && !code.includes(" ") ? "操作失败，请稍后重试。" : code;
}

export function LoadingCard({ text = "正在加载…" }: { text?: string }) {
  return <section className="km-panel km-empty"><span className="km-spinner" />{text}</section>;
}

export function ErrorCard({ message }: { message: string }) {
  return <section className="km-panel km-empty is-error">{errorText(message)}</section>;
}

export function Toast({
  message,
  tone = "success",
  onClose,
  duration = 4000
}: {
  message: string;
  tone?: "success" | "info" | "warning" | "error";
  onClose: () => void;
  duration?: number;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(timer);
  }, [duration, message, onClose]);

  return (
    <div className={"km-toast is-" + tone} role={tone === "error" ? "alert" : "status"}>
      <span>{tone === "error" ? errorText(message) : message}</span>
      <button type="button" onClick={onClose} aria-label="关闭提示">×</button>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  busy = false,
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [busy, onCancel, open]);

  if (!open) return null;

  return (
    <div className="km-modal-backdrop" role="presentation" onMouseDown={() => { if (!busy) onCancel(); }}>
      <section
        className="km-panel km-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="km-confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div>
          <span className="km-eyebrow">{danger ? "DANGER" : "CONFIRM"}</span>
          <h2 id="km-confirm-title">{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        <footer>
          <button type="button" className="dk-button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
          <button
            ref={confirmRef}
            type="button"
            className={"dk-button " + (danger ? "km-danger-button" : "dk-button-primary")}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function TextPromptDialog({
  open,
  title,
  label,
  initialValue,
  confirmLabel = "保存",
  busy = false,
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  label: string;
  initialValue: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => inputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [busy, initialValue, onCancel, open]);

  if (!open) return null;

  return (
    <div className="km-modal-backdrop" role="presentation" onMouseDown={() => { if (!busy) onCancel(); }}>
      <form
        className="km-panel km-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="km-prompt-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const next = value.trim();
          if (next && !busy) onConfirm(next);
        }}
      >
        <div>
          <span className="km-eyebrow">EDIT</span>
          <h2 id="km-prompt-title">{title}</h2>
        </div>
        <label className="dk-field">{label}<input ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} /></label>
        <footer>
          <button type="button" className="dk-button" disabled={busy} onClick={onCancel}>取消</button>
          <button className="dk-button dk-button-primary" disabled={busy || !value.trim()}>{busy ? "处理中…" : confirmLabel}</button>
        </footer>
      </form>
    </div>
  );
}

export function SiteHeader({ settings, user }: { settings: SiteSettings; user?: SessionUser | null }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  return (
    <header ref={headerRef} className="km-header">
      <a className="km-brand" href="/">
        <span className="km-brand-mark">K</span>
        <span><strong>{settings.profileName || "Know Me"}</strong><small>PERSONAL</small></span>
      </a>
      <button
        type="button"
        className="km-header-menu"
        aria-label={menuOpen ? "关闭导航菜单" : "打开导航菜单"}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
      >
        <span /><span /><span />
      </button>
      <nav className={"km-header-nav" + (menuOpen ? " is-open" : "")} aria-label="主要导航">
        <a href="/" onClick={() => setMenuOpen(false)}>主页</a>
        <a href="/start" onClick={() => setMenuOpen(false)}>Start</a>
        <a href="/blog" onClick={() => setMenuOpen(false)}>Blog</a>
        <a href="/admin" onClick={() => setMenuOpen(false)}>{user ? "后台" : "登录"}</a>
      </nav>
    </header>
  );
}

function PublicFooter({ settings }: { settings: SiteSettings }) {
  const friends = (settings.friendLinks ?? []).filter((item) => item.visible && safeHref(item.url) !== "#");
  const hasMeta = Boolean(
    settings.footerText?.trim() ||
    (settings.showIcp && settings.icpNumber?.trim()) ||
    (settings.showPolice && settings.policeNumber?.trim()) ||
    (settings.showFriendLinks && friends.length)
  );

  return (
    <footer className="km-footer">
      <div className="km-footer-main">
        <strong>{settings.profileName || "Know Me"}</strong>
        {settings.footerText?.trim() ? <span>{settings.footerText}</span> : null}
      </div>
      {hasMeta ? (
        <div className="km-footer-meta">
          {settings.showIcp && settings.icpNumber?.trim() ? (
            settings.icpUrl?.trim() ? <a href={safeHref(settings.icpUrl)} target="_blank" rel="noreferrer">{settings.icpNumber}</a> : <span>{settings.icpNumber}</span>
          ) : null}
          {settings.showPolice && settings.policeNumber?.trim() ? (
            settings.policeUrl?.trim() ? <a href={safeHref(settings.policeUrl)} target="_blank" rel="noreferrer">{settings.policeNumber}</a> : <span>{settings.policeNumber}</span>
          ) : null}
          {settings.showFriendLinks && friends.length ? (
            <nav aria-label="友情链接">
              {friends.map((item) => {
                const href = safeHref(item.url);
                return <a key={item.id} href={href} target={isExternal(href) ? "_blank" : undefined} rel={isExternal(href) ? "noreferrer" : undefined}>{item.name}</a>;
              })}
            </nav>
          ) : null}
        </div>
      ) : null}
    </footer>
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
      <PublicFooter settings={settings} />
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
