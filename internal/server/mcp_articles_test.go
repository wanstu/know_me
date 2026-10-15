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

func TestMCPArticlePublicationTaxonomyDatesAndRevisions(t *testing.T) {
	s, err := New(runtimeconfig.Config{Listen: "127.0.0.1:0", DataDir: filepath.Join(t.TempDir(), "data"), UploadsDir: filepath.Join(t.TempDir(), "uploads")}, BuildInfo{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	server := httptest.NewServer(s.http.Handler)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_, secret, err := s.mcpTokens.Create(ctx, "Article integration", "write")
	if err != nil {
		t.Fatal(err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "article-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp", HTTPClient: &http.Client{Transport: bearerTransport{secret}}, DisableStandaloneSSE: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	invoke := func(name string, args map[string]any, shouldFail bool) {
		t.Helper()
		result, callErr := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		failed := callErr != nil || result == nil || result.IsError
		if failed != shouldFail {
			t.Fatalf("%s expected error=%v, got err=%v result=%+v", name, shouldFail, callErr, result)
		}
	}
	invoke("posts_create", map[string]any{"title": "invalid date", "contentMd": "bad", "status": "published", "publishedAt": 1770010000}, true)
	invoke("posts_create", map[string]any{"title": "unexpected future publication", "contentMd": "bad", "status": "published", "publishedAt": time.Now().Add(4 * time.Hour).UnixMilli()}, true)
	invoke("posts_create", map[string]any{"title": "draft with date", "status": "draft", "publishedAtDate": "2022-05-01"}, true)
	invoke("posts_create", map[string]any{
		"title": "Historical article", "slug": "history", "contentMd": "# Original", "status": "published",
		"publishedAtDate": "2022-05-01", "tags": []string{"Go", "MCP"}, "categories": []string{"Dev"},
		"seoTitle": "First SEO", "seoDescription": "Original description", "pinned": true,
	}, false)
	posts, err := s.blog.ListAdmin(ctx)
	if err != nil || len(posts) != 1 {
		t.Fatalf("initial post: %v %+v", err, posts)
	}
	id := posts[0].ID
	publishedAt := time.Date(2022, 5, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	if posts[0].PublishedAt == nil || *posts[0].PublishedAt != publishedAt || posts[0].FirstPublishedAt == nil || *posts[0].FirstPublishedAt != publishedAt {
		t.Fatalf("initial publish dates were not preserved: %+v", posts[0])
	}
	invoke("posts_update", map[string]any{"id": id, "expectedUpdatedAt": int64(1), "title": "Stale change"}, true)
	invoke("posts_update", map[string]any{
		"id": id, "title": "Edited article", "contentMd": "# New content",
		"tags": []string{"MCP"}, "categories": []string{"Docs"},
		"seoTitle": "New SEO", "seoDescription": "New description", "pinned": false,
		"firstPublishedAtDate": "2021-12-31",
	}, false)
	edited, err := s.blog.GetByID(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if edited.ContentMD != "# New content" || edited.Pinned || edited.SEOTitle != "New SEO" || len(edited.Tags) != 1 || edited.Tags[0] != "MCP" || len(edited.Categories) != 1 || edited.Categories[0] != "Docs" {
		t.Fatalf("incomplete edit: %+v", edited)
	}
	if edited.FirstPublishedAt == nil || *edited.FirstPublishedAt != time.Date(2021, 12, 31, 0, 0, 0, 0, time.UTC).UnixMilli() {
		t.Fatalf("first publication date not updated: %+v", edited)
	}
	revisions, err := s.blog.ListRevisions(ctx, id, 50)
	if err != nil || len(revisions) < 1 {
		t.Fatalf("missing revision: %v %+v", err, revisions)
	}
	oldRevision := revisions[0]
	if oldRevision.Metadata["seoTitle"] != "First SEO" || oldRevision.Metadata["pinned"] != true {
		t.Fatalf("revision lost SEO/pinned: %+v", oldRevision.Metadata)
	}
	if got, ok := oldRevision.Metadata["tags"].([]any); !ok || len(got) != 2 {
		t.Fatalf("revision lost tags: %+v", oldRevision.Metadata)
	}
	invoke("posts_revision_get", map[string]any{"id": id, "revisionId": oldRevision.ID}, false)
	invoke("posts_revisions_list", map[string]any{"id": id, "limit": 20}, false)

	invoke("posts_taxonomy_update", map[string]any{"id": id, "addTags": []string{"NewTag"}, "removeTags": []string{"MCP"}, "addCategories": []string{"Ops"}}, false)
	tagged, err := s.blog.GetByID(ctx, id)
	if err != nil || len(tagged.Tags) != 1 || tagged.Tags[0] != "NewTag" || len(tagged.Categories) != 2 {
		t.Fatalf("taxonomy update failed: %+v %v", tagged, err)
	}
	invoke("posts_taxonomy_update", map[string]any{"id": id, "replaceTags": []string{}, "addTags": []string{"Oops"}}, true)
	invoke("posts_taxonomy_update", map[string]any{"id": id, "replaceTags": []string{}}, false)
	tagged, err = s.blog.GetByID(ctx, id)
	if err != nil || len(tagged.Tags) != 0 || len(tagged.Categories) != 2 {
		t.Fatalf("clear tags accidentally removed categories: %+v %v", tagged, err)
	}

	scheduleAt := time.Now().Add(24 * time.Hour).Truncate(time.Second)
	invoke("posts_set_status", map[string]any{"id": id, "action": "schedule", "publishedAtDate": scheduleAt.Format(time.RFC3339)}, false)
	scheduled, err := s.blog.GetByID(ctx, id)
	if err != nil || scheduled.Status != blog.StatusScheduled || scheduled.PublishedAt == nil || *scheduled.PublishedAt != scheduleAt.UnixMilli() {
		t.Fatalf("not scheduled: %+v err=%v", scheduled, err)
	}
	if _, err := s.blog.GetPublishedBySlug(ctx, scheduled.Slug); err == nil {
		t.Fatal("future scheduled post visible before scheduled time")
	}
	invoke("posts_set_status", map[string]any{"id": id, "action": "publish"}, false)
	published, err := s.blog.GetByID(ctx, id)
	if err != nil || published.Status != blog.StatusPublished || published.PublishedAt == nil || *published.PublishedAt >= scheduleAt.UnixMilli() {
		t.Fatalf("publish now retained future date: %+v %v", published, err)
	}
	if published.FirstPublishedAt == nil || *published.FirstPublishedAt != *edited.FirstPublishedAt {
		t.Fatal("republish overwrote first publication date")
	}
	invoke("posts_set_status", map[string]any{"id": id, "action": "unpublish"}, false)
	draft, err := s.blog.GetByID(ctx, id)
	if err != nil || draft.Status != blog.StatusDraft || draft.PublishedAt != nil {
		t.Fatalf("unpublish failed: %+v %v", draft, err)
	}
	if _, err := s.blog.GetPublishedBySlug(ctx, draft.Slug); err == nil {
		t.Fatal("draft still publicly accessible")
	}
	invoke("posts_revision_restore", map[string]any{"id": id, "revisionId": oldRevision.ID}, true)
	invoke("posts_revision_restore", map[string]any{"id": id, "revisionId": oldRevision.ID, "confirm": true}, false)
	restored, err := s.blog.GetByID(ctx, id)
	if err != nil || restored.Title != "Historical article" || restored.ContentMD != "# Original" || !restored.Pinned || restored.SEOTitle != "First SEO" || len(restored.Tags) != 2 || len(restored.Categories) != 1 || restored.Categories[0] != "Dev" {
		t.Fatalf("restored fields mismatch: %+v err=%v", restored, err)
	}
	if restored.PublishedAt == nil || *restored.PublishedAt != publishedAt ||
		restored.FirstPublishedAt == nil || *restored.FirstPublishedAt != publishedAt {
		t.Fatalf("revision failed to restore original dates: %+v", restored)
	}
	filtered, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "posts_list", Arguments: map[string]any{
		"status": "published", "category": "Dev", "tag": "Go",
		"publishedFrom": publishedAt - 1, "publishedTo": publishedAt + 1,
	}})
	if err != nil || filtered.IsError {
		t.Fatalf("filtered posts query: %v %+v", err, filtered)
	}
	body, _ := json.Marshal(filtered.StructuredContent)
	var page struct {
		Total int `json:"total"`
		Posts []struct {
			ID int64 `json:"id"`
		} `json:"posts"`
	}
	if err := json.Unmarshal(body, &page); err != nil || page.Total != 1 || len(page.Posts) != 1 || page.Posts[0].ID != id {
		t.Fatalf("unexpected filtered page: %s err=%v", body, err)
	}
	missing, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "posts_list", Arguments: map[string]any{"tag": "nonexistent"}})
	if err != nil || missing.IsError {
		t.Fatalf("missing tag query: %v %+v", err, missing)
	}
	body, _ = json.Marshal(missing.StructuredContent)
	if err := json.Unmarshal(body, &page); err != nil || page.Total != 0 || len(page.Posts) != 0 {
		t.Fatalf("empty filtered page not empty: %s err=%v", body, err)
	}
	invoke("posts_delete", map[string]any{"id": id}, true)
	if _, err := s.blog.GetByID(ctx, id); err != nil {
		t.Fatal("unconfirmed delete removed post")
	}
	invoke("posts_delete", map[string]any{"id": id, "confirm": true}, false)
	if _, err := s.blog.GetByID(ctx, id); err == nil {
		t.Fatal("confirmed delete retained post")
	}
}

func TestMCPDateParsing(t *testing.T) {
	date := "2026-10-15T14:30:00+08:00"
	parsed, err := resolveMCPDate(nil, &date)
	if err != nil || parsed == nil {
		t.Fatalf("RFC3339 timezone parsing: %v", err)
	}
	if got := time.UnixMilli(*parsed).UTC().Format(time.RFC3339); got != "2026-10-15T06:30:00Z" {
		t.Fatalf("timezone not honored: %s", got)
	}
	date = "2026-10-15"
	parsed, err = resolveMCPDate(nil, &date)
	if err != nil || time.UnixMilli(*parsed).UTC().Hour() != 0 {
		t.Fatalf("date-only UTC parsing: %v", err)
	}
	millis := int64(1_760_000_000_000)
	if _, err = resolveMCPDate(&millis, &date); err == nil {
		t.Fatal("ambiguous date accepted")
	}
	date = "October 15"
	if _, err = resolveMCPDate(nil, &date); err == nil {
		t.Fatal("invalid date accepted")
	}
}
