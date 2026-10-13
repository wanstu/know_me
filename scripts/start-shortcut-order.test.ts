import assert from "node:assert/strict";
import type { NavItem } from "../native-web/src/types";
import { moveStandaloneLink, quickSortStandaloneLinks, replaceLinkOrder } from "../native-web/src/start-shortcut-order";

const link = (id: number, name: string, visitCount = 0) => ({
  id, type: "link", name, visitCount
} as NavItem);
const folder = (id: number) => ({ id, type: "folder", name: "文件夹", children: [] } as unknown as NavItem);

const items = [link(1, "Z", 2), folder(10), link(2, "A", 10), folder(20), link(3, "M", 5)];
const originalIDs = items.map((x) => x.id);
assert.deepEqual(quickSortStandaloneLinks(items, "name").map((x) => x.id), [2, 3, 1]);
assert.deepEqual(quickSortStandaloneLinks(items, "visits").map((x) => x.id), [2, 3, 1]);
assert.deepEqual(quickSortStandaloneLinks(items, "reverse").map((x) => x.id), [3, 2, 1]);
assert.deepEqual(items.map((x) => x.id), originalIDs, "Sorting must not mutate source");
assert.deepEqual(replaceLinkOrder(items, quickSortStandaloneLinks(items, "name")), [2, 10, 3, 20, 1], "Folders stay in their original slots");
assert.deepEqual(moveStandaloneLink(items, 3, 1)?.map((x) => x.id), [3, 1, 2]);
assert.equal(moveStandaloneLink(items, 3, 10), null, "Cannot drag a link onto a folder in this list");
assert.throws(() => replaceLinkOrder(items, [items[0], items[0], items[4]]), /invalid_shortcut_order/);
console.log("Start shortcut sorting tests passed");
