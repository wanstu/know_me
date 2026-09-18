import {
  bulkDeleteItems,
  bulkMoveItems,
  createGroup,
  createItem,
  deleteGroup,
  getNavigationTree,
  reorderItems,
  updateItem
} from "../lib/navigation/repository";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrow(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && error.message === code) return;
    throw error;
  }
  throw new Error("expected error: " + code);
}

const marker = "nav-smoke-" + Date.now();
const groupA = createGroup({ name: marker + "-A" });
const groupB = createGroup({ name: marker + "-B" });

try {
  const folder = createItem({
    groupId: groupA,
    type: "folder",
    name: "Folder"
  });
  const child = createItem({
    groupId: groupA,
    parentId: folder,
    name: "Browser Local",
    url: "about:config"
  });

  let tree = getNavigationTree(true);
  let a = tree.groups.find((group) => group.id === groupA);
  let folderRow = a?.items.find((item) => item.id === folder);
  assert(folderRow?.children[0]?.browserLocal === true, "browser-local URL was not detected");

  updateItem(folder, { groupId: groupB, parentId: null });
  tree = getNavigationTree(true);
  const b = tree.groups.find((group) => group.id === groupB);
  folderRow = b?.items.find((item) => item.id === folder);
  assert(Boolean(folderRow), "folder did not move across groups");
  assert(folderRow?.children.some((item) => item.id === child), "folder child was lost after cross-group move");
  assert(folderRow?.children.every((item) => item.groupId === groupB), "folder descendants did not follow group move");

  const folder2 = createItem({
    groupId: groupB,
    type: "folder",
    name: "Folder 2"
  });
  updateItem(child, { groupId: groupB, parentId: folder2 });

  const child2 = createItem({
    groupId: groupB,
    parentId: folder2,
    name: "Second",
    url: "https://example.com/"
  });
  reorderItems(groupB, folder2, [child2, child]);

  tree = getNavigationTree(true);
  const groupBAfter = tree.groups.find((group) => group.id === groupB);
  const folder2After = groupBAfter?.items.find((item) => item.id === folder2);
  assert(folder2After?.children.map((item) => item.id).join(",") === [child2, child].join(","), "folder child reorder failed");

  expectThrow(
    () => createItem({ groupId: groupA, name: "Unsafe", url: "javascript:alert(1)" }),
    "unsupported_nav_url"
  );

  expectThrow(
    () => createItem({ groupId: groupA, parentId: folder2, name: "Mismatch", url: "https://example.com/" }),
    "parent_group_mismatch"
  );

  expectThrow(
    () => updateItem(folder2, { parentId: folder2 }),
    "navigation_cycle"
  );

  const moved = bulkMoveItems([folder2, child], groupA, null);
  assert(moved === 1, "bulk move should collapse descendant selections");
  tree = getNavigationTree(true);
  const movedFolder = tree.groups.find((group) => group.id === groupA)?.items.find((item) => item.id === folder2);
  assert(Boolean(movedFolder), "bulk move did not move folder");
  assert(movedFolder?.children.length === 2, "bulk move did not preserve folder hierarchy");
  assert(movedFolder?.children.every((item) => item.groupId === groupA), "bulk move did not cascade group to children");

  const deleted = bulkDeleteItems([folder2, child]);
  assert(deleted === 1, "bulk delete should collapse descendant selections");
  tree = getNavigationTree(true);
  assert(!tree.groups.some((group) => group.items.some((item) => item.id === folder2)), "bulk delete left folder behind");

  console.log("navigation smoke: PASS");
  console.log("browser-local / cross-group / folder reorder / batch move-delete / validation verified");
} finally {
  deleteGroup(groupA);
  deleteGroup(groupB);
}
