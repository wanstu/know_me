package server

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wanstu/know_me/internal/blog"
	"github.com/wanstu/know_me/internal/mcpaccess"
	"github.com/wanstu/know_me/internal/navigation"
	"github.com/wanstu/know_me/internal/settings"
)

type mcpContextKey struct{}

func addMCPTool[In any](server *mcp.Server, name, description string, readOnly bool, handle func(context.Context, In) (any, error)) {
	mcp.AddTool(server, &mcp.Tool{Name: name, Description: description, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: readOnly}},
		func(ctx context.Context, _ *mcp.CallToolRequest, in In) (*mcp.CallToolResult, any, error) {
			token, ok := ctx.Value(mcpContextKey{}).(mcpaccess.Token)
			if !ok {
				return nil, nil, errors.New("unauthorized")
			}
			if !readOnly && token.Scope != "write" {
				return nil, nil, errors.New("write_permission_required")
			}
			out, err := handle(ctx, in)
			if err != nil {
				slog.Warn("know-me mcp tool failed", "tool", name, "token", token.ID, "error", err)
			} else {
				slog.Info("know-me mcp tool", "tool", name, "token", token.ID)
			}
			return nil, out, err
		})
}

func (s *Server) registerMCP(mux *http.ServeMux) {
	makeServer := func(write bool) *mcp.Server {
		m := mcp.NewServer(&mcp.Implementation{Name: "know-me", Title: "Know Me", Version: s.build.Version}, nil)
		registerMCPRead(m, s)
		if write {
			registerMCPWrite(m, s)
		}
		return m
	}
	readServer, writeServer := makeServer(false), makeServer(true)
	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		t, ok := r.Context().Value(mcpContextKey{}).(mcpaccess.Token)
		if !ok {
			return nil
		}
		if t.Scope == "write" {
			return writeServer
		}
		return readServer
	}, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true, MaxRequestBodyBytes: 4 << 20})
	mux.Handle("/mcp", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		// The MCP transport never accepts a browser session cookie as credentials.
		if !sameOrigin(r) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		header := strings.TrimSpace(r.Header.Get("Authorization"))
		if len(header) < 8 || !strings.EqualFold(header[:7], "Bearer ") {
			w.Header().Set("WWW-Authenticate", `Bearer realm="Know Me MCP"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		token, err := s.mcpTokens.Resolve(r.Context(), strings.TrimSpace(header[7:]))
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		handler.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), mcpContextKey{}, token)))
	}))
}

type mcpID struct {
	ID int64 `json:"id" jsonschema:"ID of an existing record"`
}
type mcpPostList struct {
	Query string `json:"query,omitempty" jsonschema:"Optional title or content filter"`
	Limit int    `json:"limit,omitempty" jsonschema:"Maximum results, defaults to 30 and capped at 100"`
}

func registerMCPRead(m *mcp.Server, s *Server) {
	addMCPTool(m, "posts_list", "List article summaries, including drafts; optional text query", true, func(ctx context.Context, in mcpPostList) (any, error) {
		posts, err := s.blog.ListAdmin(ctx)
		if err != nil {
			return nil, err
		}
		limit := in.Limit
		if limit < 1 || limit > 100 {
			limit = 30
		}
		query := strings.ToLower(strings.TrimSpace(in.Query))
		matches := make([]blog.Post, 0)
		for _, p := range posts {
			if query != "" && !strings.Contains(strings.ToLower(p.Title+" "+p.Excerpt+" "+p.ContentMD), query) {
				continue
			}
			p.ContentMD = ""
			matches = append(matches, p)
			if len(matches) >= limit {
				break
			}
		}
		return map[string]any{"posts": matches}, nil
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
	addMCPTool(m, "taxonomy_list", "List all categories and tags with IDs and article counts", true, func(ctx context.Context, _ struct{}) (any, error) {
		v, err := s.blog.ListTaxonomyDetails(ctx)
		if err != nil {
			return nil, err
		}
		return v, nil
	})
	addMCPTool(m, "site_get", "Read homepage, appearance, access policy and site settings", true, func(ctx context.Context, _ struct{}) (any, error) {
		v, err := s.settings.GetSite(ctx)
		return map[string]any{"settings": v}, err
	})
	addMCPTool(m, "start_get", "Read Start search engines and navigation tree", true, func(ctx context.Context, _ struct{}) (any, error) {
		v, err := s.settings.GetSite(ctx)
		if err != nil {
			return nil, err
		}
		tree, err := s.navigation.Tree(ctx, true)
		if err != nil {
			return nil, err
		}
		return map[string]any{"searchEngines": v.SearchEngines, "defaultSearchEngine": v.DefaultSearchEngine, "backgroundUrl": v.StartBackgroundURL, "density": v.StartDensity, "navigation": tree}, nil
	})
	addMCPTool(m, "navigation_tree", "Read all Start folders, groups and links (including private)", true, func(ctx context.Context, _ struct{}) (any, error) {
		return s.navigation.Tree(ctx, true)
	})
}

type mcpPostCreate struct {
	Title            string   `json:"title" jsonschema:"Article title"`
	ContentMD        string   `json:"contentMd" jsonschema:"Markdown body"`
	Slug             string   `json:"slug,omitempty"`
	Excerpt          string   `json:"excerpt,omitempty"`
	Status           string   `json:"status,omitempty" jsonschema:"draft (default), published or scheduled"`
	PublishedAt      *int64   `json:"publishedAt,omitempty" jsonschema:"Unix milliseconds"`
	FirstPublishedAt *int64   `json:"firstPublishedAt,omitempty" jsonschema:"Original publication Unix milliseconds"`
	Tags             []string `json:"tags,omitempty"`
	Categories       []string `json:"categories,omitempty"`
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
	ID          int64     `json:"id"`
	Title       *string   `json:"title,omitempty"`
	Slug        *string   `json:"slug,omitempty"`
	ContentMD   *string   `json:"contentMd,omitempty"`
	Excerpt     *string   `json:"excerpt,omitempty"`
	Status      *string   `json:"status,omitempty"`
	PublishedAt *int64    `json:"publishedAt,omitempty"`
	Tags        *[]string `json:"tags,omitempty"`
	Categories  *[]string `json:"categories,omitempty"`
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
		p, err := s.blog.Save(ctx, blog.SaveInput{Title: in.Title, Slug: in.Slug, ContentMD: in.ContentMD, Excerpt: in.Excerpt, Status: st, PublishedAt: in.PublishedAt, FirstPublishedAt: in.FirstPublishedAt, Tags: in.Tags, Categories: in.Categories}, nil)
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
		if in.PublishedAt != nil {
			p.PublishedAt = in.PublishedAt
		}
		if in.Tags != nil {
			p.Tags = *in.Tags
		}
		if in.Categories != nil {
			p.Categories = *in.Categories
		}
		updated, err := s.blog.Save(ctx, blog.SaveInput{Title: p.Title, Slug: p.Slug, ContentMD: p.ContentMD, Excerpt: p.Excerpt, Status: p.Status, Pinned: p.Pinned, SEOTitle: p.SEOTitle, SEODescription: p.SEODescription, PublishedAt: p.PublishedAt, FirstPublishedAt: p.FirstPublishedAt, Tags: p.Tags, Categories: p.Categories}, &in.ID)
		return map[string]any{"post": updated}, err
	})
	addMCPTool(m, "posts_delete", "Delete an article by ID (requires confirm=true)", false, func(ctx context.Context, in mcpDelete) (any, error) {
		if in.ID <= 0 || !in.Confirm {
			return nil, errors.New("explicit_confirmation_required")
		}
		if err := s.blog.Delete(ctx, in.ID); err != nil {
			return nil, err
		}
		return map[string]any{"deleted": in.ID}, nil
	})
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
		patch := settings.SitePatch{StartBackgroundURL: in.StartBackgroundURL, DefaultSearchEngine: in.DefaultSearchEngine, SearchEngines: in.SearchEngines, StartDensity: in.StartDensity, StartCardOpacity: in.StartCardOpacity, StartCardRadius: in.StartCardRadius, StartBackgroundDim: in.StartBackgroundDim}
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
