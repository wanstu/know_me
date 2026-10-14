package settings

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/wanstu/know_me/internal/database"
)

// A hidden homepage link was never an authorization rule. Upgrading a
// published site must not unexpectedly disable Blog, RSS, or Start.
func TestLegacyHiddenLinksDoNotDisableRouteAccess(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "legacy-routes.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	legacy := `{
    "startPublic":true,
    "socialLinks":[
      {"id":"blog","label":"Blog","url":"/blog","disabled":true},
      {"id":"rss","label":"RSS","url":"/feed.xml","disabled":true}
    ],
    "homeTagsVersion":1,
    "homeEntries":[
      {"id":"start","name":"Start","url":"/start","visibility":"authenticated"},
      {"id":"blog","name":"Blog","url":"/blog","visibility":"disabled"},
      {"id":"rss","name":"RSS","url":"/feed.xml","visibility":"guest"}
    ]
  }`
	_, err = db.SQL.ExecContext(ctx, "INSERT INTO settings(key,value_json,updated_at) VALUES('site',?,1)", legacy)
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(db.SQL)
	site, err := store.GetSite(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{RouteStart, RouteBlog, RouteRSS} {
		if got := site.RouteAccess[path]; got != HomeEntryAll {
			t.Errorf("legacy %s route = %s; must stay public", path, got)
		}
	}
	if !site.SocialLinks[0].Disabled || !site.SocialLinks[1].Disabled {
		t.Fatalf("hidden tags changed: %#v", site.SocialLinks)
	}
	if site.HomeEntries[1].Visibility != HomeEntryDisabled || site.HomeEntries[0].Visibility != HomeEntryAuthenticated {
		t.Fatalf("existing entry conditions changed: %#v", site.HomeEntries)
	}
	// Saving only the new Start route policy must never reset existing entry visibility.
	next := site.RouteAccess
	next[RouteStart] = HomeEntryAuthenticated
	changed, err := store.UpdateSite(ctx, SitePatch{RouteAccess: &next})
	if err != nil {
		t.Fatal(err)
	}
	if changed.RouteAccess[RouteBlog] != HomeEntryAll || changed.RouteAccess[RouteRSS] != HomeEntryAll {
		t.Fatalf("unrelated routes changed: %#v", changed.RouteAccess)
	}
	if !changed.SocialLinks[0].Disabled || changed.HomeEntries[1].Visibility != HomeEntryDisabled {
		t.Fatal("saving route authorization unexpectedly changed homepage visibility")
	}
}

func TestLinkVisibilityNeverOverridesRouteAccess(t *testing.T) {
	t.Parallel()
	site := Defaults()
	site.RouteAccess = DefaultRouteAccess(false)
	blog := HomeEntryAll
	if !AllowedLink(site, "/blog", blog, false) {
		t.Fatal("public Blog link was hidden")
	}
	if AllowedLink(site, "/start", HomeEntryAll, false) {
		t.Fatal("public-looking Start link bypasses route auth")
	}
	if AllowedLink(site, "/blog", HomeEntryDisabled, true) {
		t.Fatal("disabled Blog entry was shown")
	}
	site.RouteAccess[RouteBlog] = HomeEntryAuthenticated
	if AllowedLink(site, "/blog#archive", HomeEntryAll, false) {
		t.Fatal("anchor bypassed Blog auth")
	}
	if AllowedLink(site, "/blog/example?preview=1", HomeEntryAll, false) {
		t.Fatal("post path bypassed Blog auth")
	}
	if !AllowedLink(site, "/blog", HomeEntryAll, true) {
		t.Fatal("authorized user denied Blog link")
	}
}
