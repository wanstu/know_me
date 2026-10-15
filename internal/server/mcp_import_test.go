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
	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

func TestMCPMarkdownImportPreviewAndApply(t *testing.T) {
	root := t.TempDir()
	s, err := New(runtimeconfig.Config{Listen: "127.0.0.1:0", DataDir: filepath.Join(root, "data"), UploadsDir: filepath.Join(root, "uploads")}, BuildInfo{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	server := httptest.NewServer(s.http.Handler)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_, secret, err := s.mcpTokens.Create(ctx, "Import Test", "write")
	if err != nil {
		t.Fatal(err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "import-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp", HTTPClient: &http.Client{Transport: bearerTransport{secret}}, DisableStandaloneSSE: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	call := func(name string, args any, shouldFail bool) *mcp.CallToolResult {
		t.Helper()
		res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if (err != nil || res == nil || res.IsError) != shouldFail {
			t.Fatalf("%s failed=%t err=%v result=%+v", name, shouldFail, err, res)
		}
		return res
	}
	docs := []map[string]any{
		{"path": "source/_posts/docker/my-docker.md", "markdown": "---\ntitle: 旧文章标题\ndate: 2024-06-22 00:00:00\ntags:\n  - Docker\n  - 运维\n---\n# 原始 Markdown\n![img](http://img.example.com/a.png)\n"},
		{"path": "source/_posts/技术/mcp-test.md", "markdown": "---\ntitle: MCP 教程\ndate: 2023-01-02\ncategories: [开发, AI]\ntags: MCP, Go\n---\n## 重要正文\n\n带图片 ![x](./img/logo.png)\n"},
		{"path": "source/_posts/技术/draft.md", "markdown": "---\ntitle: 草稿\ndraft: true\ndate: 2023-05-01\n---\n# 草稿内容"},
	}
	request := map[string]any{"documents": docs, "publish": true}
	preview := call("posts_import_preview", request, false)
	var plan mcpImportPlan
	payload, _ := json.Marshal(preview.StructuredContent)
	if err := json.Unmarshal(payload, &plan); err != nil {
		t.Fatal(err)
	}
	if plan.Create != 3 || plan.Skip != 0 || plan.Invalid != 0 || len(plan.PreviewHash) != 64 {
		t.Fatalf("plan=%+v", plan)
	}
	if len(plan.Items[0].Categories) != 1 || plan.Items[0].Categories[0] != "docker" {
		t.Fatalf("folder category not applied: %+v", plan.Items[0])
	}
	if plan.Items[0].PublishedAt == nil {
		t.Fatal("missing parsed hexo date")
	}
	expectedDate := time.Date(2024, 6, 22, 0, 0, 0, 0, time.FixedZone("UTC+08", 8*3600)).UnixMilli()
	if *plan.Items[0].PublishedAt != expectedDate {
		t.Fatalf("hexo timezone conversion: got=%d want=%d", *plan.Items[0].PublishedAt, expectedDate)
	}
	if plan.Items[2].Status != "draft" {
		t.Fatalf("front matter draft ignored: %+v", plan.Items[2])
	}
	if len(plan.Items[1].Warnings) < 1 {
		t.Fatal("relative asset warning missing")
	}
	base := map[string]any{"documents": docs, "publish": true, "previewHash": plan.PreviewHash}
	call("posts_import_apply", base, true)
	base["confirm"] = true
	base["previewHash"] = "bad"
	call("posts_import_apply", base, true)
	base["previewHash"] = plan.PreviewHash
	result := call("posts_import_apply", base, false)
	var report struct {
		Created int `json:"created"`
		Skipped int `json:"skipped"`
		Failed  int `json:"failed"`
	}
	payload, _ = json.Marshal(result.StructuredContent)
	if err := json.Unmarshal(payload, &report); err != nil {
		t.Fatal(err)
	}
	if report.Created != 3 || report.Skipped != 0 || report.Failed != 0 {
		t.Fatalf("apply report=%+v", report)
	}
	posts, err := s.blog.ListAdmin(ctx)
	if err != nil || len(posts) != 3 {
		t.Fatalf("imported posts=%+v err=%v", posts, err)
	}
	for _, p := range posts {
		if strings.HasPrefix(p.ContentMD, "---") {
			t.Fatalf("frontmatter not stripped: %s", p.ContentMD)
		}
		if p.Title == "旧文章标题" && (len(p.Categories) != 1 || p.Categories[0] != "docker" || p.PublishedAt == nil || *p.PublishedAt != expectedDate) {
			t.Fatalf("old metadata lost: %+v", p)
		}
		if p.Title == "草稿" && (p.Status != "draft" || p.FirstPublishedAt == nil || p.PublishedAt != nil) {
			t.Fatalf("draft metadata invalid: %+v", p)
		}
	}
	repeated := call("posts_import_preview", request, false)
	payload, _ = json.Marshal(repeated.StructuredContent)
	if err := json.Unmarshal(payload, &plan); err != nil {
		t.Fatal(err)
	}
	if plan.Create != 0 || plan.Skip != 3 {
		t.Fatalf("second preview not idempotent: %+v", plan)
	}
	retry := call("posts_import_apply", base, false)
	payload, _ = json.Marshal(retry.StructuredContent)
	if err := json.Unmarshal(payload, &report); err != nil {
		t.Fatal(err)
	}
	if report.Created != 0 || report.Skipped != 3 {
		t.Fatalf("retry unexpectedly created duplicates: %+v", report)
	}
	invalid := map[string]any{"documents": []map[string]any{
		{"path": "../etc/passwd.md", "markdown": "# bad"},
		{"path": "posts/valid.md", "markdown": "# valid"},
	}}
	p2 := call("posts_import_preview", invalid, false)
	payload, _ = json.Marshal(p2.StructuredContent)
	if err := json.Unmarshal(payload, &plan); err != nil {
		t.Fatal(err)
	}
	if plan.Invalid != 1 || plan.Create != 1 {
		t.Fatalf("invalid preview=%+v", plan)
	}
	call("posts_import_apply", map[string]any{"documents": invalid["documents"], "previewHash": plan.PreviewHash, "confirm": true}, true)
	posts, err = s.blog.ListAdmin(ctx)
	if err != nil || len(posts) != 3 {
		t.Fatalf("invalid batch partially imported: count=%d err=%v", len(posts), err)
	}
}

func TestMCPImportDuplicatePathsAndBadFrontMatter(t *testing.T) {
	cases := []struct {
		path, markdown string
		wantErr        bool
	}{
		{"source/_posts/js/a.md", "---\ntitle: a\ndate: no\n---\ntext", true},
		{"source/_posts/js/b.md", "---\ntitle: b\nno closing", true},
		{"source/_posts/js/c.md", "---\ntitle: c\ntags: [Go, Vue]\ncategories:\n - JS\n---\ncontent", false},
		{"source/_posts/js/empty.md", "---\ntitle: empty\n---\n", true},
		{"source/_posts/js/foo.txt", "# foo", true},
	}
	for _, c := range cases {
		_, err := parseImportDocument(mcpImportDocument{Path: c.path, Markdown: c.markdown}, false)
		if (err != nil) != c.wantErr {
			t.Fatalf("%q: err=%v wantErr=%v", c.path, err, c.wantErr)
		}
	}
}
