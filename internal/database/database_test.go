package database

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestOpenAppliesCompatibleMigrations(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "know-me.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	ids, err := db.MigrationIDs()
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 3 || ids[0] != "001_initial" || ids[1] != "002_fts_delete_support" || ids[2] != "003_post_first_published_at" {
		t.Fatalf("migration ids = %#v", ids)
	}

	for _, table := range []string{"users", "sessions", "settings", "nav_groups", "nav_items", "posts", "posts_fts"} {
		var name string
		if err := db.SQL.QueryRow("SELECT name FROM sqlite_master WHERE name = ?", table).Scan(&name); err != nil {
			t.Fatalf("table %s: %v", table, err)
		}
	}
	if _, err := db.SQL.Exec("INSERT INTO posts_fts(rowid,title,excerpt,content_text) VALUES(1,'hello','world','native')"); err != nil {
		t.Fatalf("fts5 unavailable: %v", err)
	}
	var count int
	if err := db.SQL.QueryRow("SELECT COUNT(*) FROM posts_fts WHERE posts_fts MATCH 'native'").Scan(&count); err != nil && err != sql.ErrNoRows {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("fts result count = %d", count)
	}
}

func TestResolvePathPreservesLegacyDatabaseURL(t *testing.T) {
	t.Parallel()
	data := filepath.Join("var", "know-me")
	if got := ResolvePath(data, "./data/custom.db"); got != filepath.Join(data, "custom.db") {
		t.Fatalf("legacy path = %q", got)
	}
	if got := ResolvePath(data, ""); got != filepath.Join(data, "know-me.db") {
		t.Fatalf("default path = %q", got)
	}
}
