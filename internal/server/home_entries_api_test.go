package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/wanstu/know_me/internal/auth"
	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
	"github.com/wanstu/know_me/internal/settings"
)

func TestSiteEntriesOnlyExposeLoginLinksToAuthenticatedVisitors(t *testing.T) {
	t.Parallel()
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

	entries := []settings.HomeEntry{
		{ID: "public", Name: "公开", URL: "/blog", Visibility: settings.HomeEntryAll},
		{ID: "private", Name: "仅登录", URL: "/admin", Visibility: settings.HomeEntryAuthenticated},
		{ID: "guest", Name: "未登录", URL: "/login", Visibility: settings.HomeEntryGuest},
	}
	if _, err := s.settings.UpdateSite(context.Background(), settings.SitePatch{HomeEntries: &entries}); err != nil {
		t.Fatal(err)
	}
	var readSite = func(cookie *http.Cookie) []settings.HomeEntry {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "http://example.test/api/site", nil)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		s.http.Handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /api/site returned HTTP %d: %s", rec.Code, rec.Body.String())
		}
		var payload struct {
			Settings settings.SiteSettings `json:"settings"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return payload.Settings.HomeEntries
	}
	anonymous := readSite(nil)
	if len(anonymous) != 2 || anonymous[0].ID != "public" || anonymous[1].ID != "guest" {
		t.Fatalf("anonymous API leaked login-only links: %#v", anonymous)
	}

	userID, created, err := s.auth.CreateInitialAdmin(context.Background(), "admin", "supersecret-test-password", "admin")
	if err != nil || !created {
		t.Fatalf("create user: created=%v err=%v", created, err)
	}
	session, err := s.auth.CreateSession(context.Background(), userID, "test-agent")
	if err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: auth.SessionCookie, Value: session.Token}
	// An authenticated administrator must see every entry for editing, including
	// guest-only entries. Public homepage rendering filters it for logged-in users.
	authenticated := readSite(cookie)
	if len(authenticated) != 3 || authenticated[1].ID != "private" || authenticated[2].ID != "guest" {
		t.Fatalf("authenticated API incomplete: %#v", authenticated)
	}
}
