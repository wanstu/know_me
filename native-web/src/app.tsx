import { lazy, Suspense, useEffect, useState } from "react";
import { getSiteSettings } from "./api";
import { applyTheme } from "./kit";
import type { SiteSettings } from "./types";
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
  const [error, setError] = useState("");

  useEffect(() => {
    void getSiteSettings()
      .then((value) => {
        setSettings(value);
        void applyTheme(value.themeMode, value.themePreset);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "site_failed"));
  }, []);

  if (error) {
    return <main className="km-boot"><ErrorCard message={"站点配置加载失败：" + error} /></main>;
  }
  if (!settings) {
    return <main className="km-boot"><LoadingCard text="正在启动 Know Me…" /></main>;
  }

  const path = window.location.pathname;
  let page;
  if (path === "/") page = <HomePage settings={settings} />;
  else if (path === "/login") page = <LoginPage settings={settings} />;
  else if (path === "/start") page = <StartPage settings={settings} />;
  else if (path === "/blog") page = <BlogIndexPage settings={settings} />;
  else if (path.startsWith("/blog/")) {
    page = <BlogPostPage settings={settings} slug={decodeURIComponent(path.slice("/blog/".length))} />;
  } else if (path === "/admin" || path.startsWith("/admin/")) {
    page = <AdminPage settings={settings} path={path} onSettingsChange={(next) => {
      setSettings(next);
      void applyTheme(next.themeMode, next.themePreset);
    }} />;
  } else {
    page = (
      <main className="km-boot">
        <section className="km-panel km-empty">
          <strong>404</strong>
          <p>这个页面还不存在。</p>
          <a className="dk-button dk-button-primary" href="/">返回主页</a>
        </section>
      </main>
    );
  }

  return <Suspense fallback={<PageLoading />}>{page}</Suspense>;
}
