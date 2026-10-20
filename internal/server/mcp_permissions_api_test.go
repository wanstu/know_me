package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

func TestMCPGranularTokenAdminAPI(t *testing.T) {
	s, err := New(runtimeconfig.Config{
		Listen: "127.0.0.1:0",
		DataDir: filepath.Join(t.TempDir(), "data"),
		UploadsDir: filepath.Join(t.TempDir(), "uploads"),
	}, BuildInfo{Version: "test"})
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
	request := func(method, path, body string) *http.Response {
		t.Helper()
		req, err := http.NewRequest(method, ts.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", ts.URL)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}

	login := request(http.MethodPost, "/api/auth/login", `{"username":"admin","password":"secure-password-12345"}`)
	login.Body.Close()
	if login.StatusCode != http.StatusOK {
		t.Fatalf("login=%d", login.StatusCode)
	}

	created := request(http.MethodPost, "/api/mcp/tokens", `{"name":"Start editor","permissions":["start.write"]}`)
	if created.StatusCode != http.StatusCreated {
		t.Fatalf("create=%d", created.StatusCode)
	}
	var createdData struct {
		Secret string `json:"secret"`
		Token struct {
			ID             string   `json:"id"`
			Scope          string   `json:"scope"`
			PermissionMode string   `json:"permissionMode"`
			Permissions    []string `json:"permissions"`
		} `json:"token"`
	}
	if err := json.NewDecoder(created.Body).Decode(&createdData); err != nil {
		t.Fatal(err)
	}
	created.Body.Close()
	if createdData.Token.PermissionMode != "custom" || createdData.Token.Scope != "write" {
		t.Fatalf("created token=%+v", createdData.Token)
	}
	if !reflect.DeepEqual(createdData.Token.Permissions, []string{"start.read", "start.write"}) {
		t.Fatalf("normalized permissions=%v", createdData.Token.Permissions)
	}

	patched := request(http.MethodPatch, "/api/mcp/tokens/"+createdData.Token.ID, `{"permissions":["posts.read"]}`)
	if patched.StatusCode != http.StatusOK {
		t.Fatalf("patch=%d", patched.StatusCode)
	}
	patched.Body.Close()
	resolved, err := s.mcpTokens.Resolve(context.Background(), createdData.Secret)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.PermissionMode != "custom" || resolved.Scope != "read" || !reflect.DeepEqual(resolved.Permissions, []string{"posts.read"}) {
		t.Fatalf("patched token not effective: %+v", resolved)
	}

	empty := request(http.MethodPatch, "/api/mcp/tokens/"+createdData.Token.ID, `{"permissions":[]}`)
	empty.Body.Close()
	if empty.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty permissions status=%d", empty.StatusCode)
	}

	legacy := request(http.MethodPost, "/api/mcp/tokens", `{"name":"Legacy client","scope":"read"}`)
	if legacy.StatusCode != http.StatusCreated {
		t.Fatalf("legacy create=%d", legacy.StatusCode)
	}
	var legacyData struct {
		Token struct {
			PermissionMode string `json:"permissionMode"`
		} `json:"token"`
	}
	if err := json.NewDecoder(legacy.Body).Decode(&legacyData); err != nil {
		t.Fatal(err)
	}
	legacy.Body.Close()
	if legacyData.Token.PermissionMode != "legacy" {
		t.Fatalf("legacy mode=%q", legacyData.Token.PermissionMode)
	}

	listed, err := client.Get(ts.URL + "/api/mcp/tokens")
	if err != nil {
		t.Fatal(err)
	}
	defer listed.Body.Close()
	var listData struct {
		Permissions []string `json:"permissions"`
	}
	if err := json.NewDecoder(listed.Body).Decode(&listData); err != nil {
		t.Fatal(err)
	}
	if listed.StatusCode != http.StatusOK || len(listData.Permissions) < 10 {
		t.Fatalf("permission catalog missing: status=%d permissions=%v", listed.StatusCode, listData.Permissions)
	}
}
