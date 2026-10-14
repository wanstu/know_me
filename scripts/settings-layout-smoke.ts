import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";

const ui = readFileSync("native-web/src/pages/admin.tsx", "utf8");
const css = postcss.parse(readFileSync("native-web/src/styles.css", "utf8"));

// The name/description/link row may break at smaller panel widths, but
// permission/new-tab/reorder/delete always travel together as one footer.
const homeSection = ui.split('className="km-settings-rows is-entry"')[1]?.split('className="km-settings-rows is-project"')[0];
assert.ok(homeSection, "home entries editor not found");
const footer = homeSection?.split('className="km-entry-footer"')[1]?.split('className="km-link-route-warning"')[0];
assert.ok(footer?.includes('className="km-entry-visibility"'), "visibility must be in footer");
assert.ok(footer?.includes('className="km-settings-checkbox"'), "new-tab checkbox must be in footer");
assert.ok(footer?.includes('className="km-settings-row-actions"'), "move/delete must be in footer");
assert.equal(homeSection?.includes('className="km-entry-link-help"'), false, "repeated help makes every card unnecessarily tall");

function property(selector: string, key: string): string | undefined {
  let found: string | undefined;
  css.walkRules((rule) => {
    if (!rule.parent || rule.parent.type !== "root") return;
    if (rule.selector.trim() !== selector) return;
    rule.walkDecls(key, (declaration) => { found = declaration.value; });
  });
  return found;
}

assert.equal(property(".km-settings-rows.is-entry > div > .km-entry-footer", "grid-row"), "2");
assert.equal(property(".km-entry-footer .km-settings-row-actions", "margin-left"), "auto");
assert.equal(property(".km-settings-rows.is-entry > div", "grid-template-columns")?.includes("2.25fr"), true);
let widths = 0;
css.walkAtRules("container", (rule) => {
  if (/max-width:\s*(1050|570)px/.test(rule.params)) widths++;
});
assert.equal(widths, 2, "both compact and mobile editor breakpoints must remain");
console.log("Home entry layout structural checks passed");
