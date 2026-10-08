package server

import (
	"encoding/json"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
)

// Desktop browsers are launched by the native wrapper, not Wails JS:
// Wails' bindings disappear after the bootstrap navigates to the HTTP Core.
func (s *Server) registerDesktopBrowserAPI(mux *http.ServeMux) {
	if s.desktopBrowserOpen == nil {
		return
	}
	mux.HandleFunc("POST /api/desktop/open-external", s.handleDesktopBrowserOpen)
}

func safeDesktopBrowserURL(raw string) bool {
	if len(raw) > 4096 {
		return false
	}
	target, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && (target.Scheme == "https" || target.Scheme == "http") &&
		target.Hostname() != "" && target.User == nil && target.Opaque == ""
}

// The endpoint exists only in the desktop's loopback Core and requires the
// actual browser Origin and Host. Cross-site forms, DNS-rebinding hosts,
// missing Origin and content-type substitutions cannot open native windows.
func desktopBrowserOriginAllowed(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.Host)
	if err != nil {
		return false
	}
	addr, err := netip.ParseAddr(host)
	if err != nil || !addr.IsLoopback() || r.Header.Get("Origin") != "http://"+r.Host {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]), "application/json")
}

func (s *Server) handleDesktopBrowserOpen(w http.ResponseWriter, r *http.Request) {
	if !desktopBrowserOriginAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	var request struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || !safeDesktopBrowserURL(request.URL) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_external_url"})
		return
	}
	if err := s.desktopBrowserOpen(request.URL); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "open_external_browser_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
