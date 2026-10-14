import assert from "node:assert/strict";
import { linkVisible, normalizeRouteAccess, routeAllowed } from "../lib/settings/access";

const legacy = normalizeRouteAccess(undefined, false);
assert.equal(legacy["/start"], "authenticated");
assert.equal(legacy["/blog"], "all");
assert.equal(legacy["/feed.xml"], "all");
assert.equal(linkVisible(legacy, "/blog", "disabled", false), false);
assert.equal(routeAllowed(legacy, "/blog", false), true, "hiding a card must not lock the page");
assert.equal(linkVisible(legacy, "/start", "all", false), false);

const all = ["all", "authenticated", "guest", "disabled"] as const;
for (const mode of all) {
  const access = normalizeRouteAccess({ "/start":mode, "/blog":mode, "/feed.xml": "all" },false);
  for (const authenticated of [false, true]) {
    const expected = mode === "all" || mode === "authenticated" && authenticated || mode === "guest" && !authenticated;
    assert.equal(routeAllowed(access, "/start", authenticated), expected, mode + " Start");
    assert.equal(routeAllowed(access, "/blog", authenticated), expected, mode + " Blog");
    assert.equal(routeAllowed(access, "/feed.xml", authenticated), expected, mode + " RSS cannot bypass Blog");
  }
}
assert.equal(normalizeRouteAccess({"/start":"invalid", "/other":"disabled"},true)["/start"], "all");
console.log("Next route access policy smoke: passed");
