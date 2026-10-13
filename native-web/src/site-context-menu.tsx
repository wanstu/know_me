import { useEffect, useRef, useState } from "react";
import { openExternalBrowser } from "./external-links";
import type { SessionUser } from "./types";

type MenuState = { x: number; y: number; link: string | null; selection: string };

export function SiteContextMenu({ user }: { user: SessionUser | null }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Native text-editing and media menus remain available for copy/paste and playback.
      if (target.closest("input, textarea, select, [contenteditable], [role='textbox'], video, audio, canvas, iframe, .km-start-context-menu, .km-site-context-menu")) return;
      event.preventDefault();
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      setError("");
      setMenu({
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - 258)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - 325)),
        link: anchor?.href ?? null,
        selection: window.getSelection()?.toString().trim() ?? ""
      });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMenu(null); }
    };
    const close = () => setMenu(null);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  function openLink(url: string) {
    setMenu(null);
    const target = new URL(url, window.location.href);
    if (target.origin === window.location.origin) { window.location.href = target.href; return; }
    if (!openExternalBrowser(target.href)) window.open(target.href, "_blank", "noopener,noreferrer");
  }

  function copyText(value: string) {
    void navigator.clipboard.writeText(value).then(
      () => setMenu(null),
      () => setError("复制失败，请检查剪贴板权限")
    );
  }

  if (!menu) return null;
  return (
    <div className="km-start-context-menu km-site-context-menu" role="menu" aria-label="Know Me 快捷菜单" ref={root}
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}>
      <strong className="km-start-context-caption">Know Me</strong>
      {menu.link ? (
        <>
          <button type="button" role="menuitem" onClick={() => openLink(menu.link!)}>打开链接 <span aria-hidden="true">↗</span></button>
          <button type="button" role="menuitem" onClick={() => copyText(menu.link!)}>复制链接地址</button>
          <div className="km-start-context-divider" role="separator" />
        </>
      ) : null}
      {menu.selection ? <button type="button" role="menuitem" onClick={() => copyText(menu.selection)}>复制选中的文字</button> : null}
      <button type="button" role="menuitem" onClick={() => copyText(window.location.href)}>复制当前页面地址</button>
      <button type="button" role="menuitem" onClick={() => window.location.reload()}>刷新页面</button>
      <button type="button" role="menuitem" disabled={window.history.length < 2} onClick={() => window.history.back()}>返回上一页</button>
      <div className="km-start-context-divider" role="separator" />
      <a role="menuitem" href="/">个人主页</a>
      <a role="menuitem" href="/start">Start 导航</a>
      {user ? <a role="menuitem" href="/admin">管理后台</a> : null}
      {error ? <small className="km-start-context-note" role="alert">{error}</small> : null}
    </div>
  );
}
