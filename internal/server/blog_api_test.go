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
			ID int64 `json:"id"`
		} `json:"posts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&public); err != nil {
		t.Fatal(err)
	}
	if len(public.Posts) != 1 || public.Posts[0].ID != created.Post.ID {
		t.Fatalf("public posts=%#v", public.Posts)
	}
}
