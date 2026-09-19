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

func TestNativeAuthAndSettingsAPI(t *testing.T) {
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
	created, err := s.auth.UpsertAdmin(context.Background(), "admin", "0123456789-password", "Administrator")
	if err != nil || !created {
		t.Fatalf("create admin: created=%v err=%v", created, err)
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

	loginBody := bytes.NewBufferString(`{"username":"admin","password":"0123456789-password"}`)
	req, _ := http.NewRequest(http.MethodPost, base+"/api/auth/login", loginBody)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Origin", base)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d", resp.StatusCode)
	}

	resp, err = client.Get(base + "/api/auth/me")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("me status = %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp, err = client.Get(base + "/api/settings")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("settings get status = %d", resp.StatusCode)
	}
	resp.Body.Close()

	patch := bytes.NewBufferString(`{"themePreset":"forest","themeMode":"light","profileName":"Native"}`)
	req, _ = http.NewRequest(http.MethodPatch, base+"/api/settings", patch)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", base)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("settings patch status = %d", resp.StatusCode)
	}
	var payload struct {
		Settings struct {
			ThemePreset string `json:"themePreset"`
			ThemeMode   string `json:"themeMode"`
			ProfileName string `json:"profileName"`
		} `json:"settings"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if payload.Settings.ThemePreset != "forest" || payload.Settings.ThemeMode != "light" || payload.Settings.ProfileName != "Native" {
		t.Fatalf("settings payload = %#v", payload.Settings)
	}

	req, _ = http.NewRequest(http.MethodPost, base+"/api/auth/logout", nil)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Origin", base)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("logout status = %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp, err = client.Get(base + "/api/auth/me")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("me after logout status = %d", resp.StatusCode)
	}
}
