import assert from "node:assert/strict";
import { MANAGED_SITE_ROUTES, linkAccessWarning, routeAudience, siteLinkAllowed } from "../native-web/src/route-access";
import type { HomeEntryVisibility, SiteSettings } from "../native-web/src/types";

const settings = {
  routeAccess: { "/start": "authenticated", "/blog": "all", "/feed.xml": "all" }
} as unknown as SiteSettings;

assert.equal(MANAGED_SITE_ROUTES.length, 3);
assert.deepEqual(routeAudience(settings, "/start"), { guest: false, authenticated: true });
assert.equal(linkAccessWarning(settings, "/start", "all")?.includes("未登录"), true);
assert.equal(linkAccessWarning(settings, "/start", "authenticated"), null);
assert.equal(linkAccessWarning(settings, "/start", "disabled"), null);
assert.equal(linkAccessWarning(settings, "https://example.com", "all"), null);
assert.equal(siteLinkAllowed(settings, "/start", "all", false), false);

for (const mode of ["all", "authenticated", "guest", "disabled"] as HomeEntryVisibility[]) {
  settings.routeAccess["/blog"] = mode;
  const accessible = (loggedIn: boolean) => mode === "all" || (mode === "authenticated" && loggedIn) || (mode === "guest" && !loggedIn);
  assert.deepEqual(routeAudience(settings, "/blog"), { guest: accessible(false), authenticated: accessible(true) });
  assert.deepEqual(routeAudience(settings, "/feed.xml"), { guest: accessible(false), authenticated: accessible(true) }, "RSS must inherit Blog restriction");
}
settings.routeAccess["/blog"] = "all";
settings.routeAccess["/feed.xml"] = "disabled";
assert.equal(linkAccessWarning(settings, "/feed.xml", "all")?.includes("无法访问"), true);
console.log("Native homepage route UI rules passed");
