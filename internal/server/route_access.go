package server

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/wanstu/know_me/internal/settings"
)

// routePolicyForRequest classifies browser routes AND their public read APIs.
// Unknown and external destinations are not manageable page routes.
func routePolicyForRequest(path string) string {
	switch {
	case path == settings.RouteStart, strings.HasPrefix(path, settings.RouteStart+"/"),
		path == "/api/navigation/public":
		return settings.RouteStart
	case path == settings.RouteBlog, strings.HasPrefix(path, settings.RouteBlog+"/"),
		path == "/api/blog", strings.HasPrefix(path, "/api/blog/"):
		return settings.RouteBlog
	case path == settings.RouteRSS:
		return settings.RouteRSS
	default:
		return ""
	}
}

func adminRoute(path string) bool {
	return path == "/admin" || strings.HasPrefix(path, "/admin/")
}

func (s *Server) routeAccessMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if !adminRoute(path) && routePolicyForRequest(path) == "" {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Add("Vary", "Cookie")
		user, err := s.currentUser(r)
		if err != nil {
			http.Error(w, "auth_failed", http.StatusInternalServerError)
			return
		}
		authenticated := user != nil
		policy := settings.HomeEntryAll
		if adminRoute(path) {
			policy = settings.HomeEntryAuthenticated // Cannot be changed by homepage links.
		} else {
			site, err := s.settings.GetSite(r.Context())
			if err != nil {
				http.Error(w, "settings_failed", http.StatusInternalServerError)
				return
			}
			key := routePolicyForRequest(path)
			policy = site.RouteAccess[key]
			// RSS must satisfy both policies. Keep its own denial (e.g. 404
			// when disabled) instead of accidentally replacing it with a redirect.
			if key == settings.RouteRSS && settings.Allows(policy, authenticated) &&
				!settings.Allows(site.RouteAccess[settings.RouteBlog], authenticated) {
				policy = site.RouteAccess[settings.RouteBlog]
			}
		}
		if settings.Allows(policy, authenticated) {
			next.ServeHTTP(w, r)
			return
		}
		if policy == settings.HomeEntryDisabled {
			http.NotFound(w, r)
			return
		}
		if policy == settings.HomeEntryAuthenticated && !authenticated {
			if strings.HasPrefix(path, "/api/") {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}
			nextURL := path
			if r.URL.RawQuery != "" {
				nextURL += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, "/login?next="+url.QueryEscape(nextURL), http.StatusSeeOther)
			return
		}
		if strings.HasPrefix(path, "/api/") {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		} else {
			http.Error(w, "forbidden", http.StatusForbidden)
		}
	})
}
