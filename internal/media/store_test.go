package media

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/wanstu/know_me/internal/database"
)

func TestMediaLifecycle(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	db, err := database.Open(filepath.Join(root, "media.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store, err := NewStore(db.SQL, filepath.Join(root, "uploads"))
	if err != nil {
		t.Fatal(err)
	}

	png := []byte{137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3}
	item, err := store.Save(context.Background(), "smoke.png", "image/png", png, "smoke")
	if err != nil {
		t.Fatal(err)
	}
	if item.URL == "" || item.StorageKey == "" {
		t.Fatalf("item=%#v", item)
	}
	path, err := store.FilePath(item.StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}

	items, err := store.List(context.Background(), 20)
	if err != nil || len(items) != 1 {
		t.Fatalf("list=%d err=%v", len(items), err)
	}

	deleted, err := store.Delete(context.Background(), item.ID)
	if err != nil || !deleted {
		t.Fatalf("delete=%v err=%v", deleted, err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("file still exists: %v", err)
	}

	if _, err := store.FilePath("../escape.png"); err == nil {
		t.Fatal("path traversal accepted")
	}
}
