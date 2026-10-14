import type { HomeEntryVisibility, RouteAccess } from "./repository";

export function allowsVisibility(mode: HomeEntryVisibility | undefined, authenticated: boolean): boolean {
  if (mode === "disabled") return false;
  if (mode === "authenticated") return authenticated;
  if (mode === "guest") return !authenticated;
  return true;
}

export function normalizeRouteAccess(value: unknown, oldStartPublic: boolean): RouteAccess {
  const obj = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const base: RouteAccess = {
    "/start": oldStartPublic ? "all" : "authenticated",
    "/blog": "all",
    "/feed.xml": "all"
  };
  for (const key of Object.keys(base) as (keyof RouteAccess)[]) {
    const v = obj[key];
    if (v === "all" || v === "authenticated" || v === "guest" || v === "disabled") base[key] = v;
  }
  return base;
}

export function routeAllowed(access: RouteAccess, route: keyof RouteAccess, loggedIn: boolean): boolean {
  if (!allowsVisibility(access[route], loggedIn)) return false;
  if (route === "/feed.xml" && !allowsVisibility(access["/blog"], loggedIn)) return false;
  return true;
}

export function linkVisible(access: RouteAccess, url: string, mode: HomeEntryVisibility | undefined, authenticated: boolean): boolean {
  if (!allowsVisibility(mode, authenticated)) return false;
  if (!url.startsWith("/") || url.startsWith("//")) return true;
  const path = url.split(/[?#]/)[0];
  if (path === "/admin" || path.startsWith("/admin/")) return authenticated;
  if (path === "/start" || path.startsWith("/start/")) return routeAllowed(access, "/start", authenticated);
  if (path === "/blog" || path.startsWith("/blog/")) return routeAllowed(access, "/blog", authenticated);
  if (path === "/feed.xml") return routeAllowed(access, "/feed.xml", authenticated);
  return true;
}
