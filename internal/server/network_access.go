package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type NetworkAccessPolicy struct {
	Enabled      bool     `json:"enabled"`
	AllowedHosts []string `json:"allowedHosts"`
	AllowedIPs   []string `json:"allowedIPs"`
}

type networkAccessStore struct {
	mu    sync.RWMutex
	path  string
	value NetworkAccessPolicy
}

func newNetworkAccessStore(dataDir string) (*networkAccessStore, error) {
	store := &networkAccessStore{path: filepath.Join(dataDir, "network-access.json")}
	data, err := os.ReadFile(store.path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read network access settings: %w", err)
	}
	if err := json.Unmarshal(data, &store.value); err != nil {
		return nil, fmt.Errorf("parse network access settings: %w", err)
	}
	normalized, err := normalizeAccessPolicy(store.value)
	if err != nil {
		return nil, fmt.Errorf("validate network access settings: %w", err)
	}
	store.value = normalized
	return store, nil
}

func normalizeAccessPolicy(policy NetworkAccessPolicy) (NetworkAccessPolicy, error) {
	if len(policy.AllowedHosts) > 100 || len(policy.AllowedIPs) > 100 {
		return policy, errors.New("too many access list entries")
	}
	hosts := make([]string, 0)
	seenHosts := make(map[string]bool)
	for _, entry := range policy.AllowedHosts {
		entry = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(entry), "."))
		if entry == "" {
			continue
		}
		if strings.ContainsAny(entry, "/:* \r\n\t") || strings.HasPrefix(entry, ".") || len(entry) > 253 {
			return policy, fmt.Errorf("invalid allowed host %q", entry)
		}
		for _, label := range strings.Split(entry, ".") {
			if label == "" || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
				return policy, fmt.Errorf("invalid allowed host %q", entry)
			}
			for _, c := range label {
				if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
					return policy, fmt.Errorf("invalid allowed host %q", entry)
				}
			}
		}
		if !seenHosts[entry] {
			hosts = append(hosts, entry)
			seenHosts[entry] = true
		}
	}
	ips := make([]string, 0)
	seenIPs := make(map[string]bool)
	for _, entry := range policy.AllowedIPs {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if prefix, err := netip.ParsePrefix(entry); err == nil {
			entry = prefix.Masked().String()
		} else if addr, err := netip.ParseAddr(entry); err == nil {
			entry = addr.Unmap().String()
		} else {
			return policy, fmt.Errorf("invalid IP address/CIDR %q", entry)
		}
		if !seenIPs[entry] {
			ips = append(ips, entry)
			seenIPs[entry] = true
		}
	}
	if policy.Enabled && len(hosts) == 0 && len(ips) == 0 {
		return policy, errors.New("enabled whitelist needs at least one host or IP")
	}
	policy.AllowedHosts = hosts
	policy.AllowedIPs = ips
	return policy, nil
}

func requestHost(r *http.Request) string {
	host := r.Host
	if name, _, err := net.SplitHostPort(host); err == nil {
		host = name
	}
	host = strings.Trim(host, "[]")
	return strings.ToLower(strings.TrimSuffix(host, "."))
}

func (policy NetworkAccessPolicy) allows(r *http.Request) bool {
	if !policy.Enabled {
		return true
	}
	if len(policy.AllowedHosts) > 0 {
		host := requestHost(r)
		found := false
		for _, allow := range policy.AllowedHosts {
			if host == allow {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	if len(policy.AllowedIPs) > 0 {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr
		}
		addr, err := netip.ParseAddr(host)
		if err != nil {
			return false
		}
		addr = addr.Unmap()
		found := false
		for _, allow := range policy.AllowedIPs {
			if prefix, err := netip.ParsePrefix(allow); err == nil {
				if prefix.Contains(addr) {
					found = true
					break
				}
			} else if candidate, err := netip.ParseAddr(allow); err == nil && candidate.Unmap() == addr {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func (s *networkAccessStore) get() NetworkAccessPolicy {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v := s.value
	v.AllowedHosts = append([]string{}, v.AllowedHosts...)
	v.AllowedIPs = append([]string{}, v.AllowedIPs...)
	return v
}

func (s *networkAccessStore) update(next NetworkAccessPolicy) error {
	normalized, err := normalizeAccessPolicy(next)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".network-access-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err = tmp.Chmod(0o600); err == nil {
		_, err = tmp.Write(append(data, '\n'))
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(tmpPath, s.path); err != nil {
		return err
	}
	s.value = normalized
	return nil
}

func (s *Server) networkAccessMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.networkAccess != nil && !s.networkAccess.get().allows(r) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) registerNetworkAccessAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/network-access", s.handleNetworkAccessGet)
	mux.HandleFunc("PUT /api/admin/network-access", s.handleNetworkAccessPut)
}

func (s *Server) handleNetworkAccessGet(w http.ResponseWriter, r *http.Request) {
	if !s.desktopUpdateAuthorized(w, r, false) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"policy": s.networkAccess.get()})
}

func (s *Server) handleNetworkAccessPut(w http.ResponseWriter, r *http.Request) {
	if !s.desktopUpdateAuthorized(w, r, true) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	var policy NetworkAccessPolicy
	if err := json.NewDecoder(r.Body).Decode(&policy); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_access_policy"})
		return
	}
	normalized, err := normalizeAccessPolicy(policy)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_access_policy", "detail": err.Error()})
		return
	}
	if !normalized.allows(r) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "current_connection_not_allowed", "detail": "add the current domain and client IP before enabling the whitelist"})
		return
	}
	if err := s.networkAccess.update(normalized); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "save_access_policy_failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"policy": s.networkAccess.get()})
}
