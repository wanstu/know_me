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

func TestOpenUpgradesV014DatabaseWithoutLosingPostData(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "know-me-v014.db")

	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)"); err != nil {
		t.Fatal(err)
	}
	for _, migration := range []string{"001_initial", "002_fts_delete_support"} {
		body, err := migrationsFS.ReadFile("migrations/" + migration + ".sql")
		if err != nil {
			legacy.Close()
			t.Fatal(err)
		}
		if _, err := legacy.Exec(string(body)); err != nil {
			legacy.Close()
			t.Fatalf("apply legacy migration %s: %v", migration, err)
		}
		if _, err := legacy.Exec("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", migration, int64(1)); err != nil {
			legacy.Close()
			t.Fatal(err)
		}
	}

	const publishedAt int64 = 1_700_000_000_000
	const elapsedScheduledAt int64 = 1_700_000_100_000
	const futureScheduledAt int64 = 4_102_444_800_000
	for _, row := range []struct {
		slug        string
		title       string
		content     string
		status      string
		publishedAt any
	}{
		{slug: "legacy-published", title: "Legacy Published", content: "published body", status: "published", publishedAt: publishedAt},
		{slug: "legacy-elapsed-scheduled", title: "Legacy Elapsed Scheduled", content: "elapsed body", status: "scheduled", publishedAt: elapsedScheduledAt},
		{slug: "legacy-future-scheduled", title: "Legacy Future Scheduled", content: "future body", status: "scheduled", publishedAt: futureScheduledAt},
		{slug: "legacy-draft", title: "Legacy Draft", content: "draft body", status: "draft", publishedAt: nil},
	} {
		if _, err := legacy.Exec(
			"INSERT INTO posts (slug, title, excerpt, content_md, status, pinned, seo_title, seo_description, published_at, created_at, updated_at) VALUES (?, ?, '', ?, ?, 0, '', '', ?, ?, ?)",
			row.slug, row.title, row.content, row.status, row.publishedAt, publishedAt, publishedAt,
		); err != nil {
			legacy.Close()
			t.Fatal(err)
		}
	}
	if _, err := legacy.Exec("INSERT INTO settings (key, value_json, updated_at) VALUES ('legacy-setting', '{\"kept\":true}', ?)", publishedAt); err != nil {
		legacy.Close()
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	var title, content, status string
	var gotPublishedAt, firstPublishedAt sql.NullInt64
	if err := db.SQL.QueryRow(
		"SELECT title, content_md, status, published_at, first_published_at FROM posts WHERE slug = 'legacy-published'",
	).Scan(&title, &content, &status, &gotPublishedAt, &firstPublishedAt); err != nil {
		t.Fatal(err)
	}
	if title != "Legacy Published" || content != "published body" || status != "published" || !gotPublishedAt.Valid || gotPublishedAt.Int64 != publishedAt {
		t.Fatalf("legacy published post changed: title=%q content=%q status=%q published=%#v", title, content, status, gotPublishedAt)
	}
	if !firstPublishedAt.Valid || firstPublishedAt.Int64 != publishedAt {
		t.Fatalf("legacy published first_published_at=%#v want %d", firstPublishedAt, publishedAt)
	}

	for _, check := range []struct {
		slug string
		want sql.NullInt64
	}{
		{slug: "legacy-elapsed-scheduled", want: sql.NullInt64{Int64: elapsedScheduledAt, Valid: true}},
		{slug: "legacy-future-scheduled", want: sql.NullInt64{}},
		{slug: "legacy-draft", want: sql.NullInt64{}},
	} {
		var got sql.NullInt64
		if err := db.SQL.QueryRow("SELECT first_published_at FROM posts WHERE slug = ?", check.slug).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != check.want {
			t.Fatalf("%s first_published_at=%#v want %#v", check.slug, got, check.want)
		}
	}

	var setting string
	if err := db.SQL.QueryRow("SELECT value_json FROM settings WHERE key = 'legacy-setting'").Scan(&setting); err != nil {
		t.Fatal(err)
	}
	if setting != "{\"kept\":true}" {
		t.Fatalf("legacy setting changed: %q", setting)
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
