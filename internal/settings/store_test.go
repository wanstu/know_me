package settings

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/wanstu/know_me/internal/database"
)

func TestDefaultsAndPatchPersistence(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db.SQL)
	ctx := context.Background()
	value, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if value.ThemePreset != PresetAurora || value.ProfileName != "know_me" || len(value.HomeEntries) == 0 {
		t.Fatalf("unexpected defaults: %#v", value)
	}

	name := "Native Know Me"
	mode := ThemeLight
	preset := ThemePreset("midnight")
	opacity := 101
	public := true
	value, err = store.UpdateSite(ctx, SitePatch{
		ProfileName:      &name,
		ThemeMode:        &mode,
		ThemePreset:      &preset,
		StartCardOpacity: &opacity,
		StartPublic:      &public,
	})
	if err != nil {
		t.Fatal(err)
	}
	if value.ProfileName != name || value.ThemeMode != ThemeLight || value.ThemePreset != ThemePreset("midnight") {
		t.Fatalf("patch not applied: %#v", value)
	}
	if value.StartCardOpacity != 95 || !value.StartPublic {
		t.Fatalf("normalization failed: %#v", value)
	}

	again, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if again.ProfileName != name || again.ThemePreset != ThemePreset("midnight") {
		t.Fatalf("settings not persisted: %#v", again)
	}
}

func TestLegacySocialLinksAreDerived(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "legacy.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.SQL.Exec("INSERT INTO settings(key,value_json,updated_at) VALUES('site', ?, 1)", `{"githubUrl":"https://github.com/example"}`)
	if err != nil {
		t.Fatal(err)
	}

	value, err := NewStore(db.SQL).GetSite(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(value.SocialLinks) != 1 || value.SocialLinks[0].ID != "github" {
		t.Fatalf("legacy socials = %#v", value.SocialLinks)
	}
}

func TestThemeGradientPersistenceAndLegacyCompatibility(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "gradient-settings.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db.SQL)
	ctx := context.Background()
	// Old persisted JSON has no themeStyle or themeGradientPacks.
	if _, err := db.SQL.ExecContext(ctx,
		"INSERT INTO settings(key,value_json,updated_at) VALUES('site',?,1)",
		`{"themePreset":"midnight","themeMode":"dark"}`); err != nil {
		t.Fatal(err)
	}
	legacy, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if legacy.ThemeStyle != StyleSolid || legacy.ThemePreset != "midnight" || len(legacy.ThemeGradientPacks) != 2 {
		t.Fatalf("legacy theme settings changed: %+v", legacy)
	}
	mode := StyleGradient
	packs := []string{"aurora", "ocean", "forest"}
	updated, err := store.UpdateSite(ctx, SitePatch{ThemeStyle: &mode, ThemeGradientPacks: &packs})
	if err != nil {
		t.Fatal(err)
	}
	if updated.ThemeStyle != StyleGradient || len(updated.ThemeGradientPacks) != 3 {
		t.Fatalf("update: %+v", updated)
	}
	reloaded, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.ThemeStyle != StyleGradient || len(reloaded.ThemeGradientPacks) != 3 ||
		reloaded.ThemeGradientPacks[1] != "ocean" || reloaded.ThemePreset != "midnight" {
		t.Fatalf("gradient not persisted or changed solid pack: %+v", reloaded)
	}
	for _, invalid := range [][]string{
		{"aurora"}, {"aurora", "aurora"}, {"aurora", "ocean", "forest", "sunset", "sakura"},
		{"bad name", "ocean"},
	} {
		changed, err := store.UpdateSite(ctx, SitePatch{ThemeGradientPacks: &invalid})
		if err != nil {
			t.Fatal(err)
		}
		if changed.ThemeStyle != StyleSolid || len(changed.ThemeGradientPacks) != 0 {
			t.Fatalf("invalid packs must safely reset to solid: %+v", changed)
		}
		_, _ = store.UpdateSite(ctx, SitePatch{ThemeStyle: &mode, ThemeGradientPacks: &packs})
	}
	solid := StyleSolid
	changed, err := store.UpdateSite(ctx, SitePatch{ThemeStyle: &solid})
	if err != nil {
		t.Fatal(err)
	}
	if changed.ThemeStyle != StyleSolid || len(changed.ThemeGradientPacks) != 3 {
		t.Fatalf("solid should preserve editable gradient selection: %+v", changed)
	}
}
