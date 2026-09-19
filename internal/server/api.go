package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/wanstu/know_me/internal/auth"
	"github.com/wanstu/know_me/internal/settings"
)

const (
	loginWindow      = 15 * time.Minute
	maxLoginFailures = 10
)

type loginFailure struct {
	Count        int
	FirstAt      time.Time
	BlockedUntil time.Time
}

type loginLimiter struct {
	mu      sync.Mutex
	entries map[string]loginFailure
}

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{entries: make(map[string]loginFailure)}
}

func (l *loginLimiter) check(key string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	entry, ok := l.entries[key]
	if !ok {
		return true, 0
	}
	if entry.BlockedUntil.After(now) {
		return false, time.Until(entry.BlockedUntil)
	}
	if now.Sub(entry.FirstAt) > loginWindow {
		delete(l.entries, key)
	}
	return true, 0
}

func (l *loginLimiter) failure(key string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	entry, ok := l.entries[key]
	if !ok || now.Sub(entry.FirstAt) > loginWindow {
		l.entries[key] = loginFailure{Count: 1, FirstAt: now}
		return
	}
	entry.Count++
	if entry.Count >= maxLoginFailures {
		entry.BlockedUntil = now.Add(loginWindow)
	}
	l.entries[key] = entry
}

func (l *loginLimiter) clear(key string) {
	l.mu.Lock()
	delete(l.entries, key)
	l.mu.Unlock()
}

func (s *Server) registerAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/version", s.handleVersion)
	mux.HandleFunc("GET /api/site", s.handleSiteGet)
	mux.HandleFunc("GET /api/auth/setup", s.handleAuthSetupGet)
	mux.HandleFunc("POST /api/auth/setup", s.handleAuthSetupPost)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/auth/me", s.handleMe)
	mux.HandleFunc("GET /api/settings", s.handleSettingsGet)
	mux.HandleFunc("PATCH /api/settings", s.handleSettingsPatch)
}

func (s *Server) handleSiteGet(w http.ResponseWriter, r *http.Request) {
	value, err := s.settings.GetSite(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "settings_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": value})
}

func (s *Server) handleAuthSetupGet(w http.ResponseWriter, r *http.Request) {
	hasUsers, err := s.auth.HasUsers(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth_setup_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"needsSetup": !hasUsers})
}

func (s *Server) handleAuthSetupPost(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	var body struct {
		Username    string `json:"username"`
		Password    string `json:"password"`
		DisplayName string `json:"displayName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}

	userID, created, err := s.auth.CreateInitialAdmin(r.Context(), body.Username, body.Password, body.DisplayName)
	if err != nil {
		code := err.Error()
		if code == "username_required" || code == "password_too_short" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": code})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth_setup_failed"})
		return
	}
	if !created {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "already_initialized"})
		return
	}

	session, err := s.auth.CreateSession(r.Context(), userID, r.UserAgent())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "session_failed"})
		return
	}
	s.setSessionCookie(w, r, session)
	user, _ := s.auth.UserForSession(r.Context(), session.Token)
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "user": user, "expiresAt": session.ExpiresAt.UnixMilli()})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}

	username, password, next, wantsJSON, err := parseLogin(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	key := clientKey(r, username)
	allowed, retry := s.loginLimiter.check(key, time.Now())
	if !allowed {
		if wantsJSON {
			w.Header().Set("Retry-After", fmt.Sprintf("%d", max(1, int(retry.Seconds()))))
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate_limited"})
			return
		}
		redirectLogin(w, r, next, "rate_limited")
		return
	}

	credentials, ok, err := s.auth.CredentialsByUsername(r.Context(), username)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth_failed"})
		return
	}
	if !ok || !auth.VerifyPassword(password, credentials.PasswordHash) {
		s.loginLimiter.failure(key, time.Now())
		if wantsJSON {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_credentials"})
			return
		}
		redirectLogin(w, r, next, "invalid_credentials")
		return
	}

	session, err := s.auth.CreateSession(r.Context(), credentials.UserID, r.UserAgent())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "session_failed"})
		return
	}
	s.loginLimiter.clear(key)
	s.setSessionCookie(w, r, session)
	if wantsJSON {
		user, _ := s.auth.UserForSession(r.Context(), session.Token)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "user": user, "expiresAt": session.ExpiresAt.UnixMilli()})
		return
	}
	http.Redirect(w, r, next, http.StatusSeeOther)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	if cookie, err := r.Cookie(auth.SessionCookie); err == nil {
		_ = s.auth.DeleteSession(r.Context(), cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name: auth.SessionCookie, Value: "", Path: "/", Expires: time.Unix(0, 0),
		HttpOnly: true, Secure: s.secureCookie(r), SameSite: http.SameSiteLaxMode,
	})
	if wantsJSON(r) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth_failed"})
		return
	}
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) handleSettingsGet(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth_failed"})
		return
	}
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	value, err := s.settings.GetSite(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "settings_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": value})
}

func (s *Server) handleSettingsPatch(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth_failed"})
		return
	}
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var patch settings.SitePatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_settings"})
		return
	}
	value, err := s.settings.UpdateSite(r.Context(), patch)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "settings_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "settings": value})
}

func (s *Server) currentUser(r *http.Request) (*auth.User, error) {
	cookie, err := r.Cookie(auth.SessionCookie)
	if err == http.ErrNoCookie {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.auth.UserForSession(r.Context(), cookie.Value)
}

func parseLogin(r *http.Request) (username, password, next string, jsonResponse bool, err error) {
	jsonResponse = wantsJSON(r)
	next = "/admin"
	if strings.Contains(r.Header.Get("Content-Type"), "application/json") {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
			Next     string `json:"next"`
		}
		if err = json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); err != nil {
			return "", "", next, true, err
		}
		return strings.TrimSpace(body.Username), body.Password, safeNext(body.Next), true, nil
	}
	if err = r.ParseForm(); err != nil {
		return "", "", next, false, err
	}
	return strings.TrimSpace(r.FormValue("username")), r.FormValue("password"), safeNext(r.FormValue("next")), false, nil
}

func safeNext(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") {
		return "/admin"
	}
	return value
}

func redirectLogin(w http.ResponseWriter, r *http.Request, next, code string) {
	target := "/login?error=" + url.QueryEscape(code) + "&next=" + url.QueryEscape(next)
	http.Redirect(w, r, target, http.StatusSeeOther)
}

func sameOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https") {
		scheme = "https"
	}
	return strings.EqualFold(parsed.Host, r.Host) && strings.EqualFold(parsed.Scheme, scheme)
}

func wantsJSON(r *http.Request) bool {
	return strings.Contains(r.Header.Get("Content-Type"), "application/json") ||
		strings.Contains(r.Header.Get("Accept"), "application/json")
}

func clientKey(r *http.Request, username string) string {
	ip := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0])
	if ip == "" {
		ip = strings.TrimSpace(r.Header.Get("X-Real-IP"))
	}
	if ip == "" {
		ip, _, _ = net.SplitHostPort(r.RemoteAddr)
	}
	if ip == "" {
		ip = "unknown"
	}
	return ip + "|" + strings.ToLower(strings.TrimSpace(username))
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request, session auth.Session) {
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookie,
		Value:    session.Token,
		Path:     "/",
		Expires:  session.ExpiresAt,
		HttpOnly: true,
		Secure:   s.secureCookie(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) secureCookie(r *http.Request) bool {
	return r.TLS != nil ||
		strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https") ||
		strings.HasPrefix(strings.ToLower(strings.TrimSpace(s.config.SiteURL)), "https://")
}
