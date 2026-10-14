package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/wanstu/know_me/internal/auth"
	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
	"github.com/wanstu/know_me/internal/settings"
)

func TestUnifiedRouteAccessBlocksDirectRequests(t *testing.T) {
	root := t.TempDir()
	s, err := New(runtimeconfig.Config{
		Listen:     "127.0.0.1:0",
		DataDir:    filepath.Join(root, "data"),
		UploadsDir: filepath.Join(root, "uploads"),
	}, BuildInfo{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	userID, created, err := s.auth.CreateInitialAdmin(context.Background(), "admin", "testing-password-long-enough", "admin")
	if err != nil || !created {
		t.Fatalf("admin: %v created=%v", err, created)
	}
	session, err := s.auth.CreateSession(context.Background(), userID, "test")
	if err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: auth.SessionCookie, Value: session.Token}

	request := func(path string, login bool) int {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "http://example.test"+path, nil)
		if login {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		s.http.Handler.ServeHTTP(rec, req)
		return rec.Code
	}
	update := func(route string, mode settings.HomeEntryVisibility) {
		t.Helper()
		current, err := s.settings.GetSite(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		next := current.RouteAccess
		next[route] = mode
		_, err = s.settings.UpdateSite(context.Background(), settings.SitePatch{RouteAccess: &next})
		if err != nil {
			t.Fatal(err)
		}
	}

	// Legacy default: Start is private, Blog and RSS are public.
	if got := request("/start", false); got != http.StatusSeeOther {
		t.Fatalf("Start default page = %d", got)
	}
	if got := request("/api/navigation/public", false); got != http.StatusUnauthorized {
		t.Fatalf("Start public API leaked = %d", got)
	}
	if got := request("/blog", false); got != http.StatusOK {
		t.Fatalf("Blog default = %d", got)
	}
	if got := request("/feed.xml", false); got != http.StatusOK {
		t.Fatalf("RSS default = %d", got)
	}

	targets := []struct {
		route string
		page  string
		api   string
	}{
		{settings.RouteStart, "/start?x=1", "/api/navigation/public"},
		{settings.RouteBlog, "/blog/a-article", "/api/blog/posts"},
	}
	for _, target := range targets {
		for _, mode := range []struct {
			name                                         string
			value                                        settings.HomeEntryVisibility
			publicPage, publicAPI, signedPage, signedAPI int
		}{
			{"all", settings.HomeEntryAll, 200, 200, 200, 200},
			{"authenticated", settings.HomeEntryAuthenticated, 303, 401, 200, 200},
			{"guest", settings.HomeEntryGuest, 200, 200, 403, 403},
			{"disabled", settings.HomeEntryDisabled, 404, 404, 404, 404},
		} {
			t.Run(target.route+"/"+mode.name, func(t *testing.T) {
				update(target.route, mode.value)
				// Allowed SPA browser routes return the HTML shell; the client
				// handles any later "article not found" message.
				for _, check := range []struct {
					path  string
					login bool
					want  int
				}{
					{target.page, false, mode.publicPage},
					{target.api, false, mode.publicAPI},
					{target.page, true, mode.signedPage},
					{target.api, true, mode.signedAPI},
				} {
					if got := request(check.path, check.login); got != check.want {
						t.Fatalf("%s logged=%v got %d want %d", check.path, check.login, got, check.want)
					}
				}
			})
		}
		update(target.route, settings.HomeEntryAll)
	}

	update(settings.RouteBlog, settings.HomeEntryAuthenticated)
	update(settings.RouteRSS, settings.HomeEntryAll)
	if got := request("/feed.xml", false); got == http.StatusOK {
		t.Fatalf("RSS bypassed Blog restriction: %d", got)
	}
	if got := request("/feed.xml", true); got != http.StatusOK {
		t.Fatalf("authenticated RSS = %d", got)
	}
	feedReq := httptest.NewRequest(http.MethodGet, "http://example.test/feed.xml", nil)
	feedReq.AddCookie(cookie)
	feedRes := httptest.NewRecorder()
	s.http.Handler.ServeHTTP(feedRes, feedReq)
	if got := feedRes.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("restricted RSS cache header = %q, want private, no-store", got)
	}
	update(settings.RouteStart, settings.HomeEntryAuthenticated)
	if got := request("/start/deep-link", false); got != http.StatusSeeOther {
		t.Fatalf("nested Start route bypassed access: %d", got)
	}
	update(settings.RouteBlog, settings.HomeEntryAll)
	update(settings.RouteRSS, settings.HomeEntryDisabled)
	if got := request("/feed.xml", false); got != http.StatusNotFound {
		t.Fatalf("disabled RSS = %d", got)
	}

	if got := request("/admin", false); got != http.StatusSeeOther {
		t.Fatalf("anonymous admin = %d", got)
	}
	if got := request("/admin", true); got != http.StatusOK {
		t.Fatalf("authorized admin = %d", got)
	}
}
