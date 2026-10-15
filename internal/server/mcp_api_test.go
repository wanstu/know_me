package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

func TestMCPTokenAdminAPI(t *testing.T) {
	s, err := New(runtimeconfig.Config{Listen: "127.0.0.1:0", DataDir: filepath.Join(t.TempDir(), "data"), UploadsDir: filepath.Join(t.TempDir(), "uploads")}, BuildInfo{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.auth.UpsertAdmin(context.Background(), "admin", "secure-password-12345", "Admin"); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.http.Handler)
	defer ts.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	unauth, err := client.Get(ts.URL + "/api/mcp/tokens")
	if err != nil {
		t.Fatal(err)
	}
	unauth.Body.Close()
	if unauth.StatusCode != 401 {
		t.Fatalf("anonymous token listing status=%d", unauth.StatusCode)
	}
	request := func(method, url, body, origin string) *http.Response {
		t.Helper()
		req, err := http.NewRequest(method, ts.URL+url, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	login := request("POST", "/api/auth/login", `{"username":"admin","password":"secure-password-12345"}`, ts.URL)
	login.Body.Close()
	if login.StatusCode != 200 {
		t.Fatalf("login=%d", login.StatusCode)
	}
	denied := request("POST", "/api/mcp/tokens", `{"name":"test","scope":"write"}`, "https://evil.invalid")
	denied.Body.Close()
	if denied.StatusCode != 403 {
		t.Fatalf("cross-origin create=%d", denied.StatusCode)
	}
	created := request("POST", "/api/mcp/tokens", `{"name":"assistant","scope":"write"}`, ts.URL)
	if created.StatusCode != 201 {
		t.Fatalf("create=%d", created.StatusCode)
	}
	var data struct {
		Secret string `json:"secret"`
		Token  struct {
			ID    string `json:"id"`
			Scope string `json:"scope"`
		} `json:"token"`
	}
	if err := json.NewDecoder(created.Body).Decode(&data); err != nil {
		t.Fatal(err)
	}
	created.Body.Close()
	if !strings.HasPrefix(data.Secret, "km_") || data.Token.Scope != "write" {
		t.Fatalf("token response incomplete")
	}
	var persistedHash string
	if err := s.database.SQL.QueryRow("SELECT secret_hash FROM mcp_tokens WHERE id=?", data.Token.ID).Scan(&persistedHash); err != nil {
		t.Fatal(err)
	}
	if persistedHash == data.Secret || len(persistedHash) != 64 {
		t.Fatal("raw token stored in database")
	}
	listed, err := client.Get(ts.URL + "/api/mcp/tokens")
	if err != nil {
		t.Fatal(err)
	}
	var raw bytes.Buffer
	raw.ReadFrom(listed.Body)
	listed.Body.Close()
	if listed.StatusCode != 200 || bytes.Contains(raw.Bytes(), []byte(data.Secret)) {
		t.Fatalf("token list leaked secret: %s", raw.String())
	}
	rev := request("DELETE", "/api/mcp/tokens/"+data.Token.ID, "", ts.URL)
	rev.Body.Close()
	if rev.StatusCode != 200 {
		t.Fatalf("revoke=%d", rev.StatusCode)
	}
	if _, err := s.mcpTokens.Resolve(context.Background(), data.Secret); err == nil {
		t.Fatal("revoked token still valid")
	}
}
