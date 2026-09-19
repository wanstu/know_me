package settings

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	kittheme "github.com/wanstu/wails-desktop-kit/theme"
)

type SearchEngineName string
type ThemeMode string
type ThemePreset string
type StartDensity string

const (
	SearchBing       SearchEngineName = "Bing"
	SearchGoogle     SearchEngineName = "Google"
	SearchDuckDuckGo SearchEngineName = "DuckDuckGo"

	ThemeAuto  ThemeMode = "auto"
	ThemeDark  ThemeMode = "dark"
	ThemeLight ThemeMode = "light"

	PresetAurora ThemePreset = "aurora"
	PresetOcean  ThemePreset = "ocean"
	PresetForest ThemePreset = "forest"
	PresetSunset ThemePreset = "sunset"

	DensityCompact     StartDensity = "compact"
	DensityComfortable StartDensity = "comfortable"
	DensitySpacious    StartDensity = "spacious"
)

type SocialLink struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	URL   string `json:"url"`
}

type HomeEntry struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	URL         string `json:"url"`
	NewTab      bool   `json:"newTab"`
}

type ProjectEntry struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	URL         string `json:"url"`
	Tag         string `json:"tag"`
}

type SiteSettings struct {
	ProfileName         string           `json:"profileName"`
	ProfileTagline      string           `json:"profileTagline"`
	ProfileBio          string           `json:"profileBio"`
	AvatarURL           string           `json:"avatarUrl"`
	Quote               string           `json:"quote"`
	QuoteAuthor         string           `json:"quoteAuthor"`
	GitHubURL           string           `json:"githubUrl"`
	EmailURL            string           `json:"emailUrl"`
	AboutURL            string           `json:"aboutUrl"`
	HomeBackgroundURL   string           `json:"homeBackgroundUrl"`
	StartBackgroundURL  string           `json:"startBackgroundUrl"`
	StartPublic         bool             `json:"startPublic"`
	DefaultSearchEngine SearchEngineName `json:"defaultSearchEngine"`
	ThemeMode           ThemeMode        `json:"themeMode"`
	ThemePreset         ThemePreset      `json:"themePreset"`
	StartDensity        StartDensity     `json:"startDensity"`
	StartCardOpacity    int              `json:"startCardOpacity"`
	StartCardRadius     int              `json:"startCardRadius"`
	StartBackgroundDim  int              `json:"startBackgroundDim"`
	SocialLinks         []SocialLink     `json:"socialLinks"`
	HomeEntries         []HomeEntry      `json:"homeEntries"`
	Projects            []ProjectEntry   `json:"projects"`
}

type SitePatch struct {
	ProfileName         *string           `json:"profileName"`
	ProfileTagline      *string           `json:"profileTagline"`
	ProfileBio          *string           `json:"profileBio"`
	AvatarURL           *string           `json:"avatarUrl"`
	Quote               *string           `json:"quote"`
	QuoteAuthor         *string           `json:"quoteAuthor"`
	GitHubURL           *string           `json:"githubUrl"`
	EmailURL            *string           `json:"emailUrl"`
	AboutURL            *string           `json:"aboutUrl"`
	HomeBackgroundURL   *string           `json:"homeBackgroundUrl"`
	StartBackgroundURL  *string           `json:"startBackgroundUrl"`
	StartPublic         *bool             `json:"startPublic"`
	DefaultSearchEngine *SearchEngineName `json:"defaultSearchEngine"`
	ThemeMode           *ThemeMode        `json:"themeMode"`
	ThemePreset         *ThemePreset      `json:"themePreset"`
	StartDensity        *StartDensity     `json:"startDensity"`
	StartCardOpacity    *int              `json:"startCardOpacity"`
	StartCardRadius     *int              `json:"startCardRadius"`
	StartBackgroundDim  *int              `json:"startBackgroundDim"`
	SocialLinks         *[]SocialLink     `json:"socialLinks"`
	HomeEntries         *[]HomeEntry      `json:"homeEntries"`
	Projects            *[]ProjectEntry   `json:"projects"`
}

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func Defaults() SiteSettings {
	return SiteSettings{
		ProfileName:         "know_me",
		ProfileTagline:      "记录、创造，也把每天真正会用的东西放在这里。",
		ProfileBio:          "一个属于自己的数字入口：主页、博客和浏览器起始页，不再分散在不同服务里。",
		Quote:               "生命如意志永存，青春永远年轻。",
		QuoteAuthor:         "今日短句",
		DefaultSearchEngine: SearchBing,
		ThemeMode:           ThemeAuto,
		ThemePreset:         PresetAurora,
		StartDensity:        DensityComfortable,
		StartCardOpacity:    64,
		StartCardRadius:     22,
		StartBackgroundDim:  62,
		SocialLinks:         []SocialLink{},
		HomeEntries: []HomeEntry{
			{ID: "blog", Name: "Blog", Description: "文章与笔记", URL: "/blog"},
			{ID: "start", Name: "Start", Description: "浏览器起始页", URL: "/start"},
			{ID: "projects", Name: "Projects", Description: "项目与作品", URL: "#projects"},
			{ID: "archive", Name: "Archive", Description: "文章归档", URL: "/blog#archive"},
			{ID: "about", Name: "About", Description: "关于我", URL: "#about"},
			{ID: "admin", Name: "Admin", Description: "管理后台", URL: "/admin"},
		},
		Projects: []ProjectEntry{},
	}
}

func (s *Store) GetSite(ctx context.Context) (SiteSettings, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, "SELECT value_json FROM settings WHERE key = 'site' LIMIT 1").Scan(&raw)
	if err == sql.ErrNoRows {
		return Defaults(), nil
	}
	if err != nil {
		return SiteSettings{}, err
	}

	value := Defaults()
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return Defaults(), nil
	}

	var keys map[string]json.RawMessage
	_ = json.Unmarshal([]byte(raw), &keys)
	if _, exists := keys["socialLinks"]; !exists {
		value.SocialLinks = legacySocialLinks(value)
	}
	return normalize(value), nil
}

func (s *Store) SetSite(ctx context.Context, value SiteSettings) (SiteSettings, error) {
	value = normalize(value)
	body, err := json.Marshal(value)
	if err != nil {
		return SiteSettings{}, err
	}
	_, err = s.db.ExecContext(ctx,
		"INSERT INTO settings (key, value_json, updated_at) VALUES ('site', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
		string(body), time.Now().UnixMilli(),
	)
	if err != nil {
		return SiteSettings{}, err
	}
	return value, nil
}

func (s *Store) UpdateSite(ctx context.Context, patch SitePatch) (SiteSettings, error) {
	current, err := s.GetSite(ctx)
	if err != nil {
		return SiteSettings{}, err
	}
	applyPatch(&current, patch)
	return s.SetSite(ctx, current)
}

func applyPatch(v *SiteSettings, p SitePatch) {
	if p.ProfileName != nil {
		v.ProfileName = *p.ProfileName
	}
	if p.ProfileTagline != nil {
		v.ProfileTagline = *p.ProfileTagline
	}
	if p.ProfileBio != nil {
		v.ProfileBio = *p.ProfileBio
	}
	if p.AvatarURL != nil {
		v.AvatarURL = *p.AvatarURL
	}
	if p.Quote != nil {
		v.Quote = *p.Quote
	}
	if p.QuoteAuthor != nil {
		v.QuoteAuthor = *p.QuoteAuthor
	}
	if p.GitHubURL != nil {
		v.GitHubURL = *p.GitHubURL
	}
	if p.EmailURL != nil {
		v.EmailURL = *p.EmailURL
	}
	if p.AboutURL != nil {
		v.AboutURL = *p.AboutURL
	}
	if p.HomeBackgroundURL != nil {
		v.HomeBackgroundURL = *p.HomeBackgroundURL
	}
	if p.StartBackgroundURL != nil {
		v.StartBackgroundURL = *p.StartBackgroundURL
	}
	if p.StartPublic != nil {
		v.StartPublic = *p.StartPublic
	}
	if p.DefaultSearchEngine != nil {
		v.DefaultSearchEngine = *p.DefaultSearchEngine
	}
	if p.ThemeMode != nil {
		v.ThemeMode = *p.ThemeMode
	}
	if p.ThemePreset != nil {
		v.ThemePreset = *p.ThemePreset
	}
	if p.StartDensity != nil {
		v.StartDensity = *p.StartDensity
	}
	if p.StartCardOpacity != nil {
		v.StartCardOpacity = *p.StartCardOpacity
	}
	if p.StartCardRadius != nil {
		v.StartCardRadius = *p.StartCardRadius
	}
	if p.StartBackgroundDim != nil {
		v.StartBackgroundDim = *p.StartBackgroundDim
	}
	if p.SocialLinks != nil {
		v.SocialLinks = *p.SocialLinks
	}
	if p.HomeEntries != nil {
		v.HomeEntries = *p.HomeEntries
	}
	if p.Projects != nil {
		v.Projects = *p.Projects
	}
}

func normalize(v SiteSettings) SiteSettings {
	v.ProfileName = trim(v.ProfileName, 100)
	v.ProfileTagline = trim(v.ProfileTagline, 240)
	v.ProfileBio = trim(v.ProfileBio, 1000)
	v.AvatarURL = trim(v.AvatarURL, 1000)
	v.Quote = trim(v.Quote, 500)
	v.QuoteAuthor = trim(v.QuoteAuthor, 100)
	v.GitHubURL = trim(v.GitHubURL, 1000)
	v.EmailURL = trim(v.EmailURL, 1000)
	v.AboutURL = trim(v.AboutURL, 1000)
	v.HomeBackgroundURL = trim(v.HomeBackgroundURL, 1000)
	v.StartBackgroundURL = trim(v.StartBackgroundURL, 1000)

	switch v.DefaultSearchEngine {
	case SearchGoogle, SearchDuckDuckGo, SearchBing:
	default:
		v.DefaultSearchEngine = SearchBing
	}
	switch v.ThemeMode {
	case ThemeAuto, ThemeDark, ThemeLight:
	default:
		v.ThemeMode = ThemeAuto
	}
	if err := kittheme.ValidatePackName(string(v.ThemePreset)); err != nil {
		v.ThemePreset = PresetAurora
	}
	switch v.StartDensity {
	case DensityCompact, DensityComfortable, DensitySpacious:
	default:
		v.StartDensity = DensityComfortable
	}
	v.StartCardOpacity = clamp(v.StartCardOpacity, 30, 95)
	v.StartCardRadius = clamp(v.StartCardRadius, 12, 32)
	v.StartBackgroundDim = clamp(v.StartBackgroundDim, 0, 90)
	v.SocialLinks = normalizeSocial(v.SocialLinks)
	v.HomeEntries = normalizeHome(v.HomeEntries)
	v.Projects = normalizeProjects(v.Projects)
	return v
}

func normalizeSocial(values []SocialLink) []SocialLink {
	if values == nil {
		return []SocialLink{}
	}
	if len(values) > 20 {
		values = values[:20]
	}
	out := make([]SocialLink, 0, len(values))
	for i, item := range values {
		item.ID = trim(item.ID, 80)
		if item.ID == "" {
			item.ID = fmt.Sprintf("social-%d", i)
		}
		item.Label = trim(item.Label, 80)
		item.URL = trim(item.URL, 1000)
		if item.Label != "" && item.URL != "" {
			out = append(out, item)
		}
	}
	return out
}

func normalizeHome(values []HomeEntry) []HomeEntry {
	if values == nil {
		return []HomeEntry{}
	}
	if len(values) > 24 {
		values = values[:24]
	}
	out := make([]HomeEntry, 0, len(values))
	for i, item := range values {
		item.ID = trim(item.ID, 80)
		if item.ID == "" {
			item.ID = fmt.Sprintf("entry-%d", i)
		}
		item.Name = trim(item.Name, 80)
		item.Description = trim(item.Description, 160)
		item.URL = trim(item.URL, 1000)
		if item.Name != "" && item.URL != "" {
			out = append(out, item)
		}
	}
	return out
}

func normalizeProjects(values []ProjectEntry) []ProjectEntry {
	if values == nil {
		return []ProjectEntry{}
	}
	if len(values) > 24 {
		values = values[:24]
	}
	out := make([]ProjectEntry, 0, len(values))
	for i, item := range values {
		item.ID = trim(item.ID, 80)
		if item.ID == "" {
			item.ID = fmt.Sprintf("project-%d", i)
		}
		item.Name = trim(item.Name, 100)
		item.Description = trim(item.Description, 300)
		item.URL = trim(item.URL, 1000)
		item.Tag = trim(item.Tag, 80)
		if item.Name != "" {
			out = append(out, item)
		}
	}
	return out
}

func legacySocialLinks(v SiteSettings) []SocialLink {
	var out []SocialLink
	if strings.TrimSpace(v.GitHubURL) != "" {
		out = append(out, SocialLink{ID: "github", Label: "GitHub", URL: v.GitHubURL})
	}
	if strings.TrimSpace(v.EmailURL) != "" {
		out = append(out, SocialLink{ID: "mail", Label: "Mail", URL: v.EmailURL})
	}
	if strings.TrimSpace(v.AboutURL) != "" {
		out = append(out, SocialLink{ID: "about", Label: "About", URL: v.AboutURL})
	}
	return out
}

func clamp(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func trim(value string, max int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > max {
		runes = runes[:max]
	}
	return string(runes)
}
