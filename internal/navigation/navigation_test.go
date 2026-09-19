package navigation

import (
	"context"
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

	exported, err := store.ExportItab(ctx)
	if err != nil {
		t.Fatal(err)
	}
	roundTrip, err := store.PreviewItabImport(ctx, string(exported))
	if err != nil {
		t.Fatal(err)
	}
	if roundTrip.Groups != 2 || roundTrip.Items != 5 {
		t.Fatalf("roundtrip preview = %#v", roundTrip)
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
