package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wanstu/know_me/internal/mcpaccess"
	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

func TestMCPAuditAuthToolAndAdminQuery(t *testing.T) {
	s, err := New(runtimeconfig.Config{
		Listen: "127.0.0.1:0", DataDir: filepath.Join(t.TempDir(), "data"), UploadsDir: filepath.Join(t.TempDir(), "uploads"),
	}, BuildInfo{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	server := httptest.NewServer(s.http.Handler)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	get := func(auth, origin string) int {
		req, err := http.NewRequest(http.MethodGet, server.URL+"/mcp", nil)
		if err != nil {
			t.Fatal(err)
		}
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		return resp.StatusCode
	}
	if code := get("", ""); code != 401 {
		t.Fatalf("missing bearer HTTP=%d", code)
	}
	if code := get("Basic example", ""); code != 401 {
		t.Fatalf("bad scheme HTTP=%d", code)
	}
	if code := get("Bearer km_"+strings.Repeat("0", 64), ""); code != 401 {
		t.Fatalf("invalid token HTTP=%d", code)
	}
	if code := get("", "https://evil.invalid"); code != 403 {
		t.Fatalf("origin HTTP=%d", code)
	}
	token, secret, err := s.mcpTokens.Create(ctx, "audit integration", "write")
	if err != nil {
		t.Fatal(err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "audit-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint: server.URL + "/mcp", DisableStandaloneSSE: true,
		HTTPClient: &http.Client{Transport: bearerTransport{secret}},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	_, err = session.CallTool(ctx, &mcp.CallToolParams{Name: "posts_create", Arguments: map[string]any{
		"title": "Article never in audit", "contentMd": "Secret body never in audit", "status": "draft",
	}})
	if err != nil {
		t.Fatal(err)
	}
	posts, err := s.blog.ListAdmin(ctx)
	if err != nil || len(posts) != 1 {
		t.Fatal("post not created")
	}
	_, _ = session.CallTool(ctx, &mcp.CallToolParams{Name: "posts_get", Arguments: map[string]any{"id": int64(99999999)}})
	evts, err := s.mcpAudit.List(ctx, mcpaccess.AuditFilter{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	reasons := map[string]bool{}
	seenTool, seenFailure, seenAccepted := false, false, false
	for _, event := range evts {
		reasons[event.Reason] = true
		if event.TokenID == token.ID && event.Result == "success" && event.EventType == "authentication" {
			seenAccepted = true
		}
		if event.ToolName == "posts_create" && event.Result == "success" && event.TargetID != "" {
			seenTool = true
			if event.RequiredPermission != "posts.write" {
				t.Fatalf("future permission category wrong: %+v", event)
			}
		}
		if event.ToolName == "posts_get" && event.Result == "error" {
			seenFailure = true
		}
		raw, _ := json.Marshal(event)
		if strings.Contains(string(raw), secret) || strings.Contains(string(raw), "Secret body") || strings.Contains(string(raw), "Article never") {
			t.Fatalf("audit leaked data: %s", raw)
		}
	}
	for _, reason := range []string{"authorization_missing", "authorization_invalid_scheme", "token_invalid_or_revoked", "origin_mismatch"} {
		if !reasons[reason] {
			t.Fatalf("missing reason %s in %+v", reason, evts)
		}
	}
	if !seenAccepted || !seenTool || !seenFailure {
		t.Fatalf("audit result missing: auth=%v tool=%v fail=%v %+v", seenAccepted, seenTool, seenFailure, evts)
	}

	public, err := http.Get(server.URL + "/api/mcp/audit")
	if err != nil {
		t.Fatal(err)
	}
	public.Body.Close()
	if public.StatusCode != 401 {
		t.Fatalf("audit endpoint not protected: %d", public.StatusCode)
	}

	if _, err := s.auth.UpsertAdmin(ctx, "admin", "secure-password-12345", "Admin"); err != nil {
		t.Fatal(err)
	}
	jar, _ := cookiejar.New(nil)
	authenticated := &http.Client{Jar: jar}
	req, _ := http.NewRequest("POST", server.URL+"/api/auth/login", strings.NewReader(`{"username":"admin","password":"secure-password-12345"}`))
	req.Header.Set("Content-Type", "application/json")
	login, err := authenticated.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	login.Body.Close()
	if login.StatusCode != 200 {
		t.Fatalf("admin login HTTP %d", login.StatusCode)
	}
	res, err := authenticated.Get(server.URL + "/api/mcp/audit?limit=5&tokenId=" + token.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("admin audit API status=%d", res.StatusCode)
	}
	var list struct {
		Events []struct {
			TokenID string `json:"tokenId"`
		} `json:"events"`
	}
	if err := json.NewDecoder(res.Body).Decode(&list); err != nil {
		t.Fatal(err)
	}
	if len(list.Events) == 0 || len(list.Events) > 5 {
		t.Fatalf("filtered audit list: %+v", list)
	}
	for _, v := range list.Events {
		if v.TokenID != token.ID {
			t.Fatal("token filter ignored")
		}
	}
}

func TestMCPAuditStorageFailureDoesNotBlockMCP(t *testing.T) {
	s, err := New(runtimeconfig.Config{
		Listen: "127.0.0.1:0", DataDir: filepath.Join(t.TempDir(), "data"), UploadsDir: filepath.Join(t.TempDir(), "uploads"),
	}, BuildInfo{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, secret, err := s.mcpTokens.Create(ctx, "Audit failure test", "read")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.database.SQL.ExecContext(ctx, "DROP TABLE mcp_audit_events"); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(s.http.Handler)
	defer server.Close()
	client := mcp.NewClient(&mcp.Implementation{Name: "audit-failure-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint: server.URL + "/mcp", DisableStandaloneSSE: true,
		HTTPClient: &http.Client{Transport: bearerTransport{secret}},
	}, nil)
	if err != nil {
		t.Fatalf("audit DB failure broke authentication: %v", err)
	}
	defer session.Close()
	if _, err := session.ListTools(ctx, nil); err != nil {
		t.Fatalf("audit DB failure broke tool listing: %v", err)
	}
}
