package server

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

func TestServerHealthAndKitAssets(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	s, err := New(runtimeconfig.Config{
		Listen:     "127.0.0.1:0",
		DataDir:    root + "/data",
		UploadsDir: root + "/uploads",
	}, BuildInfo{Version: "test", Commit: "abc", BuildTime: "2026-09-26T00:00:00Z"})
	if err != nil {
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

	base := "http://" + addr
	resp, err := http.Get(base + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("health status = %d", resp.StatusCode)
	}
	var health map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	if health["status"] != "ok" || health["version"] != "test" || health["build_time"] != "2026-09-26T00:00:00Z" {
		t.Fatalf("unexpected health: %#v", health)
	}

	for _, path := range []string{"/", "/desktopkit/tokens.css", "/desktopkit/theme.js", "/desktopkit-theme/aurora.css", "/some/spa/route"} {
		response, err := http.Get(base + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("%s status = %d", path, response.StatusCode)
		}
	}
}
