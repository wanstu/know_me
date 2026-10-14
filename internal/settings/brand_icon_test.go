package settings

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/wanstu/know_me/internal/database"
)

func TestBrandIconConfiguredSeparatelyFromAvatar(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "brand-icon.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db.SQL)
	ctx := context.Background()
	previous, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if previous.BrandIconURL != "" {
		t.Fatalf("default brand icon should use K: %q", previous.BrandIconURL)
	}
	icon := "/media/site-logo.png"
	avatar := "/media/user-avatar.png"
	result, err := store.UpdateSite(ctx, SitePatch{BrandIconURL: &icon, AvatarURL: &avatar})
	if err != nil {
		t.Fatal(err)
	}
	if result.BrandIconURL != icon || result.AvatarURL != avatar {
		t.Fatalf("brand / avatar patch: %+v", result)
	}
	again, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if again.BrandIconURL != icon || again.AvatarURL != avatar {
		t.Fatalf("brand / avatar not persisted: %+v", again)
	}
	icon = ""
	result, err = store.UpdateSite(ctx, SitePatch{BrandIconURL: &icon})
	if err != nil {
		t.Fatal(err)
	}
	if result.BrandIconURL != "" || result.AvatarURL != avatar {
		t.Fatalf("brand reset changed avatar: %+v", result)
	}
}
