package server

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/cookiejar"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/wanstu/know_me/internal/blog"
	"github.com/wanstu/know_me/internal/navigation"
	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

func TestMediaReferences(t *testing.T) {
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

	imageData := image.NewRGBA(image.Rect(0, 0, 2, 2))
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, imageData); err != nil {
		t.Fatal(err)
	}
	item, err := s.media.Save(context.Background(), "reference.png", "image/png", imageBytes.Bytes(), "reference")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.blog.Save(context.Background(), blog.SaveInput{
		Title: "Uses media", Slug: "uses-media", ContentMD: "![image](" + item.URL + ")", Status: blog.StatusPublished,
	}, nil); err != nil {
		t.Fatal(err)
	}
	settings, err := s.settings.GetSite(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	settings.AvatarURL = item.URL
	if _, err := s.settings.SetSite(context.Background(), settings); err != nil {
		t.Fatal(err)
	}
	groupID, err := s.navigation.CreateGroup(context.Background(), navigation.GroupInput{Name: "Media"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.navigation.CreateItem(context.Background(), navigation.ItemInput{
		GroupID: groupID, Name: "Icon", URL: "https://example.com", IconURL: item.URL,
	}); err != nil {
		t.Fatal(err)
	}

	resp, err = client.Get(base + "/api/media/" + strconv.FormatInt(item.ID, 10) + "/references")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("references=%d", resp.StatusCode)
	}
	var payload struct {
		Count      int `json:"count"`
		References []struct {
			Kind string `json:"kind"`
		} `json:"references"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Count != 3 || len(payload.References) != 3 {
		t.Fatalf("references=%#v", payload)
	}
}
