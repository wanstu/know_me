import assert from "node:assert/strict";
import { isHomeEntryVisible } from "../native-web/src/home-entry-visibility";
import { HOME_ENTRY_LINK_PRESETS, homeEntryPreset, validHomeEntryLink } from "../native-web/src/home-entry-links";

const cases: Array<[string | undefined, boolean, boolean]> = [
  ["all", false, true], ["all", true, true],
  ["authenticated", false, false], ["authenticated", true, true],
  ["guest", false, true], ["guest", true, false],
  ["disabled", false, false], ["disabled", true, false],
  [undefined, false, true]
];
for (const [visibility, loggedIn, expected] of cases) {
  assert.equal(isHomeEntryVisible(visibility as Parameters<typeof isHomeEntryVisible>[0], loggedIn), expected);
}
const internal = ["/", "/start", "/blog", "/blog#archive", "#about", "#projects", "/admin", "/login", "/feed.xml"];
for (const url of internal) assert.equal(validHomeEntryLink(url), true, url);
for (const entry of HOME_ENTRY_LINK_PRESETS) {
  assert.equal(validHomeEntryLink(entry.url), true, entry.label);
  assert.equal(homeEntryPreset(entry.url), entry.url, entry.url);
}
for (const url of ["https://example.com/path?a=1", "http://example.com/page", "mailto:someone@example.org"]) {
  assert.equal(validHomeEntryLink(url), true, url);
  assert.equal(homeEntryPreset(url), "", "external urls remain editable");
}
for (const url of ["", "#", "//evil.example", "/\\evil.example", "javascript:alert(1)", "data:text/html,x", "ftp://example.org"]) {
  assert.equal(validHomeEntryLink(url), false, url);
}
assert.equal(homeEntryPreset("/my-custom-page"), "", "custom local paths are editable");
console.log("Home entry visibility and link preset tests passed");
