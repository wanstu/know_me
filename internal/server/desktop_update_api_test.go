package server

import (
	"bytes"
	"context"
	"net/http"
	"net/http/cookiejar"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

type fakeDesktopUpdateService struct {
	mu         sync.Mutex
	status     DesktopUpdateStatus
	checkCalls int
}

func (f *fakeDesktopUpdateService) Status() DesktopUpdateStatus {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.status
}

func (f *fakeDesktopUpdateService) Check(context.Context) (DesktopUpdateStatus, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.checkCalls++
	f.status.State = "up-to-date"
	return f.status, nil
}

func (f *fakeDesktopUpdateService) StartDownload() (DesktopUpdateStatus, error) {
	return f.Status(), nil
}

func (f *fakeDesktopUpdateService) InstallAndRestart() (DesktopUpdateStatus, error) {
	return f.Status(), nil
}

func TestDesktopUpdateAPIRequiresInjectedServiceAndAuthenticatedSameOrigin(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	update := &fakeDesktopUpdateService{status: DesktopUpdateStatus{
		Available:        true,
		State:            "idle",
		Channel:          "stable",
		CurrentVersion:   "v0.1.6",
		InstallationMode: "user",
		CanAutoInstall:   true,
	}}
	s, err := NewWithOptions(runtimeconfig.Config{
		Listen:     "127.0.0.1:0",
		DataDir:    filepath.Join(root, "data"),
		UploadsDir: filepath.Join(root, "uploads"),
	}, BuildInfo{Version: "v0.1.6", Commit: "abc"}, ServerOptions{DesktopUpdate: update})
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

	base := "http://" + addr
	resp, err := http.Get(base + "/api/desktop/update")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated updater status = %d", resp.StatusCode)
	}

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	loginBody := bytes.NewBufferString(`{"username":"admin","password":"0123456789-password"}`)
	req, _ := http.NewRequest(http.MethodPost, base+"/api/auth/login", loginBody)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Origin", base)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d", resp.StatusCode)
	}

	resp, err = client.Get(base + "/api/desktop/update")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("authenticated updater status = %d", resp.StatusCode)
	}

	req, _ = http.NewRequest(http.MethodPost, base+"/api/desktop/update/check", bytes.NewBufferString("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://example.invalid")
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin updater check status = %d", resp.StatusCode)
	}

	req, _ = http.NewRequest(http.MethodPost, base+"/api/desktop/update/check", bytes.NewBufferString("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", base)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("same-origin updater check status = %d", resp.StatusCode)
	}

	update.mu.Lock()
	checkCalls := update.checkCalls
	update.mu.Unlock()
	if checkCalls != 1 {
		t.Fatalf("updater check calls = %d want 1", checkCalls)
	}
}

func TestServerWithoutDesktopUpdaterReturnsAPINotFound(t *testing.T) {
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

	resp, err := http.Get("http://" + addr + "/api/desktop/update")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("updater endpoint without desktop service = %d want %d", resp.StatusCode, http.StatusNotFound)
	}
}
