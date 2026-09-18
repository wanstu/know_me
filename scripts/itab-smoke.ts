import fs from "node:fs";
import path from "node:path";
import { applyItabImport, exportItab, previewItabImport } from "../lib/navigation/itab";
import { getNavigationTree } from "../lib/navigation/repository";

const fixturePath = path.join(process.cwd(), "tests", "fixtures", "itab-sample.itabdata");
const raw = fs.readFileSync(fixturePath, "utf8");
const backup = exportItab();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  const preview = previewItabImport(raw);
  assert(preview.groups === 2, "expected 2 groups");
  assert(preview.items === 5, "expected 5 items including folder child");
  assert(preview.folders === 1, "expected 1 folder");
  assert(preview.browserLocal === 1, "expected 1 browser-local URL");

  const result = applyItabImport(raw, "replace", true);
  assert(result.addedGroups === 2, "replace should add 2 groups");
  const tree = getNavigationTree(true);
  assert(tree.groups.length === 2, "tree should contain 2 groups");
  assert(tree.groups[0].items.length === 3, "home should contain 3 top-level items");
  const folder = tree.groups[0].items.find((item) => item.type === "folder");
  assert(folder?.children.length === 1, "folder child should be preserved");
  assert(tree.groups[0].items.some((item) => item.browserLocal), "browser-local marker should be preserved");

  const exported = JSON.parse(exportItab()) as { navConfig?: unknown[] };
  assert(Array.isArray(exported.navConfig) && exported.navConfig.length === 2, "export should contain 2 groups");

  const roundTripPreview = previewItabImport(JSON.stringify(exported));
  assert(roundTripPreview.groups === 2, "round-trip group count mismatch");
  assert(roundTripPreview.items === 5, "round-trip item count mismatch");
  console.log("itab smoke: PASS");
  console.log(`groups=${preview.groups} items=${preview.items} folders=${preview.folders} browserLocal=${preview.browserLocal}`);
} finally {
  applyItabImport(backup, "replace", true);
}
