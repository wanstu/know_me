package settings

import (
	"context"
	"encoding/json"
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
	rememberLastTab := true
	wheelSwitchTabs := true
	value, err = store.UpdateSite(ctx, SitePatch{
		ProfileName:      &name,
		ThemeMode:        &mode,
		ThemePreset:      &preset,
		StartCardOpacity: &opacity,
		StartPublic:      &public,
		StartRememberTab: &rememberLastTab,
		StartWheelTabs:   &wheelSwitchTabs,
	})
	if err != nil {
		t.Fatal(err)
	}
	if value.ProfileName != name || value.ThemeMode != ThemeLight || value.ThemePreset != ThemePreset("midnight") {
		t.Fatalf("patch not applied: %#v", value)
	}
	if value.StartCardOpacity != 95 || !value.StartPublic || !value.StartRememberTab || !value.StartWheelTabs {
		t.Fatalf("normalization failed: %#v", value)
	}

	again, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if again.ProfileName != name || again.ThemePreset != ThemePreset("midnight") || !again.StartRememberTab || !again.StartWheelTabs {
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
	if len(value.SocialLinks) != 3 || value.SocialLinks[0].ID != "github" || value.SocialLinks[1].ID != "home-blog" || value.SocialLinks[2].ID != "home-rss" {
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

func TestSearchEngineConfigurationPersistenceAndLegacy(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "search-engines.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db.SQL)
	ctx := context.Background()

	// Existing site JSON contains only the old default ID.
	if _, err := db.SQL.ExecContext(ctx,
		"INSERT INTO settings(key,value_json,updated_at) VALUES('site', ?, 1)",
		`{"defaultSearchEngine":"Google"}`); err != nil {
		t.Fatal(err)
	}
	legacy, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if legacy.DefaultSearchEngine != "Google" || len(legacy.SearchEngines) != 5 {
		t.Fatalf("legacy search settings changed: %+v", legacy)
	}

	list := []SearchEngine{
		{ID: "custom", Name: "内部搜索", URL: "https://example.com/find?term={query}", IconURL: "https://example.com/favicon.ico"},
		{ID: "Google", Name: "Google", URL: "https://www.google.com/search?q={query}"},
	}
	def := SearchEngineName("custom")
	updated, err := store.UpdateSite(ctx, SitePatch{SearchEngines: &list, DefaultSearchEngine: &def})
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.SearchEngines) != 2 || updated.DefaultSearchEngine != "custom" {
		t.Fatalf("custom engines not persisted: %+v", updated)
	}
	reloaded, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.SearchEngines) != 2 || reloaded.SearchEngines[0].ID != "custom" {
		t.Fatalf("custom engine was not reloaded: %+v", reloaded)
	}

	// Removing the current default must never leave a dangling engine selection.
	shortened := []SearchEngine{list[1]}
	updated, err = store.UpdateSite(ctx, SitePatch{SearchEngines: &shortened})
	if err != nil {
		t.Fatal(err)
	}
	if updated.DefaultSearchEngine != "Google" {
		t.Fatalf("missing fallback default: %+v", updated)
	}

	invalid := []SearchEngine{
		{ID: "bad", Name: "invalid", URL: "javascript:alert({query})"},
		{ID: "bad2", Name: "invalid", URL: "http://not-secure.test/?q={query}"},
		{ID: "valid", Name: "valid", URL: "https://example.com/?q={query}", IconURL: "javascript:alert(1)"},
		{ID: "valid", Name: "duplicate", URL: "https://example.com/?q={query}"},
		{ID: "missing", Name: "no placeholder", URL: "https://example.com/"},
	}
	updated, err = store.UpdateSite(ctx, SitePatch{SearchEngines: &invalid})
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.SearchEngines) != 1 || updated.SearchEngines[0].ID != "valid" || updated.SearchEngines[0].IconURL != "" {
		t.Fatalf("invalid URLs were not filtered: %+v", updated.SearchEngines)
	}
	if updated.DefaultSearchEngine != "valid" {
		t.Fatalf("invalid default after filter: %+v", updated)
	}
}

func TestQuoteLibraryLegacyAndDailySettingsPersistence(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "quotes.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db.SQL)
	ctx := context.Background()

	// Older versions persisted one quote and one author, without the collection.
	_, err = db.SQL.ExecContext(ctx,
		"INSERT INTO settings(key,value_json,updated_at) VALUES('site', ?, 1)",
		`{"quote":"自己写的短句","quoteAuthor":"自定义署名","quoteEnabled":true}`)
	if err != nil {
		t.Fatal(err)
	}
	old, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(old.Quotes) != len(builtInQuoteTexts)+1 || old.Quotes[0].Text != "自己写的短句" || old.Quotes[0].Author != "自定义署名" {
		t.Fatalf("legacy quote not preserved: %+v", old.Quotes)
	}
	if !old.Quotes[1].Enabled {
		t.Fatalf("builtin quotes not active: %+v", old.Quotes[1])
	}

	entries := []QuoteEntry{
		{ID: "first", Text: " 每天更好一点 ", Author: "作者", Enabled: true},
		{ID: "second", Text: "第二条", Enabled: false},
	}
	value, err := store.UpdateSite(ctx, SitePatch{Quotes: &entries})
	if err != nil {
		t.Fatal(err)
	}
	if len(value.Quotes) != 2 || value.Quotes[0].Text != "每天更好一点" || value.Quotes[1].Enabled {
		t.Fatalf("stored quotes are incorrect: %+v", value.Quotes)
	}
	reloaded, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.Quotes) != 2 || reloaded.Quotes[0].Author != "作者" || reloaded.Quotes[1].Enabled {
		t.Fatalf("quotes didn't reload correctly: %+v", reloaded.Quotes)
	}
	empty := []QuoteEntry{}
	reloaded, err = store.UpdateSite(ctx, SitePatch{Quotes: &empty})
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.Quotes) != 0 {
		t.Fatalf("explicitly deleted quote library restored unexpectedly: %+v", reloaded.Quotes)
	}
	again, err := store.GetSite(ctx)
	if err != nil || len(again.Quotes) != 0 {
		t.Fatalf("empty quote list wasn't preserved: %+v %v", again.Quotes, err)
	}
}

func TestQuoteLibraryNormalizesDuplicateAndBlankEntries(t *testing.T) {
	values := []QuoteEntry{
		{ID: "x", Text: " A ", Enabled: true},
		{ID: "x", Text: " B ", Enabled: true},
		{ID: "blank", Text: "  ", Enabled: true},
		{ID: "inactive", Text: "C", Enabled: false},
	}
	out := normalizeQuotes(values)
	if len(out) != 3 || out[0].Text != "A" || out[1].Text != "B" || out[0].ID == out[1].ID || out[2].Enabled {
		t.Fatalf("invalid normalized quote entries: %+v", out)
	}
}

func TestAdditionalQuoteCatalogUpgradePreservesEditsAndDeletedEntries(t *testing.T) {
	t.Parallel()
	if len(builtInQuoteTexts) <= previousBuiltinQuoteCount+40 {
		t.Fatalf("expected many additional built-in quotes, got %d", len(builtInQuoteTexts))
	}
	db, err := database.Open(filepath.Join(t.TempDir(), "quote-catalog-upgrade.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db.SQL)
	ctx := context.Background()
	old := []QuoteEntry{
		{ID: "legacy", Text: "我的旧短句", Enabled: true},
		{ID: "built-in-1", Text: "用户改过的句子", Enabled: false},
		{ID: "built-in-3", Text: "原来的第三句", Enabled: true},
	} // built-in-2 was explicitly deleted
	oldJSON, err := json.Marshal(map[string]any{"quotes": old, "quoteEnabled": true})
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.SQL.ExecContext(ctx, "INSERT INTO settings(key,value_json,updated_at) VALUES('site',?,1)", string(oldJSON))
	if err != nil {
		t.Fatal(err)
	}
	upgraded, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(upgraded.Quotes) != len(old)+(len(builtInQuoteTexts)-previousBuiltinQuoteCount) {
		t.Fatalf("added quote count incorrect, got %d", len(upgraded.Quotes))
	}
	if upgraded.Quotes[0].Text != "我的旧短句" || upgraded.Quotes[1].Text != "用户改过的句子" || upgraded.Quotes[1].Enabled {
		t.Fatalf("existing quote changed: %+v", upgraded.Quotes[:3])
	}
	for _, q := range upgraded.Quotes {
		if q.ID == "built-in-2" {
			t.Fatalf("explicitly deleted old quote was restored")
		}
	}
	_, err = store.SetSite(ctx, upgraded)
	if err != nil {
		t.Fatal(err)
	}
	again, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(again.Quotes) != len(upgraded.Quotes) || again.QuoteCatalogVersion != quoteCatalogVersion {
		t.Fatalf("repeated migration duplicated quotes: got %d vs %d", len(again.Quotes), len(upgraded.Quotes))
	}

	disabled := []QuoteEntry{{ID: "built-in-1", Text: "不要启用", Enabled: false}}
	body, err := json.Marshal(map[string]any{"quotes": disabled})
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.SQL.ExecContext(ctx, "UPDATE settings SET value_json=? WHERE key='site'", string(body))
	if err != nil {
		t.Fatal(err)
	}
	got, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Quotes) != 1 || got.Quotes[0].Enabled {
		t.Fatalf("disabled collection re-enabled unexpectedly: %+v", got.Quotes)
	}
}

func TestDisabledAndExternalHomeEntriesPersist(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "home-entries.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db.SQL)
	ctx := context.Background()
	entries := []HomeEntry{
		{ID: "off", Name: "暂时隐藏", URL: "/blog", Visibility: HomeEntryDisabled},
		{ID: "outside", Name: "外部网站", URL: "https://example.com/abc?x=1", NewTab: true, Visibility: HomeEntryAll},
		{ID: "anchor", Name: "文章归档", URL: "/blog#archive", Visibility: HomeEntryAll},
	}
	got, err := store.UpdateSite(ctx, SitePatch{HomeEntries: &entries})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.HomeEntries) != 3 || got.HomeEntries[0].Visibility != HomeEntryDisabled {
		t.Fatalf("disabled item lost during normalization: %+v", got.HomeEntries)
	}
	reload, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if reload.HomeEntries[1].URL != "https://example.com/abc?x=1" || !reload.HomeEntries[1].NewTab ||
		reload.HomeEntries[2].URL != "/blog#archive" {
		t.Fatalf("entry links changed during save: %+v", reload.HomeEntries)
	}
}

func TestHomepageTagsMigrationAndCustomVisibility(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "tags.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db.SQL)
	ctx := context.Background()

	initial, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(initial.SocialLinks) != 2 || initial.SocialLinks[0].URL != "/blog" || initial.SocialLinks[1].URL != "/feed.xml" {
		t.Fatalf("initial Blog/RSS tags missing: %+v", initial.SocialLinks)
	}

	// Simulate v0.1.14 site configuration which had custom socialLinks but
	// rendered two additional hardcoded Blog/RSS chips.
	_, err = db.SQL.ExecContext(ctx, "INSERT INTO settings(key,value_json,updated_at) VALUES('site',?,1)",
		`{"socialLinks":[{"id":"github","label":"GitHub","url":"https://github.com/example"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	migrated, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(migrated.SocialLinks) != 3 || migrated.SocialLinks[0].Label != "GitHub" ||
		migrated.SocialLinks[1].Label != "Blog" || migrated.SocialLinks[2].Label != "RSS" ||
		migrated.HomeTagsVersion != homeTagsVersion {
		t.Fatalf("legacy links not migrated: %+v", migrated)
	}

	// No duplicate Blog if an admin had already added a matching link.
	_, err = db.SQL.ExecContext(ctx, "UPDATE settings SET value_json=? WHERE key='site'",
		`{"socialLinks":[{"id":"blog-manual","label":"Blog","url":"/blog"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	migrated, err = store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(migrated.SocialLinks) != 2 || migrated.SocialLinks[1].Label != "RSS" {
		t.Fatalf("manual Blog tag was duplicated: %+v", migrated.SocialLinks)
	}

	// Save disabled RSS and removed Blog. Neither should be silently restored.
	list := []SocialLink{{ID: "my-rss", Label: "RSS", URL: "/feed.xml", Disabled: true}}
	value, err := store.UpdateSite(ctx, SitePatch{SocialLinks: &list})
	if err != nil {
		t.Fatal(err)
	}
	if len(value.SocialLinks) != 1 || !value.SocialLinks[0].Disabled {
		t.Fatalf("not saved: %+v", value)
	}
	again, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(again.SocialLinks) != 1 || again.SocialLinks[0].ID != "my-rss" || !again.SocialLinks[0].Disabled {
		t.Fatalf("Blog/RSS were restored after admin edit: %+v", again.SocialLinks)
	}
	empty := []SocialLink{}
	_, err = store.UpdateSite(ctx, SitePatch{SocialLinks: &empty})
	if err != nil {
		t.Fatal(err)
	}
	again, err = store.GetSite(ctx)
	if err != nil || len(again.SocialLinks) != 0 {
		t.Fatalf("explicitly empty tags were recreated: %+v %v", again.SocialLinks, err)
	}
}
