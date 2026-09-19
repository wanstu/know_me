package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"path/filepath"
	"testing"
	"time"

	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

func TestInitialAdminSetupAPI(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	s, err := New(runtimeconfig.Config{
		Listen:     "127.0.0.1:0",
		DataDir:    filepath.Join(root, "data"),
		UploadsDir: filepath.Join(root, "uploads"),
	}, BuildInfo{Version: "test", Commit: "abc"})
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

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	base := "http://" + addr

	resp, err := client.Get(base + "/api/auth/setup")
	if err != nil {
		t.Fatal(err)
	}
	var setup struct {
		NeedsSetup bool `json:"needsSetup"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&setup); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !setup.NeedsSetup {
		t.Fatalf("initial setup: status=%d needsSetup=%v", resp.StatusCode, setup.NeedsSetup)
	}

	body := bytes.NewBufferString(`{"username":"owner","password":"0123456789-password","displayName":"Owner"}`)
	req, _ := http.NewRequest(http.MethodPost, base+"/api/auth/setup", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Origin", base)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("setup create status = %d", resp.StatusCode)
	}

	resp, err = client.Get(base + "/api/auth/me")
	if err != nil {
		t.Fatal(err)
	}
	var me struct {
		User struct {
			Username string `json:"username"`
		} `json:"user"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || me.User.Username != "owner" {
		t.Fatalf("setup session: status=%d username=%q", resp.StatusCode, me.User.Username)
	}

	resp, err = client.Get(base + "/api/auth/setup")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.NewDecoder(resp.Body).Decode(&setup); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || setup.NeedsSetup {
		t.Fatalf("setup after create: status=%d needsSetup=%v", resp.StatusCode, setup.NeedsSetup)
	}

	body = bytes.NewBufferString(`{"username":"second","password":"another-password-12345"}`)
	req, _ = http.NewRequest(http.MethodPost, base+"/api/auth/setup", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Origin", base)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("second setup status = %d", resp.StatusCode)
	}
}
