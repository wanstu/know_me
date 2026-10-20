package server

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wanstu/know_me/internal/blog"
	"github.com/wanstu/know_me/internal/mcpaccess"
	"github.com/wanstu/know_me/internal/navigation"
	"github.com/wanstu/know_me/internal/settings"
)

type mcpContextKey struct{}

var mcpToolPermissions sync.Map

func mcpRequiredPermission(name string, readOnly bool) string {
	domain := "mcp"
	switch {
	case strings.HasPrefix(name, "posts_"):
		domain = "posts"
	case strings.HasPrefix(name, "taxonomy_"):
		domain = "taxonomy"
	case strings.HasPrefix(name, "site_"):
		domain = "site"
	case strings.HasPrefix(name, "start_"):
		domain = "start"
	case strings.HasPrefix(name, "navigation_"):
		domain = "navigation"
	case strings.HasPrefix(name, "media_"):
		domain = "media"
	}
	access := "write"
	if readOnly {
		access = "read"
	}
	return domain + "." + access
}

func addMCPTool[In any](server *mcp.Server, name, description string, readOnly bool, handle func(context.Context, In) (any, error)) {
	permission := mcpRequiredPermission(name, readOnly)
	mcpToolPermissions.Store(name, permission)
	mcp.AddTool(server, &mcp.Tool{Name: name, Description: description, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: readOnly}},
		func(ctx context.Context, _ *mcp.CallToolRequest, in In) (*mcp.CallToolResult, any, error) {
			token, ok := ctx.Value(mcpContextKey{}).(mcpaccess.Token)
			if !ok {
				return nil, nil, errors.New("unauthorized")
			}
			if !token.HasPermission(permission) {
				mcpRecordTool(ctx, token, name, in, nil, nil, permission, true)
				return nil, nil, errors.New("permission_denied")
			}
			out, err := handle(ctx, in)
			mcpRecordTool(ctx, token, name, in, out, err, permission, false)
			if err != nil {
				slog.Warn("know-me mcp tool failed", "tool", name, "token", token.ID, "error", err)
			} else {
				slog.Info("know-me mcp tool", "tool", name, "token", token.ID)
			}
			return nil, out, err
		})
}

func (s *Server) registerMCP(mux *http.ServeMux) {
	var serverCache sync.Map
	makeServer := func(token mcpaccess.Token) *mcp.Server {
		m := mcp.NewServer(&mcp.Implementation{Name: "know-me", Title: "Know Me", Version: s.build.Version}, nil)
		registerMCPRead(m, s)
		registerMCPWrite(m, s)
		mcpToolPermissions.Range(func(key, value any) bool {
			name, okName := key.(string)
			permission, okPermission := value.(string)
			if okName && okPermission && !token.HasPermission(permission) {
				m.RemoveTools(name)
			}
			return true
		})
		return m
	}
	serverForToken := func(token mcpaccess.Token) *mcp.Server {
		key := token.PermissionKey()
		if cached, ok := serverCache.Load(key); ok {
			return cached.(*mcp.Server)
		}
		built := makeServer(token)
		actual, _ := serverCache.LoadOrStore(key, built)
		return actual.(*mcp.Server)
	}
	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		token, ok := r.Context().Value(mcpContextKey{}).(mcpaccess.Token)
		if !ok {
			return nil
		}
		return serverForToken(token)
	}, &mcp.StreamableHTTPOptions{
		Stateless:    true,
		JSONResponse: true,
		// Base64 expands a 10 MiB media upload to roughly 13.4 MiB. Keep the
		// transport bounded while allowing media_upload to match the Web media limit.
		MaxRequestBodyBytes: 16 << 20,
		// Know Me performs Bearer authentication and browser Origin checks before
		// dispatching to the SDK. Public deployments commonly reverse-proxy to a
		// loopback listener while preserving the public Host header, which the SDK's
		// generic localhost DNS-rebinding guard otherwise rejects with HTTP 403.
		DisableLocalhostProtection: true,
	})
	mux.Handle("/mcp", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		peer := mcpRemotePeer(r)
		reject := func(status int, reason string) {
			s.recordMCPEvent(mcpaccess.AuditEvent{
				EventType: "authentication", Result: "denied", Reason: reason,
				HTTPMethod: r.Method, RemotePeer: peer,
			})
			if status == http.StatusUnauthorized {
				if reason == "authorization_missing" || reason == "authorization_invalid_scheme" {
					w.Header().Set("WWW-Authenticate", `Bearer realm="Know Me MCP"`)
				}
				http.Error(w, "unauthorized", status)
			} else {
				http.Error(w, "forbidden", status)
			}
		}
		// Browser login cookies are never MCP credentials.
		if !sameOrigin(r) {
			reject(http.StatusForbidden, "origin_mismatch")
			return
		}
		header := strings.TrimSpace(r.Header.Get("Authorization"))
		if header == "" {
			reject(http.StatusUnauthorized, "authorization_missing")
			return
		}
		if len(header) < 8 || !strings.EqualFold(header[:7], "Bearer ") {
			reject(http.StatusUnauthorized, "authorization_invalid_scheme")
			return
		}
		token, err := s.mcpTokens.Resolve(r.Context(), strings.TrimSpace(header[7:]))
		if err != nil {
			reject(http.StatusUnauthorized, "token_invalid_or_revoked")
			return
		}
		s.recordMCPEvent(mcpaccess.AuditEvent{
			EventType: "authentication", Result: "success", Reason: "token_accepted",
			TokenID: token.ID, TokenName: token.Name, TokenScope: token.Scope,
			HTTPMethod: r.Method, RemotePeer: peer,
		})
		ctx := context.WithValue(r.Context(), mcpContextKey{}, token)
		ctx = context.WithValue(ctx, mcpAuditContextKey{}, mcpAuditContext{store: s.mcpAudit, remotePeer: peer})
		response := &mcpResponseRecorder{ResponseWriter: w}
		handler.ServeHTTP(response, r.WithContext(ctx))
		s.recordMCPResponse(token, r.Method, peer, response.Status())
	}))
}

type mcpID struct {
	ID int64 `json:"id" jsonschema:"ID of an existing record"`
}
type mcpPostList struct {
	Query         string `json:"query,omitempty" jsonschema:"Optional title or content search"`
	Status        string `json:"status,omitempty" jsonschema:"Optional draft, published, scheduled or all (default)"`
	Tag           string `json:"tag,omitempty" jsonschema:"Filter by a tag name"`
	Category      string `json:"category,omitempty" jsonschema:"Filter by a category name"`
	PublishedFrom *int64 `json:"publishedFrom,omitempty" jsonschema:"Inclusive publication date in Unix milliseconds"`
	PublishedTo   *int64 `json:"publishedTo,omitempty" jsonschema:"Inclusive publication date in Unix milliseconds"`
	Page          int    `json:"page,omitempty" jsonschema:"One-based page number, defaults to 1"`
	Limit         int    `json:"limit,omitempty" jsonschema:"Page size, defaults to 30 and capped at 100"`
}

func registerMCPRead(m *mcp.Server, s *Server) {
	addMCPTool(m, "posts_list", "Search and filter all posts (including drafts) by status, tag, category and publication dates; paginated summaries", true, func(ctx context.Context, in mcpPostList) (any, error) {
		if in.Status != "" && in.Status != "all" && in.Status != "draft" && in.Status != "published" && in.Status != "scheduled" {
			return nil, errors.New("invalid_status")
		}
		posts, err := s.blog.ListAdmin(ctx)
		if err != nil {
			return nil, err
		}
		limit := in.Limit
		if limit < 1 || limit > 100 {
			limit = 30
		}
		page := in.Page
		if page < 1 {
			page = 1
		}
		query, tag, category := strings.ToLower(strings.TrimSpace(in.Query)), strings.TrimSpace(in.Tag), strings.TrimSpace(in.Category)
		matches := make([]blog.Post, 0)
		for _, p := range posts {
			if query != "" && !strings.Contains(strings.ToLower(p.Title+" "+p.Excerpt+" "+p.ContentMD), query) {
				continue
			}
			if in.Status != "" && in.Status != "all" && string(p.Status) != in.Status {
				continue
			}
			if tag != "" && !containsMCPName(p.Tags, tag) {
				continue
			}
			if category != "" && !containsMCPName(p.Categories, category) {
				continue
			}
			if in.PublishedFrom != nil && (p.PublishedAt == nil || *p.PublishedAt < *in.PublishedFrom) {
				continue
			}
			if in.PublishedTo != nil && (p.PublishedAt == nil || *p.PublishedAt > *in.PublishedTo) {
				continue
			}
			p.ContentMD = ""
			matches = append(matches, p)
		}
		total := len(matches)
		if total == 0 || page-1 > (total-1)/limit {
			return map[string]any{"posts": []blog.Post{}, "total": total, "page": page, "pageSize": limit}, nil
		}
		start := (page - 1) * limit
		end := start + limit
		if end > total {
			end = total
		}
		return map[string]any{"posts": matches[start:end], "total": total, "page": page, "pageSize": limit}, nil
	})
	addMCPTool(m, "posts_get", "Read one article by ID with complete Markdown content", true, func(ctx context.Context, in mcpID) (any, error) {
		if in.ID <= 0 {
			return nil, errors.New("invalid_id")
		}
		p, err := s.blog.GetByID(ctx, in.ID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"post": p}, nil
	})
	registerMCPPostReadExtras(m, s)
	registerMCPImportRead(m, s)
	addMCPTool(m, "taxonomy_list", "List all categories and tags with IDs and article counts", true, func(ctx context.Context, _ struct{}) (any, error) {
		v, err := s.blog.ListTaxonomyDetails(ctx)
		if err != nil {
			return nil, err
		}
		return v, nil
	})
	addMCPTool(m, "site_get", "Read homepage, appearance, access policy and site settings; Start-specific fields require start.read", true, func(ctx context.Context, _ struct{}) (any, error) {
		v, err := s.settings.GetSite(ctx)
		if err != nil {
			return nil, err
		}
		body, err := json.Marshal(v)
		if err != nil {
			return nil, err
		}
		var site map[string]any
		if err := json.Unmarshal(body, &site); err != nil {
			return nil, err
		}
		token, _ := ctx.Value(mcpContextKey{}).(mcpaccess.Token)
		if !token.HasPermission(mcpaccess.PermissionStartRead) {
			for _, key := range []string{
				"startBackgroundUrl", "defaultSearchEngine", "searchEngines", "startDensity",
				"startCardOpacity", "startCardRadius", "startBackgroundDim",
				"startRememberLastTab", "startWheelSwitchTabs",
			} {
				delete(site, key)
			}
		}
		return map[string]any{"settings": site}, nil
	})
	addMCPTool(m, "start_get", "Read Start search engines and layout settings; includes navigation only when navigation.read is also granted", true, func(ctx context.Context, _ struct{}) (any, error) {
		v, err := s.settings.GetSite(ctx)
		if err != nil {
			return nil, err
		}
		result := map[string]any{
			"searchEngines": v.SearchEngines,
			"defaultSearchEngine": v.DefaultSearchEngine,
			"backgroundUrl": v.StartBackgroundURL,
			"density": v.StartDensity,
		}
		token, _ := ctx.Value(mcpContextKey{}).(mcpaccess.Token)
		if token.HasPermission(mcpaccess.PermissionNavigationRead) {
			tree, err := s.navigation.Tree(ctx, true)
			if err != nil {
				return nil, err
			}
			result["navigation"] = tree
		}
		return result, nil
	})
	addMCPTool(m, "navigation_tree", "Read all Start folders, groups and links (including private)", true, func(ctx context.Context, _ struct{}) (any, error) {
		return s.navigation.Tree(ctx, true)
	})
}

type mcpPostCreate struct {
	Title                string   `json:"title" jsonschema:"Article title"`
	ContentMD            string   `json:"contentMd" jsonschema:"Markdown body"`
	Slug                 string   `json:"slug,omitempty"`
	Excerpt              string   `json:"excerpt,omitempty"`
	Status               string   `json:"status,omitempty" jsonschema:"draft (default), published or scheduled"`
	Pinned               bool     `json:"pinned,omitempty"`
	SEOTitle             string   `json:"seoTitle,omitempty"`
	SEODescription       string   `json:"seoDescription,omitempty"`
	PublishedAt          *int64   `json:"publishedAt,omitempty" jsonschema:"Unix milliseconds"`
	PublishedAtDate      *string  `json:"publishedAtDate,omitempty" jsonschema:"Publication date as RFC3339 with timezone or YYYY-MM-DD (UTC)"`
	FirstPublishedAtDate *string  `json:"firstPublishedAtDate,omitempty" jsonschema:"Original publication date RFC3339 with timezone or YYYY-MM-DD (UTC)"`
	FirstPublishedAt     *int64   `json:"firstPublishedAt,omitempty" jsonschema:"Original publication Unix milliseconds"`
	Tags                 []string `json:"tags,omitempty"`
	Categories           []string `json:"categories,omitempty"`
}

func validPostStatus(value string) (blog.Status, error) {
	if value == "" || value == "draft" {
		return blog.StatusDraft, nil
	}
	if value == "published" {
		return blog.StatusPublished, nil
	}
	if value == "scheduled" {
		return blog.StatusScheduled, nil
	}
	return "", errors.New("invalid_status")
}

type mcpPostUpdate struct {
	ID                   int64     `json:"id"`
	Title                *string   `json:"title,omitempty"`
	Slug                 *string   `json:"slug,omitempty"`
	ContentMD            *string   `json:"contentMd,omitempty"`
	Excerpt              *string   `json:"excerpt,omitempty"`
	Status               *string   `json:"status,omitempty"`
	PublishedAt          *int64    `json:"publishedAt,omitempty" jsonschema:"Publication date in Unix milliseconds"`
	FirstPublishedAt     *int64    `json:"firstPublishedAt,omitempty" jsonschema:"Original publication date in Unix milliseconds"`
	PublishedAtDate      *string   `json:"publishedAtDate,omitempty" jsonschema:"RFC3339 with timezone or YYYY-MM-DD (UTC); alternative to publishedAt"`
	FirstPublishedAtDate *string   `json:"firstPublishedAtDate,omitempty" jsonschema:"RFC3339 with timezone or YYYY-MM-DD (UTC); alternative to firstPublishedAt"`
	Pinned               *bool     `json:"pinned,omitempty"`
	SEOTitle             *string   `json:"seoTitle,omitempty"`
	SEODescription       *string   `json:"seoDescription,omitempty"`
	ExpectedUpdatedAt    *int64    `json:"expectedUpdatedAt,omitempty" jsonschema:"Last seen updatedAt timestamp in Unix milliseconds; rejects stale edits"`
	Tags                 *[]string `json:"tags,omitempty" jsonschema:"Full replacement tag names; [] removes all tags"`
	Categories           *[]string `json:"categories,omitempty" jsonschema:"Full replacement category names; [] removes all categories"`
}
type mcpDelete struct {
	ID      int64 `json:"id"`
	Confirm bool  `json:"confirm" jsonschema:"Must be true to delete the record"`
}
type mcpTaxonomy struct {
	Action  string `json:"action" jsonschema:"create, rename, or delete"`
	Kind    string `json:"kind" jsonschema:"category or tag"`
	ID      int64  `json:"id,omitempty"`
	Name    string `json:"name,omitempty"`
	Confirm bool   `json:"confirm,omitempty"`
}
type mcpSitePatch struct {
	ProfileName        *string                                  `json:"profileName,omitempty"`
	ProfileTagline     *string                                  `json:"profileTagline,omitempty"`
	ProfileBio         *string                                  `json:"profileBio,omitempty"`
	AvatarURL          *string                                  `json:"avatarUrl,omitempty"`
	BrandIconURL       *string                                  `json:"brandIconUrl,omitempty"`
	HomeBackgroundURL  *string                                  `json:"homeBackgroundUrl,omitempty"`
	GitHubURL          *string                                  `json:"githubUrl,omitempty"`
	EmailURL           *string                                  `json:"emailUrl,omitempty"`
	AboutURL           *string                                  `json:"aboutUrl,omitempty"`
	FooterText         *string                                  `json:"footerText,omitempty"`
	QuoteEnabled       *bool                                    `json:"quoteEnabled,omitempty"`
	QuoteAuthorEnabled *bool                                    `json:"quoteAuthorEnabled,omitempty"`
	Quotes             *[]settings.QuoteEntry                   `json:"quotes,omitempty"`
	FriendLinks        *[]settings.FriendLink                   `json:"friendLinks,omitempty"`
	ShowFriendLinks    *bool                                    `json:"showFriendLinks,omitempty"`
	ShowICP            *bool                                    `json:"showIcp,omitempty"`
	ICPNumber          *string                                  `json:"icpNumber,omitempty"`
	ShowPolice         *bool                                    `json:"showPolice,omitempty"`
	PoliceNumber       *string                                  `json:"policeNumber,omitempty"`
	RouteAccess        *map[string]settings.HomeEntryVisibility `json:"routeAccess,omitempty" jsonschema:"Effective site page permissions; read site_get first"`
	ThemeMode          *settings.ThemeMode                      `json:"themeMode,omitempty"`
	ThemePreset        *settings.ThemePreset                    `json:"themePreset,omitempty"`
	ThemeStyle         *settings.ThemeStyle                     `json:"themeStyle,omitempty"`
	ThemeGradientPacks *[]string                                `json:"themeGradientPacks,omitempty"`
	HomeEntries        *[]settings.HomeEntry                    `json:"homeEntries,omitempty" jsonschema:"Full replacement list of homepage entry cards; read current settings first"`
	SocialLinks        *[]settings.SocialLink                   `json:"socialLinks,omitempty" jsonschema:"Full replacement list of homepage quick tags"`
	Projects           *[]settings.ProjectEntry                 `json:"projects,omitempty" jsonschema:"Full replacement list of project cards"`
}
type mcpStartPatch struct {
	StartBackgroundURL  *string                    `json:"startBackgroundUrl,omitempty"`
	DefaultSearchEngine *settings.SearchEngineName `json:"defaultSearchEngine,omitempty"`
	SearchEngines       *[]settings.SearchEngine   `json:"searchEngines,omitempty" jsonschema:"Full replacement list; read start_get first"`
	StartDensity        *settings.StartDensity     `json:"startDensity,omitempty"`
	StartCardOpacity    *int                       `json:"startCardOpacity,omitempty"`
	StartCardRadius     *int                       `json:"startCardRadius,omitempty"`
	StartBackgroundDim  *int                       `json:"startBackgroundDim,omitempty"`
	StartRememberTab    *bool                      `json:"startRememberLastTab,omitempty"`
	StartWheelTabs      *bool                      `json:"startWheelSwitchTabs,omitempty"`
}
type mcpNavigationGroup struct {
	Name       string `json:"name"`
	Icon       string `json:"icon,omitempty"`
	Visibility string `json:"visibility,omitempty" jsonschema:"public or private"`
}
type mcpNavigationItem struct {
	GroupID    int64  `json:"groupId"`
	ParentID   *int64 `json:"parentId,omitempty"`
	Name       string `json:"name"`
	URL        string `json:"url,omitempty"`
	Type       string `json:"type,omitempty" jsonschema:"link or folder"`
	IconURL    string `json:"iconUrl,omitempty"`
	Visibility string `json:"visibility,omitempty" jsonschema:"public or private"`
}

func navVisibility(v string) (navigation.Visibility, error) {
	if v == "" || v == "public" {
		return navigation.VisibilityPublic, nil
	}
	if v == "private" {
		return navigation.VisibilityPrivate, nil
	}
	return "", errors.New("invalid_visibility")
}
func registerMCPWrite(m *mcp.Server, s *Server) {
	addMCPTool(m, "posts_create", "Create a draft or published Markdown article; category and tag names auto-created as needed", false, func(ctx context.Context, in mcpPostCreate) (any, error) {
		st, err := validPostStatus(in.Status)
		if err != nil {
			return nil, err
		}
		publishedAt, err := resolveMCPDate(in.PublishedAt, in.PublishedAtDate)
		if err != nil {
			return nil, err
		}
		firstPublishedAt, err := resolveMCPDate(in.FirstPublishedAt, in.FirstPublishedAtDate)
		if err != nil {
			return nil, err
		}
		if err := validateMCPPostDates(st, publishedAt, firstPublishedAt); err != nil {
			return nil, err
		}
		p, err := s.blog.Save(ctx, blog.SaveInput{Title: in.Title, Slug: in.Slug, ContentMD: in.ContentMD, Excerpt: in.Excerpt, Status: st, PublishedAt: publishedAt, FirstPublishedAt: firstPublishedAt, Pinned: in.Pinned, SEOTitle: in.SEOTitle, SEODescription: in.SEODescription, Tags: in.Tags, Categories: in.Categories}, nil)
		return map[string]any{"post": p}, err
	})
	addMCPTool(m, "posts_update", "Partially update article by ID, preserving unspecified fields and revision history", false, func(ctx context.Context, in mcpPostUpdate) (any, error) {
		if in.ID <= 0 {
			return nil, errors.New("invalid_id")
		}
		p, err := s.blog.GetByID(ctx, in.ID)
		if err != nil {
			return nil, err
		}
		if in.ExpectedUpdatedAt != nil && p.UpdatedAt != *in.ExpectedUpdatedAt {
			return nil, errors.New("post_modified_since_read")
		}
		previousStatus := p.Status
		if in.Title != nil {
			p.Title = *in.Title
		}
		if in.Slug != nil {
			p.Slug = *in.Slug
		}
		if in.ContentMD != nil {
			p.ContentMD = *in.ContentMD
		}
		if in.Excerpt != nil {
			p.Excerpt = *in.Excerpt
		}
		if in.Status != nil {
			p.Status, err = validPostStatus(*in.Status)
			if err != nil {
				return nil, err
			}
		}
		publishedAt, err := resolveMCPDate(in.PublishedAt, in.PublishedAtDate)
		if err != nil {
			return nil, err
		}
		firstPublishedAt, err := resolveMCPDate(in.FirstPublishedAt, in.FirstPublishedAtDate)
		if err != nil {
			return nil, err
		}
		if publishedAt != nil && p.Status == blog.StatusDraft {
			return nil, errors.New("draft_cannot_have_publishedAt")
		}
		if publishedAt != nil {
			p.PublishedAt = publishedAt
		} else if in.Status != nil && p.Status == blog.StatusPublished && previousStatus != blog.StatusPublished {
			// Publishing a scheduled/draft article now must not retain a future date.
			now := time.Now().UnixMilli()
			p.PublishedAt = &now
		}
		if p.Status == blog.StatusDraft {
			p.PublishedAt = nil
		}
		if firstPublishedAt != nil {
			p.FirstPublishedAt = firstPublishedAt
		}
		if in.Pinned != nil {
			p.Pinned = *in.Pinned
		}
		if in.SEOTitle != nil {
			p.SEOTitle = *in.SEOTitle
		}
		if in.SEODescription != nil {
			p.SEODescription = *in.SEODescription
		}
		if err := validateMCPPostDates(p.Status, p.PublishedAt, p.FirstPublishedAt); err != nil {
			return nil, err
		}
		if in.Tags != nil {
			p.Tags = *in.Tags
		}
		if in.Categories != nil {
			p.Categories = *in.Categories
		}
		updated, err := s.blog.SaveIfUnchanged(ctx, blog.SaveInput{Title: p.Title, Slug: p.Slug, ContentMD: p.ContentMD, Excerpt: p.Excerpt, Status: p.Status, Pinned: p.Pinned, SEOTitle: p.SEOTitle, SEODescription: p.SEODescription, PublishedAt: p.PublishedAt, FirstPublishedAt: p.FirstPublishedAt, Tags: p.Tags, Categories: p.Categories}, in.ID, in.ExpectedUpdatedAt)
		return map[string]any{"post": updated}, err
	})
	addMCPTool(m, "posts_delete", "Delete an article by ID (requires confirm=true)", false, func(ctx context.Context, in mcpDelete) (any, error) {
		if in.ID <= 0 || !in.Confirm {
			return nil, errors.New("explicit_confirmation_required")
		}
		if _, err := s.blog.GetByID(ctx, in.ID); err != nil {
			return nil, err
		}
		if err := s.blog.Delete(ctx, in.ID); err != nil {
			return nil, err
		}
		return map[string]any{"deleted": in.ID}, nil
	})
	registerMCPPostWriteExtras(m, s)
	registerMCPImportWrite(m, s)
	registerMCPBatchTools(m, s)
	registerMCPMediaWrite(m, s)
	addMCPTool(m, "taxonomy_change", "Create, rename or delete one category/tag. Deletion requires confirm=true", false, func(ctx context.Context, in mcpTaxonomy) (any, error) {
		var kind blog.TaxonomyKind
		switch in.Kind {
		case "category":
			kind = blog.TaxonomyCategory
		case "tag":
			kind = blog.TaxonomyTag
		default:
			return nil, errors.New("invalid_kind")
		}
		switch in.Action {
		case "create":
			id, err := s.blog.CreateTaxonomy(ctx, kind, in.Name)
			return map[string]any{"id": id}, err
		case "rename":
			if in.ID <= 0 {
				return nil, errors.New("invalid_id")
			}
			err := s.blog.RenameTaxonomy(ctx, kind, in.ID, in.Name)
			return map[string]any{"ok": err == nil}, err
		case "delete":
			if in.ID <= 0 || !in.Confirm {
				return nil, errors.New("explicit_confirmation_required")
			}
			ok, err := s.blog.DeleteTaxonomy(ctx, kind, in.ID)
			return map[string]any{"deleted": ok}, err
		}
		return nil, errors.New("invalid_action")
	})
	addMCPTool(m, "site_update", "Patch appearance/profile/homepage entries, quick links and projects; omitted fields remain unchanged", false, func(ctx context.Context, in mcpSitePatch) (any, error) {
		patch := settings.SitePatch{ProfileName: in.ProfileName, ProfileTagline: in.ProfileTagline, ProfileBio: in.ProfileBio, AvatarURL: in.AvatarURL, BrandIconURL: in.BrandIconURL, HomeBackgroundURL: in.HomeBackgroundURL, GitHubURL: in.GitHubURL, EmailURL: in.EmailURL, AboutURL: in.AboutURL, FooterText: in.FooterText, QuoteEnabled: in.QuoteEnabled, QuoteAuthorEnabled: in.QuoteAuthorEnabled, Quotes: in.Quotes, FriendLinks: in.FriendLinks, ShowFriendLinks: in.ShowFriendLinks, ShowICP: in.ShowICP, ICPNumber: in.ICPNumber, ShowPolice: in.ShowPolice, PoliceNumber: in.PoliceNumber, RouteAccess: in.RouteAccess, ThemeMode: in.ThemeMode, ThemePreset: in.ThemePreset, ThemeStyle: in.ThemeStyle, ThemeGradientPacks: in.ThemeGradientPacks, HomeEntries: in.HomeEntries, SocialLinks: in.SocialLinks, Projects: in.Projects}
		v, err := s.settings.UpdateSite(ctx, patch)
		return map[string]any{"settings": v}, err
	})
	addMCPTool(m, "start_update", "Patch Start search engines and layout; omitted fields remain unchanged", false, func(ctx context.Context, in mcpStartPatch) (any, error) {
		patch := settings.SitePatch{StartBackgroundURL: in.StartBackgroundURL, DefaultSearchEngine: in.DefaultSearchEngine, SearchEngines: in.SearchEngines, StartDensity: in.StartDensity, StartCardOpacity: in.StartCardOpacity, StartCardRadius: in.StartCardRadius, StartBackgroundDim: in.StartBackgroundDim, StartRememberTab: in.StartRememberTab, StartWheelTabs: in.StartWheelTabs}
		v, err := s.settings.UpdateSite(ctx, patch)
		return map[string]any{"settings": v}, err
	})
	addMCPTool(m, "navigation_create_group", "Create a Start navigation group", false, func(ctx context.Context, in mcpNavigationGroup) (any, error) {
		vis, err := navVisibility(in.Visibility)
		if err != nil {
			return nil, err
		}
		id, err := s.navigation.CreateGroup(ctx, navigation.GroupInput{Name: in.Name, Icon: in.Icon, Visibility: vis})
		return map[string]any{"id": id}, err
	})
	registerMCPNavigationWrites(m, s)
	addMCPTool(m, "navigation_create_item", "Create Start navigation link or folder under an existing group", false, func(ctx context.Context, in mcpNavigationItem) (any, error) {
		if in.GroupID <= 0 {
			return nil, errors.New("invalid_group_id")
		}
		vis, err := navVisibility(in.Visibility)
		if err != nil {
			return nil, err
		}
		kind := navigation.ItemLink
		if in.Type == "folder" {
			kind = navigation.ItemFolder
		} else if in.Type != "" && in.Type != "link" {
			return nil, errors.New("invalid_type")
		}
		id, err := s.navigation.CreateItem(ctx, navigation.ItemInput{GroupID: in.GroupID, ParentID: in.ParentID, Name: in.Name, URL: in.URL, IconURL: in.IconURL, Type: kind, Visibility: vis, Size: navigation.Size1x1})
		return map[string]any{"id": id}, err
	})
}
