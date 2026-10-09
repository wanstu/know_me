package settings

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/wanstu/know_me/internal/database"
)

func TestHomeEntryVisibilityNormalizationAndPersistence(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "site.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db.SQL)
	ctx := context.Background()

	defaults, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range defaults.HomeEntries {
		if entry.Visibility != HomeEntryAll {
			t.Fatalf("default entry %q visibility = %q", entry.ID, entry.Visibility)
		}
	}

	entries := []HomeEntry{
		{ID: "public", Name: "公共", URL: "/blog"}, // old saved data: no visibility
		{ID: "member", Name: "登录可见", URL: "/start", Visibility: HomeEntryAuthenticated},
		{ID: "guest", Name: "访客可见", URL: "/login", Visibility: HomeEntryGuest},
		{ID: "invalid", Name: "无效值", URL: "/about", Visibility: "unknown"},
	}
	saved, err := store.UpdateSite(ctx, SitePatch{HomeEntries: &entries})
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range []HomeEntryVisibility{HomeEntryAll, HomeEntryAuthenticated, HomeEntryGuest, HomeEntryAll} {
		if saved.HomeEntries[i].Visibility != want {
			t.Fatalf("saved[%d].Visibility = %q, want %q", i, saved.HomeEntries[i].Visibility, want)
		}
	}
	again, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(again.HomeEntries) != 4 || again.HomeEntries[1].Visibility != HomeEntryAuthenticated || again.HomeEntries[2].Visibility != HomeEntryGuest {
		t.Fatalf("roundtrip: %#v", again.HomeEntries)
	}
	for _, tc := range []struct {
		authenticated bool
		ids           []string
	}{
		{false, []string{"public", "guest", "invalid"}},
		{true, []string{"public", "member", "invalid"}},
	} {
		visible := VisibleHomeEntries(again.HomeEntries, tc.authenticated)
		if len(visible) != len(tc.ids) {
			t.Fatalf("authenticated=%v got %d entries, want %d", tc.authenticated, len(visible), len(tc.ids))
		}
		for i, want := range tc.ids {
			if visible[i].ID != want {
				t.Fatalf("authenticated=%v entry[%d] = %q, want %q", tc.authenticated, i, visible[i].ID, want)
			}
		}
	}
}
