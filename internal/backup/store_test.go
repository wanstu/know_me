package backup

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/wanstu/know_me/internal/blog"
	"github.com/wanstu/know_me/internal/database"
	"github.com/wanstu/know_me/internal/navigation"
	"github.com/wanstu/know_me/internal/settings"
)

func TestBackupRoundTrip(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	db, err := database.Open(filepath.Join(root, "know-me.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	uploads := filepath.Join(root, "uploads")
	store, err := NewStore(db.SQL, uploads)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	nav := navigation.NewStore(db.SQL)
	groupID, err := nav.CreateGroup(ctx, navigation.GroupInput{Name: "Backup Group", Icon: "B"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := nav.CreateItem(ctx, navigation.ItemInput{GroupID: groupID, Name: "Backup Link", URL: "https://example.com/"}); err != nil {
		t.Fatal(err)
	}

	posts := blog.NewStore(db.SQL)
	post, err := posts.Save(ctx, blog.SaveInput{
		Title: "Backup Post", Slug: "backup-post", ContentMD: "# Backup\n\nbackup_unique_term", Status: blog.StatusPublished,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	settingsStore := settings.NewStore(db.SQL)
	current, err := settingsStore.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	current.Quote = "backup-marker"
	if _, err := settingsStore.SetSite(ctx, current); err != nil {
		t.Fatal(err)
	}

	if err := os.MkdirAll(filepath.Join(uploads, "2026", "09"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(uploads, "2026", "09", "test.txt"), []byte("backup-file"), 0o644); err != nil {
		t.Fatal(err)
	}

	bytes, err := store.Create(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(bytes) == 0 {
		t.Fatal("empty backup")
	}

	if err := posts.Delete(ctx, post.ID); err != nil {
		t.Fatal(err)
	}
	mutated, _ := settingsStore.GetSite(ctx)
	mutated.Quote = "mutated"
	if _, err := settingsStore.SetSite(ctx, mutated); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(uploads); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(uploads, 0o755); err != nil {
		t.Fatal(err)
	}

	result, err := store.Restore(ctx, bytes)
	if err != nil {
		t.Fatal(err)
	}
	if result.Posts < 1 || result.NavigationItems < 1 {
		t.Fatalf("restore result=%#v", result)
	}

	found, err := posts.ListPublished(ctx, "backup_unique_term", 20)
	if err != nil || len(found) == 0 {
		t.Fatalf("post restore failed: %v %#v", err, found)
	}
	tree, err := nav.Tree(ctx, true)
	if err != nil || len(tree.Groups) == 0 || tree.Groups[0].Name != "Backup Group" {
		t.Fatalf("navigation restore failed: %v %#v", err, tree)
	}
	restoredSettings, err := settingsStore.GetSite(ctx)
	if err != nil || restoredSettings.Quote != "backup-marker" {
		t.Fatalf("settings restore failed: %v %#v", err, restoredSettings)
	}
	file, err := os.ReadFile(filepath.Join(uploads, "2026", "09", "test.txt"))
	if err != nil || string(file) != "backup-file" {
		t.Fatalf("upload restore failed: %v %q", err, file)
	}
}

func TestSafeRelativeRejectsTraversal(t *testing.T) {
	t.Parallel()
	for _, value := range []string{"", "../x", "a/../x", "a//b", "./x"} {
		if _, err := safeRelative(value); err == nil {
			t.Fatalf("accepted unsafe path %q", value)
		}
	}
}
