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

func TestNetworkAccessAdminAPIAndHostFiltering(t *testing.T) {
	root := t.TempDir()
	s, err := New(runtimeconfig.Config{Listen: "127.0.0.1:0", DataDir: filepath.Join(root, "data"), UploadsDir: filepath.Join(root, "uploads")}, BuildInfo{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	created, err := s.auth.UpsertAdmin(context.Background(), "admin", "temporary-password-for-test", "Admin")
	if err != nil || !created {
		t.Fatalf("create admin: %v %v", created, err)
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
				t.Error(err)
			}
		case <-time.After(5 * time.Second):
			t.Error("server did not stop")
		}
	})
	base := "http://" + addr
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	get := func(host string) (int, NetworkAccessPolicy) {
		req, _ := http.NewRequest(http.MethodGet, base+"/api/admin/network-access", nil)
		if host != "" {
			req.Host = host
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var result struct {
			Policy NetworkAccessPolicy `json:"policy"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&result)
		return resp.StatusCode, result.Policy
	}
	if status, _ := get(""); status != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status %d", status)
	}
	login, _ := http.NewRequest(http.MethodPost, base+"/api/auth/login", bytes.NewBufferString(`{"username":"admin","password":"temporary-password-for-test"}`))
	login.Header.Set("Content-Type", "application/json")
	login.Header.Set("Origin", base)
	resp, err := client.Do(login)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login %d", resp.StatusCode)
	}
	if status, value := get(""); status != http.StatusOK || value.Enabled || value.AllowedHosts == nil || value.AllowedIPs == nil {
		t.Fatalf("default allowed %+v status=%d", value, status)
	}
	put := func(body string) int {
		req, _ := http.NewRequest(http.MethodPut, base+"/api/admin/network-access", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", base)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		return resp.StatusCode
	}
	if status := put(`{"enabled":true,"allowedHosts":["only.example"],"allowedIPs":[]}`); status != http.StatusBadRequest {
		t.Fatalf("should reject self-lockout: %d", status)
	}
	if status := put(`{"enabled":true,"allowedHosts":["127.0.0.1"],"allowedIPs":["127.0.0.1"]}`); status != http.StatusOK {
		t.Fatalf("enable whitelist %d", status)
	}
	if status, value := get(""); status != http.StatusOK || !value.Enabled {
		t.Fatalf("enabled policy status %d %+v", status, value)
	}
	requestWithHost := func() int {
		req, _ := http.NewRequest(http.MethodGet, base+"/api/health", nil)
		req.Host = "unrestricted.test:80"
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		return res.StatusCode
	}
	if status := requestWithHost(); status != http.StatusForbidden {
		t.Fatalf("host should be rejected: %d", status)
	}
}
