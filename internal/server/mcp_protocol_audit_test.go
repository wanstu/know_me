package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wanstu/know_me/internal/mcpaccess"
	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

func TestMCPResponseRecorderPreservesHTTP(t *testing.T) {
	target := httptest.NewRecorder()
	recorder := &mcpResponseRecorder{ResponseWriter: target}
	recorder.Header().Set("X-Diagnostic", "untouched")
	recorder.WriteHeader(http.StatusAccepted)
	recorder.Write([]byte("payload"))
	if recorder.Status() != http.StatusAccepted || target.Code != http.StatusAccepted || target.Body.String() != "payload" || target.Header().Get("X-Diagnostic") != "untouched" {
		t.Fatalf("HTTP response not preserved: %+v %+v", recorder, target)
	}
	target2 := httptest.NewRecorder()
	second := &mcpResponseRecorder{ResponseWriter: target2}
	second.Flush()
	if second.Status() != http.StatusOK || !target2.Flushed {
		t.Fatalf("flushing broken: %+v %+v", second, target2)
	}
	if second.Unwrap() != target2 {
		t.Fatal("response writer unwrap incorrect")
	}
}

type reverseProxyBearerTransport struct {
	secret string
	host   string
}

func (t reverseProxyBearerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	clone := r.Clone(r.Context())
	clone.Header = clone.Header.Clone()
	clone.Header.Set("Authorization", "Bearer "+t.secret)
	clone.Host = t.host
	return http.DefaultTransport.RoundTrip(clone)
}

func TestMCPAllowsAuthenticatedReverseProxyHost(t *testing.T) {
	root := t.TempDir()
	srv, err := New(runtimeconfig.Config{Listen: "127.0.0.1:0", DataDir: filepath.Join(root, "data"), UploadsDir: filepath.Join(root, "uploads")}, BuildInfo{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	upstream := httptest.NewServer(srv.http.Handler)
	defer upstream.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_, secret, err := srv.mcpTokens.Create(ctx, "Reverse proxy test", "read")
	if err != nil {
		t.Fatal(err)
	}

	client := mcp.NewClient(&mcp.Implementation{Name: "reverse-proxy-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint: upstream.URL + "/mcp", DisableStandaloneSSE: true,
		HTTPClient: &http.Client{Transport: reverseProxyBearerTransport{secret: secret, host: "index.wanstu.cn"}},
	}, nil)
	if err != nil {
		t.Fatalf("reverse-proxied MCP initialize failed: %v", err)
	}
	defer session.Close()
	tools, err := session.ListTools(ctx, nil)
	if err != nil || len(tools.Tools) == 0 {
		t.Fatalf("reverse-proxied tools/list failed: %v %+v", err, tools)
	}
}

func TestMCPAuditsHTTPStatusAfterAuthentication(t *testing.T) {
	root := t.TempDir()
	srv, err := New(runtimeconfig.Config{Listen: "127.0.0.1:0", DataDir: filepath.Join(root, "data"), UploadsDir: filepath.Join(root, "uploads")}, BuildInfo{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	upstream := httptest.NewServer(srv.http.Handler)
	defer upstream.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	token, secret, err := srv.mcpTokens.Create(ctx, "Response status test", "read")
	if err != nil {
		t.Fatal(err)
	}

	// A valid token must not cause a valid-but-disallowed HTTP method
	// to appear as an authentication error.
	req, err := http.NewRequest(http.MethodPut, upstream.URL+"/mcp", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+secret)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode < 400 {
		t.Fatalf("expected protocol/method rejection, got HTTP %d", res.StatusCode)
	}
	rejected := res.StatusCode

	client := mcp.NewClient(&mcp.Implementation{Name: "audit-protocol-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint: upstream.URL + "/mcp", DisableStandaloneSSE: true,
		HTTPClient: &http.Client{Transport: bearerTransport{secret}},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	tools, err := session.ListTools(ctx, nil)
	if err != nil || len(tools.Tools) == 0 {
		t.Fatalf("valid protocol unexpectedly broken: %v %+v", err, tools)
	}

	events, err := srv.mcpAudit.List(ctx, mcpaccess.AuditFilter{TokenID: token.ID, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	seenSuccess, seenFailure := false, false
	for _, item := range events {
		if item.EventType != "protocol_http" {
			continue
		}
		if item.HTTPMethod == http.MethodPut && item.Result == "error" && item.Reason == "HTTP "+intToString(int64(rejected)) {
			seenFailure = true
		}
		if item.HTTPMethod == http.MethodPost && item.Result == "success" && item.Reason == "HTTP 200" {
			seenSuccess = true
		}
		raw, _ := json.Marshal(item)
		if strings.Contains(string(raw), secret) || strings.Contains(string(raw), "Bearer") {
			t.Fatalf("token leaked in protocol audit: %s", raw)
		}
	}
	if !seenFailure || !seenSuccess {
		t.Fatalf("missing HTTP protocol results (failure=%t success=%t): %+v", seenFailure, seenSuccess, events)
	}
}
