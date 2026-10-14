import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { allowsVisibility, routeAllowed } from "./access";
import { getSiteSettings, type RouteAccess } from "./repository";

// Enforce real access on the server, before loading sensitive page data.
// Hiding a homepage entry is only presentation, never authorization.
export async function requirePageAccess(route: keyof RouteAccess, path: string) {
  const site = getSiteSettings();
  const user = await getSessionUser();
  if (routeAllowed(site.routeAccess, route, Boolean(user))) return { settings: site, user };
  const denied = route === "/feed.xml" && allowsVisibility(site.routeAccess[route], Boolean(user))
    ? site.routeAccess["/blog"] : site.routeAccess[route];
  if (denied === "authenticated" && !user) redirect("/login?next=" + encodeURIComponent(path));
  notFound();
}
