package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestNetworkAccessDefaultAllowsAnyHostAndIP(t *testing.T) {
	t.Parallel()
	policy := NetworkAccessPolicy{}
	for _, host := range []string{"localhost:3000", "192.168.1.2:3000", "example.com:443", "another.example:3000"} {
		req := httptest.NewRequest(http.MethodGet, "http://"+host+"/", nil)
		req.RemoteAddr = "10.9.1.3:4567"
		if !policy.allows(req) {
			t.Fatalf("default deny %q", host)
		}
	}
}

func TestNetworkAccessHostAndClientIPRestriction(t *testing.T) {
	t.Parallel()
	policy, err := normalizeAccessPolicy(NetworkAccessPolicy{
		Enabled: true, AllowedHosts: []string{"MY.EXAMPLE.COM", "other.example.com"}, AllowedIPs: []string{"192.168.1.0/24", "127.0.0.1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		host, remote string
		ok           bool
	}{
		{"my.example.com:3000", "192.168.1.14:12001", true},
		{"MY.EXAMPLE.COM:80", "127.0.0.1:111", true},
		{"other.example.com:80", "192.168.2.3:111", false},
		{"evil.example.com:80", "192.168.1.14:111", false},
		{"192.168.1.14:80", "192.168.1.14:111", false},
	}
	for _, tt := range tests {
		req := httptest.NewRequest(http.MethodGet, "http://"+tt.host+"/", nil)
		req.RemoteAddr = tt.remote
		req.Header.Set("X-Forwarded-For", "192.168.1.14") // untrusted proxy header must not grant access
		if got := policy.allows(req); got != tt.ok {
			t.Errorf("%q from %q allowed=%v want %v", tt.host, tt.remote, got, tt.ok)
		}
	}
}

func TestNetworkAccessValidation(t *testing.T) {
	t.Parallel()
	for _, policy := range []NetworkAccessPolicy{
		{Enabled: true},
		{Enabled: true, AllowedHosts: []string{"*.example.com"}},
		{Enabled: true, AllowedHosts: []string{"http://example.com"}},
		{Enabled: true, AllowedIPs: []string{"10.0.0.999"}},
	} {
		if _, err := normalizeAccessPolicy(policy); err == nil {
			t.Errorf("expected invalid policy %+v", policy)
		}
	}
}

func TestNetworkAccessSavedAndAppliedWithoutRestart(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	store, err := newNetworkAccessStore(root)
	if err != nil {
		t.Fatal(err)
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	s := &Server{networkAccess: store}
	middleware := s.networkAccessMiddleware(handler)
	request := func(host, remote string) int {
		req := httptest.NewRequest(http.MethodGet, "http://"+host+"/", nil)
		req.RemoteAddr = remote
		w := httptest.NewRecorder()
		middleware.ServeHTTP(w, req)
		return w.Code
	}
	if code := request("anything.example:80", "8.8.8.8:999"); code != http.StatusOK {
		t.Fatalf("default status=%d", code)
	}
	if err := store.update(NetworkAccessPolicy{Enabled: true, AllowedHosts: []string{"allowed.example"}, AllowedIPs: []string{"10.10.0.0/16"}}); err != nil {
		t.Fatal(err)
	}
	if code := request("anything.example:80", "10.10.1.2:999"); code != http.StatusForbidden {
		t.Fatalf("host forbidden status=%d", code)
	}
	if code := request("allowed.example:80", "8.8.8.8:999"); code != http.StatusForbidden {
		t.Fatalf("IP forbidden status=%d", code)
	}
	if code := request("allowed.example:80", "10.10.1.2:999"); code != http.StatusOK {
		t.Fatalf("allowed status=%d", code)
	}
	reloaded, err := newNetworkAccessStore(root)
	if err != nil {
		t.Fatal(err)
	}
	if !reloaded.get().Enabled {
		t.Fatal("policy not persisted")
	}
	if filepath.Base(reloaded.path) != "network-access.json" {
		t.Fatalf("unexpected file %s", reloaded.path)
	}
	if err := store.update(NetworkAccessPolicy{Enabled: false}); err != nil {
		t.Fatal(err)
	}
	if code := request("anything.example:80", "8.8.8.8:999"); code != http.StatusOK {
		t.Fatalf("disabled status=%d", code)
	}
}
