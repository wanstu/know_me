package server

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

type bearerTransport struct{ secret string }

func (t bearerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	clone := r.Clone(r.Context())
	clone.Header = clone.Header.Clone()
	clone.Header.Set("Authorization", "Bearer "+t.secret)
	return http.DefaultTransport.RoundTrip(clone)
}

func TestMCPAuthenticationAndBusinessTools(t *testing.T) {
	s, err := New(runtimeconfig.Config{Listen: "127.0.0.1:0", DataDir: filepath.Join(t.TempDir(), "data"), UploadsDir: filepath.Join(t.TempDir(), "uploads")}, BuildInfo{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	server := httptest.NewServer(s.http.Handler)
	defer server.Close()
	post, err := http.Post(server.URL+"/mcp", "application/json", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`))
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, post.Body)
	post.Body.Close()
	if post.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous MCP status: %d", post.StatusCode)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, readSecret, err := s.mcpTokens.Create(ctx, "Read client", "read")
	if err != nil {
		t.Fatal(err)
	}
	writeToken, writeSecret, err := s.mcpTokens.Create(ctx, "Write client", "write")
	if err != nil {
		t.Fatal(err)
	}
	connect := func(secret string) *mcp.ClientSession {
		t.Helper()
		client := mcp.NewClient(&mcp.Implementation{Name: "know-me-test", Version: "1.0.0"}, nil)
		session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp", HTTPClient: &http.Client{Transport: bearerTransport{secret}}, DisableStandaloneSSE: true}, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = session.Close() })
		return session
	}
	read := connect(readSecret)
	write := connect(writeSecret)
	readList, err := read.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	var readHasWrite bool
	for _, tool := range readList.Tools {
		if tool.Name == "posts_create" {
			readHasWrite = true
		}
	}
	if readHasWrite {
		t.Fatal("read-only token exposed write tool")
	}
	writeList, err := write.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	var writeHasCreate bool
	for _, tool := range writeList.Tools {
		if tool.Name == "posts_create" {
			writeHasCreate = true
		}
	}
	if !writeHasCreate {
		t.Fatal("write token missing post creation")
	}
	create, err := write.CallTool(ctx, &mcp.CallToolParams{Name: "posts_create", Arguments: map[string]any{"title": "MCP test post", "contentMd": "# Hello", "status": "draft", "categories": []string{"MCP tests"}, "tags": []string{"mcp"}}})
	if err != nil || create.IsError {
		t.Fatalf("posts_create: %v result: %#v", err, create)
	}
	list, err := read.CallTool(ctx, &mcp.CallToolParams{Name: "posts_list", Arguments: map[string]any{"query": "MCP test"}})
	if err != nil || list.IsError {
		t.Fatalf("posts_list: %v result: %#v", err, list)
	}
	posts, err := s.blog.ListAdmin(ctx)
	if err != nil || len(posts) != 1 || posts[0].Title != "MCP test post" {
		t.Fatalf("created post not persisted: %v %+v", err, posts)
	}
	taxonomy, err := read.CallTool(ctx, &mcp.CallToolParams{Name: "taxonomy_list", Arguments: map[string]any{}})
	if err != nil || taxonomy.IsError {
		t.Fatalf("taxonomy_list: %v %#v", err, taxonomy)
	}
	_, err = read.CallTool(ctx, &mcp.CallToolParams{Name: "posts_create", Arguments: map[string]any{"title": "Unauthorized"}})
	if err == nil {
		t.Fatal("read client unexpectedly invoked write-only tool")
	}
	_, err = write.CallTool(ctx, &mcp.CallToolParams{Name: "navigation_create_group", Arguments: map[string]any{"name": "MCP group", "visibility": "private"}})
	if err != nil {
		t.Fatal(err)
	}
	tree, err := s.navigation.Tree(ctx, true)
	if err != nil || len(tree.Groups) != 1 {
		t.Fatalf("group not persisted: %v", err)
	}
	// Real MCP tool calls must update the same stores as the Web admin.
	for _, tc := range []struct {
		name string
		args map[string]any
	}{
		{"site_update", map[string]any{"profileName": "MCP edited site"}},
		{"start_update", map[string]any{"startCardOpacity": 75}},
		{"navigation_create_item", map[string]any{"groupId": tree.Groups[0].ID, "name": "Know Me docs", "url": "https://example.com"}},
		{"taxonomy_change", map[string]any{"kind": "tag", "action": "create", "name": "integration-test"}},
	} {
		result, err := write.CallTool(ctx, &mcp.CallToolParams{Name: tc.name, Arguments: tc.args})
		if err != nil || result.IsError {
			t.Fatalf("%s failed: %v %+v", tc.name, err, result)
		}
	}
	settings, err := s.settings.GetSite(ctx)
	if err != nil || settings.ProfileName != "MCP edited site" || settings.StartCardOpacity != 75 {
		t.Fatalf("MCP settings writes not persisted: %+v err=%v", settings, err)
	}
	updatedTree, err := s.navigation.Tree(ctx, true)
	if err != nil || len(updatedTree.Groups[0].Items) != 1 {
		t.Fatalf("MCP navigation item not persisted: %v %+v", err, updatedTree)
	}
	// A destructive tool without explicit confirmation must not perform an action.
	unconfirmed, err := write.CallTool(ctx, &mcp.CallToolParams{Name: "posts_delete", Arguments: map[string]any{"id": posts[0].ID}})
	if err == nil && (unconfirmed == nil || !unconfirmed.IsError) {
		t.Fatal("post deletion without confirmation allowed")
	}
	if _, err := s.blog.GetByID(ctx, posts[0].ID); err != nil {
		t.Fatalf("unconfirmed delete removed post: %v", err)
	}
	_, err = s.mcpTokens.Revoke(ctx, writeToken.ID)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequestWithContext(ctx, "POST", server.URL+"/mcp", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+writeSecret)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked token status=%d", res.StatusCode)
	}
	req, err = http.NewRequestWithContext(ctx, "POST", server.URL+"/mcp", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+readSecret)
	req.Header.Set("Origin", "https://evil.example")
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign origin status=%d", res.StatusCode)
	}
}
