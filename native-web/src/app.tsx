import { lazy, Suspense, useEffect, useState } from "react";
import { getSession, getSiteSettings } from "./api";
import { applyTheme } from "./kit";
import type { SessionUser, SiteSettings } from "./types";
import { ErrorCard, LoadingCard } from "./ui";
import { HomePage } from "./pages/home";
import { LoginPage } from "./pages/login";

const StartPage = lazy(async () => ({ default: (await import("./pages/start")).StartPage }));
const BlogIndexPage = lazy(async () => ({ default: (await import("./pages/blog")).BlogIndexPage }));
const BlogPostPage = lazy(async () => ({ default: (await import("./pages/blog")).BlogPostPage }));
const AdminPage = lazy(async () => ({ default: (await import("./pages/admin")).AdminPage }));

function PageLoading() {
  return <main className="km-boot"><LoadingCard text="正在加载页面…" /></main>;
}

export function App() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    let activeDialog: HTMLElement | null = null;
    let previousFocus: HTMLElement | null = null;

    const findDialog = () => {
      const backdrops = Array.from(document.querySelectorAll<HTMLElement>(".km-modal-backdrop"));
      const backdrop = backdrops[backdrops.length - 1];
      return (backdrop?.firstElementChild as HTMLElement | null) ?? null;
    };

    const focusables = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.offsetParent !== null);

    const refreshDialog = () => {
      const next = findDialog();
      if (next === activeDialog) return;
      if (next) {
        if (!activeDialog) {
          previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
        activeDialog = next;
        window.requestAnimationFrame(() => {
          if (!activeDialog) return;
          if (activeDialog.contains(document.activeElement)) return;
          const preferred = activeDialog.querySelector<HTMLElement>("[autofocus]") ?? focusables(activeDialog)[0];
          preferred?.focus();
        });
      } else if (activeDialog) {
        activeDialog = null;
        previousFocus?.focus();
        previousFocus = null;
      }
    };

    const observer = new MutationObserver(refreshDialog);
    observer.observe(document.body, { childList: true, subtree: true });

    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = activeDialog ?? findDialog();
      if (!dialog) return;
      if (event.key === "Escape") {
        const closeButton = dialog.querySelector<HTMLButtonElement>('button[aria-label="关闭"], header > button[type="button"]');
        if (closeButton && !closeButton.disabled) {
          event.preventDefault();
          closeButton.click();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusables(dialog);
      if (!elements.length) {
        event.preventDefault();
        dialog.tabIndex = -1;
        dialog.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !dialog.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    refreshDialog();
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  useEffect(() => {
    void Promise.all([getSiteSettings(), getSession()])
      .then(([site, session]) => {
        setSettings(site);
        setUser(session);
        void applyTheme(site.themeMode, site.themePreset);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "site_failed"));
  }, []);

  if (error) {
    return <main className="km-boot"><ErrorCard message={error} retryLabel="重新加载" onRetry={() => window.location.reload()} /></main>;
  }
  if (!settings || user === undefined) {
    return <main className="km-boot"><LoadingCard text="正在启动 Know Me…" /></main>;
  }

  const path = window.location.pathname;
  let page;
  if (path === "/") page = <HomePage settings={settings} user={user} />;
  else if (path === "/login") page = <LoginPage settings={settings} user={user} />;
  else if (path === "/start") page = <StartPage settings={settings} user={user} />;
  else if (path === "/blog") page = <BlogIndexPage settings={settings} user={user} />;
  else if (path.startsWith("/blog/")) {
    page = <BlogPostPage settings={settings} user={user} slug={decodeURIComponent(path.slice("/blog/".length))} />;
  } else if (path === "/admin" || path.startsWith("/admin/")) {
    page = <AdminPage settings={settings} user={user} path={path} onSettingsChange={(next) => {
      setSettings(next);
      void applyTheme(next.themeMode, next.themePreset);
    }} />;
  } else {
    page = (
      <main className="km-boot">
        <section className="km-panel km-empty">
          <strong>404</strong>
          <p>这个页面还不存在。</p>
          <div className="km-empty-actions">
            <button className="dk-button" type="button" onClick={() => window.history.back()}>返回上一页</button>
            <a className="dk-button dk-button-primary" href="/">返回主页</a>
          </div>
        </section>
      </main>
    );
  }

  return <Suspense fallback={<PageLoading />}>{page}</Suspense>;
}
