import fs from "node:fs";
import path from "node:path";
import { applyItabImport, previewItabImport } from "../lib/navigation/itab";

function arg(name: string) {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function has(name: string) {
  return process.argv.includes("--" + name);
}

const input = arg("file");
if (!input) {
  console.error("Usage: npm run itab:import -- --file <path> [--strategy merge|replace] [--overwrite]");
  process.exit(2);
}

const filePath = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
const raw = fs.readFileSync(filePath, "utf8");
const strategy = arg("strategy") === "replace" ? "replace" : "merge";
const overwrite = has("overwrite");

const preview = previewItabImport(raw);
console.log(
  "Preview: groups=" + preview.groups +
  " items=" + preview.items +
  " folders=" + preview.folders +
  " browserLocal=" + preview.browserLocal +
  " conflicts=" + preview.conflicts
);

const result = applyItabImport(raw, strategy, overwrite);
console.log(
  "Imported: addedGroups=" + result.addedGroups +
  " addedItems=" + result.addedItems +
  " updatedGroups=" + result.updatedGroups +
  " updatedItems=" + result.updatedItems +
  " skippedGroups=" + result.skippedGroups +
  " skippedItems=" + result.skippedItems
);
