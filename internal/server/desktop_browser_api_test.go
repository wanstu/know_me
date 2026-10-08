package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

func TestDesktopBrowserUsesNativeCoreAfterWailsNavigation(t *testing.T) {
	opened := ""
	root := t.TempDir()
	opts := ServerOptions{DesktopBrowserOpen: func(target string) error { opened = target; return nil }}
	s, err := NewWithOptions(runtimeconfig.Config{
		Listen:     "127.0.0.1:0",
		DataDir:    filepath.Join(root, "data"),
		UploadsDir: filepath.Join(root, "uploads"),
	}, BuildInfo{Version: "test"}, opts)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	origin := "http://127.0.0.1:34567"
	call := func(path, method, data, headerOrigin, contentType string) int {
		req := httptest.NewRequest(method, origin+path, bytes.NewBufferString(data))
		if headerOrigin != "" {
			req.Header.Set("Origin", headerOrigin)
		}
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		req.RemoteAddr = "127.0.0.1:55555"
		rec := httptest.NewRecorder()
		s.http.Handler.ServeHTTP(rec, req)
		return rec.Code
	}
	siteReq := httptest.NewRequest("GET", origin+"/api/site", nil)
	siteRec := httptest.NewRecorder()
	s.http.Handler.ServeHTTP(siteRec, siteReq)
	var site struct {
		DesktopBrowser bool `json:"desktopBrowser"`
	}
	if err := json.Unmarshal(siteRec.Body.Bytes(), &site); err != nil || !site.DesktopBrowser {
		t.Fatalf("desktop capability missing: %s %v", siteRec.Body.String(), err)
	}
	const valid = `{"url":"https://github.com/wanstu/know_me/releases"}`
	if code := call("/api/desktop/open-external", "POST", valid, origin, "application/json"); code != http.StatusOK {
		t.Fatalf("valid open %d", code)
	}
	if opened != "https://github.com/wanstu/know_me/releases" {
		t.Fatalf("opened %q", opened)
	}
	for _, test := range []struct{ name, raw, reqOrigin, mime string }{
		{"untrusted origin", valid, "http://malicious.example", "application/json"},
		{"missing origin", valid, "", "application/json"},
		{"form submission", valid, origin, "application/x-www-form-urlencoded"},
		{"file scheme", `{"url":"file:///C:/secret"}`, origin, "application/json"},
		{"javascript scheme", `{"url":"javascript:alert(1)"}`, origin, "application/json"},
		{"credentials in url", `{"url":"https://x:y@example.com"}`, origin, "application/json"},
	} {
		got := call("/api/desktop/open-external", "POST", test.raw, test.reqOrigin, test.mime)
		if got != http.StatusForbidden && got != http.StatusBadRequest {
			t.Errorf("%s unexpectedly allowed: %d", test.name, got)
		}
	}
	if opened != "https://github.com/wanstu/know_me/releases" {
		t.Fatalf("invalid request invoked browser: %s", opened)
	}
}

func TestWebOnlyHasNoDesktopBrowserAPI(t *testing.T) {
	root := t.TempDir()
	s, err := New(runtimeconfig.Config{Listen: "127.0.0.1:0", DataDir: filepath.Join(root, "data"), UploadsDir: filepath.Join(root, "uploads")}, BuildInfo{})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	req := httptest.NewRequest("POST", "http://127.0.0.1:3000/api/desktop/open-external", bytes.NewBufferString(`{"url":"https://example.com"}`))
	req.Header.Set("Origin", "http://127.0.0.1:3000")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.http.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("web-only status=%d want 404", rec.Code)
	}
}
