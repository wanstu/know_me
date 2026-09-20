package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"path/filepath"
	"testing"
	"time"

	"github.com/wanstu/know_me/internal/blog"
	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

func TestNativeBlogAPI(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	s, err := New(runtimeconfig.Config{
		Listen:     "127.0.0.1:0",
		DataDir:    filepath.Join(root, "data"),
		UploadsDir: filepath.Join(root, "uploads"),
	}, BuildInfo{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.auth.UpsertAdmin(context.Background(), "admin", "native-test-password", "Admin"); err != nil {
		t.Fatal(err)
	}
	addr, err := s.Listen()
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Serve(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("server shutdown: %v", err)
			}
		case <-time.After(3 * time.Second):
			t.Error("server did not stop")
		}
	})

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	base := "http://" + addr

	login := bytes.NewBufferString(`{"username":"admin","password":"native-test-password"}`)
	req, _ := http.NewRequest(http.MethodPost, base+"/api/auth/login", login)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", base)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login=%d", resp.StatusCode)
	}

	body := bytes.NewBufferString(`{"title":"Native API","slug":"native-api","contentMd":"# Native\n\nnative_api_unique_term","status":"published","tags":["Go"],"categories":["Notes"]}`)
	req, _ = http.NewRequest(http.MethodPost, base+"/api/posts", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", base)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create=%d body=%s", resp.StatusCode, data)
	}
	var created struct {
		Post struct {
			ID int64 `json:"id"`
		} `json:"post"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if created.Post.ID <= 0 {
		t.Fatal("missing post id")
	}

	resp, err = client.Get(base + "/api/posts?summary=1")
	if err != nil {
		t.Fatal(err)
	}
	var adminSummary struct {
		Posts []struct {
			ID        int64  `json:"id"`
			ContentMD string `json:"contentMd"`
		} `json:"posts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&adminSummary); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(adminSummary.Posts) != 1 || adminSummary.Posts[0].ID != created.Post.ID || adminSummary.Posts[0].ContentMD != "" {
		t.Fatalf("admin summary=%#v", adminSummary.Posts)
	}

	resp, err = http.Get(base + "/api/blog/posts?query=native_api_unique_term")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("public=%d", resp.StatusCode)
	}
	var public struct {
		Posts []struct {
			ID        int64  `json:"id"`
			ContentMD string `json:"contentMd"`
		} `json:"posts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&public); err != nil {
		t.Fatal(err)
	}
	if len(public.Posts) != 1 || public.Posts[0].ID != created.Post.ID || public.Posts[0].ContentMD == "" {
		t.Fatalf("public posts=%#v", public.Posts)
	}
	resp.Body.Close()

	resp, err = http.Get(base + "/api/blog/posts?query=native_api_unique_term&summary=1")
	if err != nil {
		t.Fatal(err)
	}
	public.Posts = nil
	if err := json.NewDecoder(resp.Body).Decode(&public); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(public.Posts) != 1 || public.Posts[0].ID != created.Post.ID || public.Posts[0].ContentMD != "" {
		t.Fatalf("summary posts=%#v", public.Posts)
	}

	resp, err = http.Get(base + "/api/blog/posts?year=" + time.Now().Format("2006"))
	if err != nil {
		t.Fatal(err)
	}
	var byYear struct {
		Posts []struct {
			ID int64 `json:"id"`
		} `json:"posts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&byYear); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(byYear.Posts) != 1 || byYear.Posts[0].ID != created.Post.ID {
		t.Fatalf("year posts=%#v", byYear.Posts)
	}

	resp, err = http.Get(base + "/api/blog/posts?year=1900")
	if err != nil {
		t.Fatal(err)
	}
	byYear.Posts = nil
	if err := json.NewDecoder(resp.Body).Decode(&byYear); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(byYear.Posts) != 0 {
		t.Fatalf("unexpected 1900 posts=%#v", byYear.Posts)
	}
	olderAt := time.Now().Add(-3 * time.Hour).UnixMilli()
	middleAt := time.Now().Add(-2 * time.Hour).UnixMilli()
	newerAt := time.Now().Add(-1 * time.Hour).UnixMilli()
	older, err := s.blog.Save(context.Background(), blog.SaveInput{Title: "Older", Slug: "older", ContentMD: "old", Status: blog.StatusPublished, PublishedAt: &olderAt}, nil)
	if err != nil {
		t.Fatal(err)
	}
	middle, err := s.blog.Save(context.Background(), blog.SaveInput{Title: "Middle", Slug: "middle", ContentMD: "middle", Status: blog.StatusPublished, PublishedAt: &middleAt}, nil)
	if err != nil {
		t.Fatal(err)
	}
	newer, err := s.blog.Save(context.Background(), blog.SaveInput{Title: "Newer", Slug: "newer", ContentMD: "new", Status: blog.StatusPublished, PublishedAt: &newerAt}, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err = http.Get(base + "/api/blog/posts/" + middle.Slug + "/neighbors")
	if err != nil {
		t.Fatal(err)
	}
	var neighbors struct {
		Previous *struct {
			ID int64 `json:"id"`
		} `json:"previous"`
		Next *struct {
			ID int64 `json:"id"`
		} `json:"next"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&neighbors); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if neighbors.Previous == nil || neighbors.Previous.ID != older.ID || neighbors.Next == nil || neighbors.Next.ID != newer.ID {
		t.Fatalf("neighbors=%#v", neighbors)
	}

}
