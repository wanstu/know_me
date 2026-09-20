package navigation

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/wanstu/know_me/internal/database"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	db, err := database.Open(filepath.Join(t.TempDir(), "navigation.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewStore(db.SQL)
}

func TestNavigationRepositoryBehavior(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	ctx := context.Background()

	groupA, err := store.CreateGroup(ctx, GroupInput{Name: "A"})
	if err != nil {
		t.Fatal(err)
	}
	groupB, err := store.CreateGroup(ctx, GroupInput{Name: "B"})
	if err != nil {
		t.Fatal(err)
	}

	folder, err := store.CreateItem(ctx, ItemInput{GroupID: groupA, Type: ItemFolder, Name: "Folder"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := store.CreateItem(ctx, ItemInput{GroupID: groupA, ParentID: &folder, Name: "Browser Local", URL: "about:config"})
	if err != nil {
		t.Fatal(err)
	}

	tree, err := store.Tree(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	folderRow := findTreeItem(tree, folder)
	if folderRow == nil || len(folderRow.Children) != 1 || !folderRow.Children[0].BrowserLocal {
		t.Fatalf("browser-local child not preserved: %#v", folderRow)
	}

	g := groupB
	var parent *int64
	ok, err := store.UpdateItem(ctx, folder, ItemPatch{GroupID: &g, ParentID: &parent})
	if err != nil || !ok {
		t.Fatalf("move folder: ok=%v err=%v", ok, err)
	}
	tree, err = store.Tree(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	folderRow = findTreeItem(tree, folder)
	if folderRow == nil || folderRow.GroupID != groupB || len(folderRow.Children) != 1 || folderRow.Children[0].GroupID != groupB {
		t.Fatalf("folder descendants did not follow group: %#v", folderRow)
	}

	folder2, err := store.CreateItem(ctx, ItemInput{GroupID: groupB, Type: ItemFolder, Name: "Folder 2"})
	if err != nil {
		t.Fatal(err)
	}
	parent = &folder2
	g = groupB
	ok, err = store.UpdateItem(ctx, child, ItemPatch{GroupID: &g, ParentID: &parent})
	if err != nil || !ok {
		t.Fatalf("move child: ok=%v err=%v", ok, err)
	}

	child2, err := store.CreateItem(ctx, ItemInput{GroupID: groupB, ParentID: &folder2, Name: "Second", URL: "https://example.com/"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.ReorderItems(ctx, groupB, &folder2, []int64{child2, child}); err != nil {
		t.Fatal(err)
	}
	tree, _ = store.Tree(ctx, true)
	folder2Row := findTreeItem(tree, folder2)
	if folder2Row == nil || len(folder2Row.Children) != 2 || folder2Row.Children[0].ID != child2 || folder2Row.Children[1].ID != child {
		t.Fatalf("child reorder failed: %#v", folder2Row)
	}

	if err := store.MoveItem(ctx, child2, groupB, nil, 0); err != nil {
		t.Fatal(err)
	}
	tree, _ = store.Tree(ctx, true)
	var groupBRow *Group
	for _, group := range tree.Groups {
		if group.ID == groupB {
			groupBRow = group
			break
		}
	}
	if groupBRow == nil || len(groupBRow.Items) == 0 || groupBRow.Items[0].ID != child2 || groupBRow.Items[0].ParentID != nil {
		t.Fatalf("move item to root failed: %#v", groupBRow)
	}
	if err := store.MoveItem(ctx, child2, groupB, &folder2, 0); err != nil {
		t.Fatal(err)
	}
	tree, _ = store.Tree(ctx, true)
	folder2Row = findTreeItem(tree, folder2)
	if folder2Row == nil || len(folder2Row.Children) != 2 || folder2Row.Children[0].ID != child2 {
		t.Fatalf("move item into folder failed: %#v", folder2Row)
	}

	if _, err := store.CreateItem(ctx, ItemInput{GroupID: groupA, Name: "Unsafe", URL: "javascript:alert(1)"}); err == nil || err.Error() != "unsupported_nav_url" {
		t.Fatalf("expected unsupported_nav_url, got %v", err)
	}
	if _, err := store.CreateItem(ctx, ItemInput{GroupID: groupA, ParentID: &folder2, Name: "Mismatch", URL: "https://example.com/"}); err == nil || err.Error() != "parent_group_mismatch" {
		t.Fatalf("expected parent_group_mismatch, got %v", err)
	}
	self := &folder2
	if _, err := store.UpdateItem(ctx, folder2, ItemPatch{ParentID: &self}); err == nil || err.Error() != "navigation_cycle" {
		t.Fatalf("expected navigation_cycle, got %v", err)
	}

	moved, err := store.BulkMove(ctx, []int64{folder2, child}, groupA, nil)
	if err != nil || moved != 1 {
		t.Fatalf("bulk move: moved=%d err=%v", moved, err)
	}
	tree, _ = store.Tree(ctx, true)
	movedFolder := findTreeItem(tree, folder2)
	if movedFolder == nil || movedFolder.GroupID != groupA || len(movedFolder.Children) != 2 {
		t.Fatalf("bulk move hierarchy: %#v", movedFolder)
	}
	for _, item := range movedFolder.Children {
		if item.GroupID != groupA {
			t.Fatalf("child group not cascaded: %#v", item)
		}
	}

	deleted, err := store.BulkDelete(ctx, []int64{folder2, child})
	if err != nil || deleted != 1 {
		t.Fatalf("bulk delete: deleted=%d err=%v", deleted, err)
	}
	tree, _ = store.Tree(ctx, true)
	if findTreeItem(tree, folder2) != nil {
		t.Fatal("bulk delete left folder")
	}
}

func TestPublicTreeDoesNotPromoteChildrenOfPrivateParents(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	ctx := context.Background()

	groupID, err := store.CreateGroup(ctx, GroupInput{Name: "Public Group", Visibility: VisibilityPublic})
	if err != nil {
		t.Fatal(err)
	}
	privateFolder, err := store.CreateItem(ctx, ItemInput{
		GroupID: groupID, Type: ItemFolder, Name: "Private Folder", Visibility: VisibilityPrivate,
	})
	if err != nil {
		t.Fatal(err)
	}
	publicChild, err := store.CreateItem(ctx, ItemInput{
		GroupID: groupID, ParentID: &privateFolder, Name: "Public Child",
		URL: "https://child.example.com/", Visibility: VisibilityPublic,
	})
	if err != nil {
		t.Fatal(err)
	}
	publicRoot, err := store.CreateItem(ctx, ItemInput{
		GroupID: groupID, Name: "Public Root", URL: "https://root.example.com/", Visibility: VisibilityPublic,
	})
	if err != nil {
		t.Fatal(err)
	}
	localPublic, err := store.CreateItem(ctx, ItemInput{
		GroupID: groupID, Name: "Local Public", URL: "about:config", Visibility: VisibilityPublic,
	})
	if err != nil {
		t.Fatal(err)
	}

	publicTree, err := store.Tree(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if findTreeItem(publicTree, privateFolder) != nil {
		t.Fatal("private folder leaked into public tree")
	}
	if findTreeItem(publicTree, publicChild) != nil {
		t.Fatal("public child was promoted out of private parent")
	}
	if findTreeItem(publicTree, publicRoot) == nil {
		t.Fatal("public root item missing from public tree")
	}
	if findTreeItem(publicTree, localPublic) != nil {
		t.Fatal("browser-local item leaked into public tree")
	}

	privateTree, err := store.Tree(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	parent := findTreeItem(privateTree, privateFolder)
	if parent == nil || len(parent.Children) != 1 || parent.Children[0].ID != publicChild {
		t.Fatalf("full tree hierarchy changed: %#v", parent)
	}
	if local := findTreeItem(privateTree, localPublic); local == nil || !local.BrowserLocal {
		t.Fatalf("browser-local item missing from authenticated tree: %#v", local)
	}
}

func TestItabRoundTrip(t *testing.T) {
	t.Parallel()
	store := newTestStore(t)
	ctx := context.Background()
	raw, err := os.ReadFile("testdata/itab-sample.itabdata")
	if err != nil {
		t.Fatal(err)
	}

	preview, err := store.PreviewItabImport(ctx, string(raw))
	if err != nil {
		t.Fatal(err)
	}
	if preview.Groups != 2 || preview.Items != 5 || preview.Folders != 1 || preview.BrowserLocal != 1 {
		t.Fatalf("preview = %#v", preview)
	}

	result, err := store.ApplyItabImport(ctx, string(raw), "replace", true)
	if err != nil {
		t.Fatal(err)
	}
	if result.AddedGroups != 2 || result.AddedItems != 5 {
		t.Fatalf("import result = %#v", result)
	}
	tree, err := store.Tree(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(tree.Groups) != 2 || len(tree.Groups[0].Items) != 3 {
		t.Fatalf("tree = %#v", tree)
	}
	var folder *Item
	for _, item := range tree.Groups[0].Items {
		if item.Type == ItemFolder {
			folder = item
		}
	}
	if folder == nil || len(folder.Children) != 1 {
		t.Fatalf("folder = %#v", folder)
	}

	// Merge without overwrite must preserve the existing item while still
	// importing newly-added content.
	firstItem := tree.Groups[0].Items[0]
	customExtra := map[string]any{"openMode": "same_tab", "custom": "keep-me"}
	if _, err := store.UpdateItem(ctx, firstItem.ID, ItemPatch{Extra: &customExtra}); err != nil {
		t.Fatal(err)
	}
	mergeResult, err := store.ApplyItabImport(ctx, string(raw), "merge", false)
	if err != nil {
		t.Fatal(err)
	}
	if mergeResult.SkippedGroups == 0 || mergeResult.SkippedItems == 0 {
		t.Fatalf("merge should preserve conflicts: %#v", mergeResult)
	}
	tree, err = store.Tree(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	preserved := findTreeItem(tree, firstItem.ID)
	if preserved == nil || preserved.Extra["openMode"] != "same_tab" || preserved.Extra["custom"] != "keep-me" {
		t.Fatalf("merge overwrote existing extra: %#v", preserved)
	}

	rootIDs := make([]int64, len(tree.Groups[0].Items))
	for index, item := range tree.Groups[0].Items {
		rootIDs[index] = item.ID
	}
	var mergeDoc map[string]any
	if err := json.Unmarshal(raw, &mergeDoc); err != nil {
		t.Fatal(err)
	}
	groups, _ := mergeDoc["navConfig"].([]any)
	firstGroup, _ := groups[0].(map[string]any)
	children, _ := firstGroup["children"].([]any)
	firstGroup["children"] = append(children, map[string]any{
		"id": "merge-new-item", "url": "https://merge-new.example.com/", "type": "text", "name": "新增链接",
	})
	groups = append(groups, map[string]any{
		"id": "merge-new-group", "name": "新增分组", "icon": "plus",
		"children": []any{map[string]any{
			"id": "merge-new-group-item", "url": "https://merge-group.example.com/", "type": "text", "name": "分组链接",
		}},
	})
	mergeDoc["navConfig"] = groups
	mergeRaw, err := json.Marshal(mergeDoc)
	if err != nil {
		t.Fatal(err)
	}
	appendResult, err := store.ApplyItabImport(ctx, string(mergeRaw), "merge", false)
	if err != nil {
		t.Fatal(err)
	}
	if appendResult.AddedGroups != 1 || appendResult.AddedItems != 2 {
		t.Fatalf("merge append result=%#v", appendResult)
	}
	tree, err = store.Tree(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(tree.Groups) != 3 || tree.Groups[2].Name != "新增分组" {
		t.Fatalf("new group not appended: %#v", tree.Groups)
	}
	if len(tree.Groups[0].Items) != len(rootIDs)+1 || tree.Groups[0].Items[len(rootIDs)].Name != "新增链接" {
		t.Fatalf("new item not appended: %#v", tree.Groups[0].Items)
	}
	for index, id := range rootIDs {
		if tree.Groups[0].Items[index].ID != id {
			t.Fatalf("merge reordered existing item at %d: got %d want %d", index, tree.Groups[0].Items[index].ID, id)
		}
	}

	exported, err := store.ExportItab(ctx)
	if err != nil {
		t.Fatal(err)
	}
	roundTrip, err := store.PreviewItabImport(ctx, string(exported))
	if err != nil {
		t.Fatal(err)
	}
	if roundTrip.Groups != 3 || roundTrip.Items != 7 {
		t.Fatalf("roundtrip preview = %#v", roundTrip)
	}
	if roundTrip.Conflicts == 0 || len(roundTrip.ConflictExamples) == 0 {
		t.Fatalf("missing conflict examples: %#v", roundTrip)
	}
}

func findTreeItem(tree Tree, id int64) *Item {
	var walk func([]*Item) *Item
	walk = func(items []*Item) *Item {
		for _, item := range items {
			if item.ID == id {
				return item
			}
			if found := walk(item.Children); found != nil {
				return found
			}
		}
		return nil
	}
	for _, group := range tree.Groups {
		if found := walk(group.Items); found != nil {
			return found
		}
	}
	return nil
}
