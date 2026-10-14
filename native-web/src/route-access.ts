import type { HomeEntryVisibility, SiteSettings } from "./types";

export const MANAGED_SITE_ROUTES = [
  { path: "/start", label: "Start 起始页", scope: "起始页及公开导航接口" },
  { path: "/blog", label: "Blog 文章与笔记", scope: "文章列表、正文及公开查询接口" },
  { path: "/feed.xml", label: "RSS 订阅", scope: "订阅接口，仍受 Blog 权限限制" }
] as const;

export function managedSiteRoute(url: string): string | null {
  if (!url.startsWith("/") || url.startsWith("//")) return null;
  try {
    const parsed = new URL(url, "https://know-me.invalid");
    if (parsed.origin !== "https://know-me.invalid") return null;
    if (parsed.pathname === "/start" || parsed.pathname.startsWith("/start/")) return "/start";
    if (parsed.pathname === "/feed.xml") return "/feed.xml";
    if (parsed.pathname === "/blog" || parsed.pathname.startsWith("/blog/")) return "/blog";
  } catch { /* malformed URL */ }
  return null;
}

export function visibilityAllows(visibility: HomeEntryVisibility | undefined, authenticated: boolean): boolean {
  switch (visibility) {
    case "disabled": return false;
    case "authenticated": return authenticated;
    case "guest": return !authenticated;
    default: return true;
  }
}

// Visibility of a link never grants permission beyond its underlying route.
export function siteLinkAllowed(settings: SiteSettings, url: string, visibility: HomeEntryVisibility | undefined, authenticated: boolean): boolean {
  if (!visibilityAllows(visibility, authenticated)) return false;
  if (url === "/admin" || url.startsWith("/admin/")) return authenticated;
  const route = managedSiteRoute(url);
  if (!route) return true;
  if (!visibilityAllows(settings.routeAccess[route], authenticated)) return false;
  if (route === "/feed.xml" && !visibilityAllows(settings.routeAccess["/blog"], authenticated)) return false;
  return true;
}

// Effective access includes inherited restrictions (RSS cannot bypass Blog).
export function routeAudience(settings: SiteSettings, path: string) {
  const granted = (authenticated: boolean) => {
    if (!visibilityAllows(settings.routeAccess[path], authenticated)) return false;
    if (path === "/feed.xml" && !visibilityAllows(settings.routeAccess["/blog"], authenticated)) return false;
    return true;
  };
  return { guest: granted(false), authenticated: granted(true) };
}

// Only warn when a visible homepage link leads to a forbidden built-in page.
export function linkAccessWarning(settings: SiteSettings, url: string, visibility: HomeEntryVisibility | undefined): string | null {
  const route = managedSiteRoute(url);
  if (!route || visibility === "disabled") return null;
  const audience = routeAudience(settings, route);
  const affectsGuest = visibilityAllows(visibility, false) && !audience.guest;
  const affectsUser = visibilityAllows(visibility, true) && !audience.authenticated;
  if (!affectsGuest && !affectsUser) return null;

  const targetName = route === "/start" ? "Start" : route === "/blog" ? "Blog" : "RSS";
  if (!audience.guest && !audience.authenticated) {
    return `${targetName} 当前无法访问，显示入口也不能绕过页面权限。`;
  }
  if (affectsGuest && affectsUser) return `${targetName} 对此入口的访问人群不可用。`;
  return affectsGuest
    ? `${targetName} 不允许未登录访问，访客点击入口后仍需要登录。`
    : `${targetName} 不允许已登录访问，显示入口不会放宽页面权限。`;
}
