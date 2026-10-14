package settings

import (
	"net/url"
	"strings"
)

// These routes are managed by one server-side authorization policy.
// Admin routes keep their own mandatory authentication independently.
const (
	RouteStart = "/start"
	RouteBlog  = "/blog"
	RouteRSS   = "/feed.xml"
)

func DefaultRouteAccess(startPublic bool) map[string]HomeEntryVisibility {
	start := HomeEntryAuthenticated
	if startPublic {
		start = HomeEntryAll
	}
	return map[string]HomeEntryVisibility{
		RouteStart: start,
		RouteBlog:  HomeEntryAll,
		RouteRSS:   HomeEntryAll,
	}
}

func ValidVisibility(v HomeEntryVisibility) bool {
	switch v {
	case HomeEntryAll, HomeEntryAuthenticated, HomeEntryGuest, HomeEntryDisabled:
		return true
	}
	return false
}

func NormalizeRouteAccess(in map[string]HomeEntryVisibility, legacyStartPublic bool) map[string]HomeEntryVisibility {
	result := DefaultRouteAccess(legacyStartPublic)
	for key, v := range in {
		if _, ok := result[key]; ok && ValidVisibility(v) {
			result[key] = v
		}
	}
	return result
}

func Allows(v HomeEntryVisibility, authenticated bool) bool {
	switch v {
	case HomeEntryAuthenticated:
		return authenticated
	case HomeEntryGuest:
		return !authenticated
	case HomeEntryDisabled:
		return false
	default:
		return true
	}
}

// ManagedRoute returns an exact builtin route for a site-local link;
// fragments and queries do not affect its access control.
func ManagedRoute(raw string) string {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host != "" || u.Scheme != "" {
		return ""
	}
	switch u.Path {
	case RouteStart:
		return RouteStart
	case RouteBlog:
		return RouteBlog
	case RouteRSS:
		return RouteRSS
	}
	if strings.HasPrefix(u.Path, RouteBlog+"/") {
		return RouteBlog
	}
	return ""
}

func AllowedLink(v SiteSettings, link string, visibility HomeEntryVisibility, authenticated bool) bool {
	if !Allows(visibility, authenticated) {
		return false
	}
	if strings.HasPrefix(link, "/admin") && (link == "/admin" || strings.HasPrefix(link, "/admin/")) {
		return authenticated
	}
	if route := ManagedRoute(link); route != "" {
		return Allows(v.RouteAccess[route], authenticated)
	}
	return true
}
