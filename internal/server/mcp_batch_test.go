package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wanstu/know_me/internal/blog"
	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

func TestMCPBatchTaxonomyPreviewAndConfirm(t *testing.T) {
	s, err := New(runtimeconfig.Config{Listen: "127.0.0.1:0", DataDir: filepath.Join(t.TempDir(), "data"), UploadsDir: filepath.Join(t.TempDir(), "uploads")}, BuildInfo{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	first, err := s.blog.Save(ctx, blog.SaveInput{Title: "One", ContentMD: "one", Status: blog.StatusDraft, Tags: []string{"Old"}, Categories: []string{"Tech"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.blog.Save(ctx, blog.SaveInput{Title: "Two", ContentMD: "two", Status: blog.StatusDraft, Tags: []string{"Old"}, Categories: []string{"Tech"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(s.http.Handler)
	defer server.Close()
	_, secret, err := s.mcpTokens.Create(ctx, "Batch", "write")
	if err != nil {
		t.Fatal(err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "batch-test", Version: "1"}, nil)
	sess, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp", HTTPClient: &http.Client{Transport: bearerTransport{secret}}, DisableStandaloneSSE: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()
	call := func(args map[string]any, fail bool) map[string]any {
		t.Helper()
		result, err := sess.CallTool(ctx, &mcp.CallToolParams{Name: "posts_batch_taxonomy", Arguments: args})
		if (err != nil || result == nil || result.IsError) != fail {
			t.Fatalf("call failed=%v expected=%v result=%+v", err, fail, result)
		}
		if fail {
			return nil
		}
		body, _ := json.Marshal(result.StructuredContent)
		var parsed map[string]any
		if err := json.Unmarshal(body, &parsed); err != nil {
			t.Fatal(err)
		}
		return parsed
	}
	ids := []int64{first.ID, second.ID}
	options := map[string]any{"ids": ids, "addTags": []string{"New"}, "removeTags": []string{"Old"}, "addCategories": []string{"MCP"}}
	result := call(options, false)
	if result["preview"] != true {
		t.Fatal("batch did not preview by default")
	}
	unchanged, err := s.blog.GetByID(ctx, first.ID)
	if err != nil || len(unchanged.Tags) != 1 || unchanged.Tags[0] != "Old" {
		t.Fatal("preview modified article")
	}
	call(map[string]any{"ids": []int64{first.ID, first.ID}, "addTags": []string{"New"}, "confirm": true}, true)
	call(map[string]any{"ids": []int64{first.ID, 999999}, "addTags": []string{"New"}, "confirm": true}, true)
	unchanged, err = s.blog.GetByID(ctx, first.ID)
	if err != nil || unchanged.Tags[0] != "Old" {
		t.Fatal("invalid batch partially modified articles")
	}
	options["confirm"] = true
	result = call(options, false)
	if result["updated"] != float64(2) {
		t.Fatalf("batch updated wrong count: %+v", result)
	}
	for _, id := range ids {
		p, err := s.blog.GetByID(ctx, id)
		if err != nil || len(p.Tags) != 1 || p.Tags[0] != "New" || len(p.Categories) != 2 || p.ContentMD == "" {
			t.Fatalf("batch unexpectedly modified post: %+v err=%v", p, err)
		}
		revisions, err := s.blog.ListRevisions(ctx, id, 10)
		if err != nil || len(revisions) == 0 {
			t.Fatalf("taxonomy-only update missed revision %d: %v", id, err)
		}
	}
}
