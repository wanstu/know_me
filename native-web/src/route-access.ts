import type { HomeEntryVisibility, SiteSettings } from "./types";

export const MANAGED_SITE_ROUTES = [
  { path: "/start", label: "Start 起始页" },
  { path: "/blog", label: "Blog 文章与笔记" },
  { path: "/feed.xml", label: "RSS 订阅" }
] as const;

export function managedSiteRoute(url: string): string | null {
  if (!url.startsWith("/") || url.startsWith("//")) return null;
  try {
    const parsed = new URL(url, "https://know-me.invalid");
    if (parsed.origin !== "https://know-me.invalid") return null;
    if (parsed.pathname === "/start") return "/start";
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
