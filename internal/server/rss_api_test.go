package server

import (
	"context"
	"encoding/xml"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wanstu/know_me/internal/blog"
	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

func TestRSSFeedPublishedContentAndEmptyFeed(t *testing.T) {
	t.Parallel()
	baseDir := t.TempDir()
	s, err := New(runtimeconfig.Config{
		Listen:     "127.0.0.1:0",
		DataDir:    filepath.Join(baseDir, "data"),
		UploadsDir: filepath.Join(baseDir, "uploads"),
	}, BuildInfo{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	srv := httptest.NewServer(s.http.Handler)
	defer srv.Close()

	fetch := func() (rssFeed, string) {
		t.Helper()
		resp, err := http.Get(srv.URL + "/feed.xml")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("feed status %d", resp.StatusCode)
		}
		if typ := resp.Header.Get("Content-Type"); typ != "application/rss+xml; charset=utf-8" {
			t.Fatalf("invalid Content-Type: %s", typ)
		}
		raw, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(string(raw), "<?xml") {
			t.Fatalf("missing XML header: %s", raw)
		}
		var feed rssFeed
		if err := xml.Unmarshal(raw, &feed); err != nil {
			t.Fatalf("feed XML invalid: %v", err)
		}
		if feed.Version != "2.0" || feed.Channel.Link != srv.URL+"/blog" {
			t.Fatalf("invalid channel: %+v", feed.Channel)
		}
		return feed, string(raw)
	}
	empty, _ := fetch()
	if len(empty.Channel.Items) != 0 {
		t.Fatalf("empty feed should be valid: %+v", empty)
	}

	ctx := context.Background()
	now := time.Now().UTC().UnixMilli()
	old := now - 86400_000
	future := now + 86400_000
	_, err = s.blog.Save(ctx, blog.SaveInput{
		Title: "旧文章", Slug: "old", ContentMD: "内容", Excerpt: "old summary",
		Status: blog.StatusPublished, PublishedAt: &old, Pinned: true,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.blog.Save(ctx, blog.SaveInput{
		Title: "今日 <RSS> & XML", Slug: "new-rss", ContentMD: "正文",
		Excerpt: "转义 & <摘要>", Status: blog.StatusPublished, PublishedAt: &now,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.blog.Save(ctx, blog.SaveInput{
		Title: "草稿绝不公开", Slug: "private", Status: blog.StatusDraft, ContentMD: "不公开",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.blog.Save(ctx, blog.SaveInput{
		Title: "未来排期", Slug: "scheduled", Status: blog.StatusScheduled,
		PublishedAt: &future, ContentMD: "未来内容",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	feed, raw := fetch()
	if len(feed.Channel.Items) != 2 {
		t.Fatalf("only published posts should appear, got %+v", feed.Channel.Items)
	}
	if feed.Channel.Items[0].Title != "今日 <RSS> & XML" || feed.Channel.Items[1].Title != "旧文章" {
		t.Fatalf("published date ordering incorrect: %+v", feed.Channel.Items)
	}
	if feed.Channel.Items[0].Description != "转义 & <摘要>" {
		t.Fatalf("excerpt lost: %+v", feed.Channel.Items[0])
	}
	if !strings.Contains(raw, "&lt;RSS&gt; &amp; XML") || !strings.Contains(raw, "转义 &amp; &lt;摘要&gt;") {
		t.Fatalf("RSS content was not XML-escaped: %s", raw)
	}
	if feed.Channel.Items[0].Link != srv.URL+"/blog/new-rss" ||
		feed.Channel.Items[0].GUID.Value != feed.Channel.Items[0].Link ||
		feed.Channel.Items[0].GUID.IsPermaLink != "true" {
		t.Fatalf("invalid RSS post URL: %+v", feed.Channel.Items[0])
	}
	if _, err = time.Parse(time.RFC1123Z, feed.Channel.Items[0].PubDate); err != nil {
		t.Fatalf("invalid RFC1123 date: %s", feed.Channel.Items[0].PubDate)
	}

	req := httptest.NewRequest("GET", "http://index.example/feed.xml", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	rr := httptest.NewRecorder()
	s.http.Handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("reverse proxy feed status %d", rr.Code)
	}
	var behindProxy rssFeed
	if err := xml.Unmarshal(rr.Body.Bytes(), &behindProxy); err != nil {
		t.Fatal(err)
	}
	if behindProxy.Channel.Link != "https://index.example/blog" ||
		behindProxy.Channel.Items[0].Link != "https://index.example/blog/new-rss" {
		t.Fatalf("reverse proxy absolute URLs wrong: %+v", behindProxy.Channel)
	}
}
