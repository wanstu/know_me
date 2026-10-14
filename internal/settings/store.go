package settings

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	kittheme "github.com/wanstu/wails-desktop-kit/theme"
)

type SearchEngineName string
type ThemeMode string
type ThemePreset string
type ThemeStyle string
type StartDensity string

const (
	SearchBing       SearchEngineName = "Bing"
	SearchGoogle     SearchEngineName = "Google"
	SearchDuckDuckGo SearchEngineName = "DuckDuckGo"

	ThemeAuto  ThemeMode = "auto"
	ThemeDark  ThemeMode = "dark"
	ThemeLight ThemeMode = "light"

	StyleSolid    ThemeStyle = "solid"
	StyleGradient ThemeStyle = "gradient"

	PresetAurora ThemePreset = "aurora"
	PresetOcean  ThemePreset = "ocean"
	PresetForest ThemePreset = "forest"
	PresetSunset ThemePreset = "sunset"

	DensityCompact     StartDensity = "compact"
	DensityComfortable StartDensity = "comfortable"
	DensitySpacious    StartDensity = "spacious"
)

type HomeEntryVisibility string

const (
	HomeEntryAll           HomeEntryVisibility = "all"
	HomeEntryAuthenticated HomeEntryVisibility = "authenticated"
	HomeEntryGuest         HomeEntryVisibility = "guest"
	HomeEntryDisabled      HomeEntryVisibility = "disabled"
)

type SearchEngine struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	URL     string `json:"url"`
	IconURL string `json:"iconUrl"`
}

func DefaultSearchEngines() []SearchEngine {
	return []SearchEngine{
		{ID: "Bing", Name: "Bing", URL: "https://www.bing.com/search?q={query}", IconURL: "https://www.bing.com/favicon.ico"},
		{ID: "Google", Name: "Google", URL: "https://www.google.com/search?q={query}", IconURL: "https://www.google.com/favicon.ico"},
		{ID: "DuckDuckGo", Name: "DuckDuckGo", URL: "https://duckduckgo.com/?q={query}", IconURL: "https://duckduckgo.com/favicon.ico"},
		{ID: "Baidu", Name: "百度", URL: "https://www.baidu.com/s?wd={query}", IconURL: "https://www.baidu.com/favicon.ico"},
		{ID: "Sogou", Name: "搜狗", URL: "https://www.sogou.com/web?query={query}", IconURL: "https://www.sogou.com/favicon.ico"},
	}
}

type SocialLink struct {
	ID         string              `json:"id"`
	Label      string              `json:"label"`
	URL        string              `json:"url"`
	Disabled   bool                `json:"disabled"` // Legacy display flag; visibility is canonical.
	Visibility HomeEntryVisibility `json:"visibility,omitempty"`
}

// Built-in homepage tags were hardcoded before this version. Move them into
// editable site settings exactly once; never recreate intentionally deleted tags.
const homeTagsVersion = 1

func migratedHomeTags(links []SocialLink) []SocialLink {
	for _, candidate := range []SocialLink{
		{ID: "home-blog", Label: "Blog", URL: "/blog"},
		{ID: "home-rss", Label: "RSS", URL: "/feed.xml"},
	} {
		found := false
		for _, link := range links {
			if strings.EqualFold(link.Label, candidate.Label) ||
				strings.EqualFold(link.URL, candidate.URL) {
				found = true
				break
			}
		}
		if !found {
			links = append(links, candidate)
		}
	}
	return links
}

type QuoteEntry struct {
	ID      string `json:"id"`
	Text    string `json:"text"`
	Author  string `json:"author"`
	Enabled bool   `json:"enabled"`
}

var builtInQuoteTexts = []string{
	"把常用的东西放近一点，把重要的事情做深一点。",
	"先让今天变得清楚，再考虑更远的答案。",
	"记录不是为了占满时间，而是为了留下路径。",
	"好工具应该安静地工作，把注意力还给人。",
	"慢一点整理，也比反复寻找更省时间。",
	"把复杂留给系统，把简单留给使用的人。",
	"持续做小而正确的改进，结果会自己累积。",
	"真正顺手的工作流，不需要每天重新学习。",
	"今天写下的一点东西，也许会帮到未来的自己。",
	"页面可以很轻，内容应该足够真。",
	"不是所有信息都值得保存，但值得保存的要容易找到。",
	"把入口统一之后，注意力就少了一次切换。",
	"清晨不必急着回答世界，先听听自己的脚步。",
	"把今天走稳，明天自然会有新的路口。",
	"真正的自由，是能为自己的时间做决定。",
	"有些答案藏在出发之后，而不是计划之中。",
	"把注意力给眼前的事，也是一种勇气。",
	"日子不必每天闪光，持续发亮就很好。",
	"认真生活的人，总能发现细小的惊喜。",
	"给生活留一点空白，好让新念头住进来。",
	"向前不一定要跑，方向清楚就不算慢。",
	"当你开始记录，平凡也有了清晰的轮廓。",
	"好奇心是一扇门，推开就能看见新风景。",
	"别让待办事项遮住窗外的天空。",
	"成长常常没有声音，回头时却能看见距离。",
	"放下无谓的比较，才能听见自己的节奏。",
	"今天完成的一小步，也在改变未来的路线。",
	"一件事值得做，就值得耐心打磨。",
	"把问题说清楚，解决办法就已经出现一半。",
	"思考可以很深，行动可以很轻。",
	"知识不是收藏品，用起来才会长出价值。",
	"先做好最重要的一件事，再让其余事情排队。",
	"真正可靠的工具，不会抢走人的注意力。",
	"清晰比复杂难得，简单比热闹长久。",
	"整理一次思路，胜过反复寻找出口。",
	"少一点重复操作，多一点自由探索。",
	"与其追逐所有消息，不如守住自己的问题。",
	"做过的事留下痕迹，走过的路便能辨认。",
	"世界很大，先从眼前这扇窗看起。",
	"读过的书会沉淀，走过的路会回答。",
	"新的风景常常从一条陌生的小路开始。",
	"不必等待完美天气，也可以为远方做准备。",
	"把地图打开，是对未知最温柔的邀请。",
	"远方值得期待，身边也值得留意。",
	"在熟悉的城市里，也能找到初见的惊喜。",
	"每一次转弯，都可能遇见不同的光。",
	"风从哪里吹来，就从哪里开始观察。",
	"愿你既敢奔向远方，也懂得安放日常。",
	"生活不是竞赛，沿途的发现同样重要。",
	"让好奇带路，让判断决定方向。",
	"雨天适合整理心事，晴天适合走出房间。",
	"把复杂的一天拆开，先照顾好这一刻。",
	"休息不是空白，它也是生活的一部分。",
	"不必把每一天都写成成绩单。",
	"在喧闹之外，为自己保留一段安静。",
	"有时候，关掉一个窗口才能看清整个世界。",
	"愿每次停留都有意义，每次出发都不匆忙。",
	"不要急着填满日程，留点时间给意外的美好。",
	"专注像光，落在哪里，哪里就慢慢清晰。",
	"把热爱藏进细节，作品会替你说话。",
	"一个想法被认真对待，就有机会成为作品。",
	"先动手做出雏形，再慢慢靠近理想。",
	"好的设计懂得退后，把位置留给内容。",
	"不为复杂而复杂，恰好够用就是本领。",
	"稳定和优雅并不矛盾，它们可以一起生长。",
	"让过程可理解，成果才更值得信任。",
	"敢于修正昨天，是今天的一种进步。",
	"慢慢积累的东西，往往更经得起时间。",
	"不要因为起点普通，就怀疑沿途的可能。",
	"即使没有掌声，也可以认真完成今天。",
	"热情让人开始，习惯帮助人走得更远。",
	"愿你对世界保持兴趣，也对自己保持耐心。",
}

// LegacyQuoteEntries preserves the formerly single configurable quote and also
// exposes the existing built-in short sentences for independent editing.
func LegacyQuoteEntries(legacyText, legacyAuthor string) []QuoteEntry {
	out := make([]QuoteEntry, 0, len(builtInQuoteTexts)+1)
	text := trim(legacyText, 500)
	if text != "" {
		out = append(out, QuoteEntry{ID: "legacy", Text: text, Author: trim(legacyAuthor, 100), Enabled: true})
	}
	for i, text := range builtInQuoteTexts {
		if text == trim(legacyText, 500) {
			continue
		}
		out = append(out, QuoteEntry{ID: fmt.Sprintf("built-in-%d", i+1), Text: text, Enabled: true})
	}
	return out
}

// The version is saved with site settings to seed additions once without
// restoring older quotes deliberately disabled, edited or deleted by an admin.
const quoteCatalogVersion = 2
const previousBuiltinQuoteCount = 12

func appendNewBuiltinQuotes(current []QuoteEntry) []QuoteEntry {
	if len(current) == 0 {
		return current
	}
	// Respect an administrator who has explicitly disabled the entire collection.
	anyEnabled := false
	for _, item := range current {
		if item.Enabled {
			anyEnabled = true
			break
		}
	}
	if !anyEnabled {
		return current
	}
	known := make(map[string]bool, len(current))
	for _, item := range current {
		known[item.ID] = true
	}
	for i := previousBuiltinQuoteCount; i < len(builtInQuoteTexts); i++ {
		id := fmt.Sprintf("built-in-%d", i+1)
		if known[id] {
			continue
		}
		current = append(current, QuoteEntry{ID: id, Text: builtInQuoteTexts[i], Enabled: true})
	}
	return current
}

type HomeEntry struct {
	ID          string              `json:"id"`
	Name        string              `json:"name"`
	Description string              `json:"description"`
	URL         string              `json:"url"`
	NewTab      bool                `json:"newTab"`
	Visibility  HomeEntryVisibility `json:"visibility"`
}

type ProjectEntry struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	URL         string `json:"url"`
	Tag         string `json:"tag"`
}

type FriendLink struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	URL     string `json:"url"`
	Visible bool   `json:"visible"`
}

type SiteSettings struct {
	ProfileName         string                         `json:"profileName"`
	ProfileTagline      string                         `json:"profileTagline"`
	ProfileBio          string                         `json:"profileBio"`
	AvatarURL           string                         `json:"avatarUrl"`
	BrandIconURL        string                         `json:"brandIconUrl"`
	Quote               string                         `json:"quote"`
	QuoteAuthor         string                         `json:"quoteAuthor"`
	QuoteEnabled        bool                           `json:"quoteEnabled"`
	QuoteAuthorEnabled  bool                           `json:"quoteAuthorEnabled"`
	Quotes              []QuoteEntry                   `json:"quotes"`
	QuoteCatalogVersion int                            `json:"quoteCatalogVersion"`
	GitHubURL           string                         `json:"githubUrl"`
	EmailURL            string                         `json:"emailUrl"`
	AboutURL            string                         `json:"aboutUrl"`
	HomeBackgroundURL   string                         `json:"homeBackgroundUrl"`
	StartBackgroundURL  string                         `json:"startBackgroundUrl"`
	StartPublic         bool                           `json:"startPublic"` // Legacy compatibility; routeAccess is authoritative.
	RouteAccess         map[string]HomeEntryVisibility `json:"routeAccess"`
	DefaultSearchEngine SearchEngineName               `json:"defaultSearchEngine"`
	SearchEngines       []SearchEngine                 `json:"searchEngines"`
	ThemeMode           ThemeMode                      `json:"themeMode"`
	ThemePreset         ThemePreset                    `json:"themePreset"`
	ThemeStyle          ThemeStyle                     `json:"themeStyle"`
	ThemeGradientPacks  []string                       `json:"themeGradientPacks"`
	StartDensity        StartDensity                   `json:"startDensity"`
	StartCardOpacity    int                            `json:"startCardOpacity"`
	StartCardRadius     int                            `json:"startCardRadius"`
	StartBackgroundDim  int                            `json:"startBackgroundDim"`
	SocialLinks         []SocialLink                   `json:"socialLinks"`
	HomeTagsVersion     int                            `json:"homeTagsVersion"`
	HomeEntries         []HomeEntry                    `json:"homeEntries"`
	Projects            []ProjectEntry                 `json:"projects"`
	ShowICP             bool                           `json:"showIcp"`
	ICPNumber           string                         `json:"icpNumber"`
	ICPURL              string                         `json:"icpUrl"`
	ShowPolice          bool                           `json:"showPolice"`
	PoliceNumber        string                         `json:"policeNumber"`
	PoliceURL           string                         `json:"policeUrl"`
	FooterText          string                         `json:"footerText"`
	ShowFriendLinks     bool                           `json:"showFriendLinks"`
	FriendLinks         []FriendLink                   `json:"friendLinks"`
}

type SitePatch struct {
	ProfileName         *string                         `json:"profileName"`
	ProfileTagline      *string                         `json:"profileTagline"`
	ProfileBio          *string                         `json:"profileBio"`
	AvatarURL           *string                         `json:"avatarUrl"`
	BrandIconURL        *string                         `json:"brandIconUrl"`
	Quote               *string                         `json:"quote"`
	QuoteAuthor         *string                         `json:"quoteAuthor"`
	QuoteEnabled        *bool                           `json:"quoteEnabled"`
	QuoteAuthorEnabled  *bool                           `json:"quoteAuthorEnabled"`
	Quotes              *[]QuoteEntry                   `json:"quotes"`
	GitHubURL           *string                         `json:"githubUrl"`
	EmailURL            *string                         `json:"emailUrl"`
	AboutURL            *string                         `json:"aboutUrl"`
	HomeBackgroundURL   *string                         `json:"homeBackgroundUrl"`
	StartBackgroundURL  *string                         `json:"startBackgroundUrl"`
	StartPublic         *bool                           `json:"startPublic"`
	RouteAccess         *map[string]HomeEntryVisibility `json:"routeAccess"`
	DefaultSearchEngine *SearchEngineName               `json:"defaultSearchEngine"`
	SearchEngines       *[]SearchEngine                 `json:"searchEngines"`
	ThemeMode           *ThemeMode                      `json:"themeMode"`
	ThemePreset         *ThemePreset                    `json:"themePreset"`
	ThemeStyle          *ThemeStyle                     `json:"themeStyle"`
	ThemeGradientPacks  *[]string                       `json:"themeGradientPacks"`
	StartDensity        *StartDensity                   `json:"startDensity"`
	StartCardOpacity    *int                            `json:"startCardOpacity"`
	StartCardRadius     *int                            `json:"startCardRadius"`
	StartBackgroundDim  *int                            `json:"startBackgroundDim"`
	SocialLinks         *[]SocialLink                   `json:"socialLinks"`
	HomeEntries         *[]HomeEntry                    `json:"homeEntries"`
	Projects            *[]ProjectEntry                 `json:"projects"`
	ShowICP             *bool                           `json:"showIcp"`
	ICPNumber           *string                         `json:"icpNumber"`
	ICPURL              *string                         `json:"icpUrl"`
	ShowPolice          *bool                           `json:"showPolice"`
	PoliceNumber        *string                         `json:"policeNumber"`
	PoliceURL           *string                         `json:"policeUrl"`
	FooterText          *string                         `json:"footerText"`
	ShowFriendLinks     *bool                           `json:"showFriendLinks"`
	FriendLinks         *[]FriendLink                   `json:"friendLinks"`
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
		QuoteEnabled:        true,
		QuoteAuthorEnabled:  true,
		Quotes:              LegacyQuoteEntries("生命如意志永存，青春永远年轻。", "今日短句"),
		QuoteCatalogVersion: quoteCatalogVersion,
		DefaultSearchEngine: SearchBing,
		SearchEngines:       DefaultSearchEngines(),
		ThemeMode:           ThemeAuto,
		ThemePreset:         PresetAurora,
		ThemeStyle:          StyleSolid,
		ThemeGradientPacks:  []string{"aurora", "ocean"},
		StartDensity:        DensityComfortable,
		StartCardOpacity:    64,
		StartCardRadius:     22,
		StartBackgroundDim:  62,
		SocialLinks:         migratedHomeTags([]SocialLink{}),
		HomeTagsVersion:     homeTagsVersion,
		HomeEntries: []HomeEntry{
			{ID: "blog", Name: "Blog", Description: "文章与笔记", URL: "/blog"},
			{ID: "start", Name: "Start", Description: "浏览器起始页", URL: "/start"},
			{ID: "projects", Name: "Projects", Description: "项目与作品", URL: "#projects"},
			{ID: "archive", Name: "Archive", Description: "文章归档", URL: "/blog#archive"},
			{ID: "about", Name: "About", Description: "关于我", URL: "#about"},
			{ID: "admin", Name: "Admin", Description: "管理后台", URL: "/admin"},
		},
		Projects:    []ProjectEntry{},
		FriendLinks: []FriendLink{},
	}
}

func (s *Store) GetSite(ctx context.Context) (SiteSettings, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, "SELECT value_json FROM settings WHERE key = 'site' LIMIT 1").Scan(&raw)
	if err == sql.ErrNoRows {
		return normalize(Defaults()), nil
	}
	if err != nil {
		return SiteSettings{}, err
	}

	value := Defaults()
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return normalize(Defaults()), nil
	}

	var keys map[string]json.RawMessage
	_ = json.Unmarshal([]byte(raw), &keys)
	if _, exists := keys["socialLinks"]; !exists {
		value.SocialLinks = legacySocialLinks(value)
	}
	if _, hasVersion := keys["homeTagsVersion"]; !hasVersion || value.HomeTagsVersion < homeTagsVersion {
		value.SocialLinks = migratedHomeTags(value.SocialLinks)
		value.HomeTagsVersion = homeTagsVersion
	}
	if _, exists := keys["quotes"]; !exists {
		value.Quotes = LegacyQuoteEntries(value.Quote, value.QuoteAuthor)
	}
	if _, hasVersion := keys["quoteCatalogVersion"]; !hasVersion || value.QuoteCatalogVersion < quoteCatalogVersion {
		if _, hasQuotes := keys["quotes"]; hasQuotes {
			value.Quotes = appendNewBuiltinQuotes(value.Quotes)
		}
		value.QuoteCatalogVersion = quoteCatalogVersion
	}
	if _, hasPolicy := keys["routeAccess"]; !hasPolicy {
		// Old homepage cards and tags only controlled whether a link appeared.
		// Do NOT silently promote their hidden state to page/API restrictions.
		// Preserve the one legacy route policy: Start's public/private switch.
		value.RouteAccess = DefaultRouteAccess(value.StartPublic)
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
	if p.BrandIconURL != nil {
		v.BrandIconURL = *p.BrandIconURL
	}
	if p.Quote != nil {
		v.Quote = *p.Quote
	}
	if p.QuoteAuthor != nil {
		v.QuoteAuthor = *p.QuoteAuthor
	}
	if p.QuoteEnabled != nil {
		v.QuoteEnabled = *p.QuoteEnabled
	}
	if p.QuoteAuthorEnabled != nil {
		v.QuoteAuthorEnabled = *p.QuoteAuthorEnabled
	}
	if p.Quotes != nil {
		v.Quotes = *p.Quotes
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
	if p.StartPublic != nil && p.RouteAccess == nil {
		v.StartPublic = *p.StartPublic
		if v.RouteAccess == nil {
			v.RouteAccess = DefaultRouteAccess(v.StartPublic)
		}
		v.RouteAccess[RouteStart] = DefaultRouteAccess(v.StartPublic)[RouteStart]
	}
	if p.RouteAccess != nil {
		// Actual page/API permissions remain separate from link visibility.
		v.RouteAccess = *p.RouteAccess
	}
	if p.DefaultSearchEngine != nil {
		v.DefaultSearchEngine = *p.DefaultSearchEngine
	}
	if p.SearchEngines != nil {
		v.SearchEngines = *p.SearchEngines
	}
	if p.ThemeMode != nil {
		v.ThemeMode = *p.ThemeMode
	}
	if p.ThemePreset != nil {
		v.ThemePreset = *p.ThemePreset
	}
	if p.ThemeStyle != nil {
		v.ThemeStyle = *p.ThemeStyle
	}
	if p.ThemeGradientPacks != nil {
		v.ThemeGradientPacks = *p.ThemeGradientPacks
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
	if p.ShowICP != nil {
		v.ShowICP = *p.ShowICP
	}
	if p.ICPNumber != nil {
		v.ICPNumber = *p.ICPNumber
	}
	if p.ICPURL != nil {
		v.ICPURL = *p.ICPURL
	}
	if p.ShowPolice != nil {
		v.ShowPolice = *p.ShowPolice
	}
	if p.PoliceNumber != nil {
		v.PoliceNumber = *p.PoliceNumber
	}
	if p.PoliceURL != nil {
		v.PoliceURL = *p.PoliceURL
	}
	if p.FooterText != nil {
		v.FooterText = *p.FooterText
	}
	if p.ShowFriendLinks != nil {
		v.ShowFriendLinks = *p.ShowFriendLinks
	}
	if p.FriendLinks != nil {
		v.FriendLinks = *p.FriendLinks
	}
}

func normalize(v SiteSettings) SiteSettings {
	v.ProfileName = trim(v.ProfileName, 100)
	v.ProfileTagline = trim(v.ProfileTagline, 240)
	v.ProfileBio = trim(v.ProfileBio, 1000)
	v.AvatarURL = trim(v.AvatarURL, 1000)
	v.BrandIconURL = trim(v.BrandIconURL, 1000)
	v.Quote = trim(v.Quote, 500)
	v.QuoteAuthor = trim(v.QuoteAuthor, 100)
	v.Quotes = normalizeQuotes(v.Quotes)
	v.ICPNumber = trim(v.ICPNumber, 120)
	v.ICPURL = trim(v.ICPURL, 1000)
	v.PoliceNumber = trim(v.PoliceNumber, 120)
	v.PoliceURL = trim(v.PoliceURL, 1000)
	v.FooterText = trim(v.FooterText, 500)
	v.GitHubURL = trim(v.GitHubURL, 1000)
	v.EmailURL = trim(v.EmailURL, 1000)
	v.AboutURL = trim(v.AboutURL, 1000)
	v.HomeBackgroundURL = trim(v.HomeBackgroundURL, 1000)
	v.StartBackgroundURL = trim(v.StartBackgroundURL, 1000)

	v.SearchEngines = normalizeSearchEngines(v.SearchEngines)
	defaultFound := false
	for _, engine := range v.SearchEngines {
		if string(v.DefaultSearchEngine) == engine.ID {
			defaultFound = true
			break
		}
	}
	if !defaultFound {
		v.DefaultSearchEngine = SearchEngineName(v.SearchEngines[0].ID)
	}
	switch v.ThemeMode {
	case ThemeAuto, ThemeDark, ThemeLight:
	default:
		v.ThemeMode = ThemeAuto
	}
	if err := kittheme.ValidatePackName(string(v.ThemePreset)); err != nil {
		v.ThemePreset = PresetAurora
	}
	if v.ThemeStyle != StyleGradient {
		v.ThemeStyle = StyleSolid
	}
	v.ThemeGradientPacks = normalizeThemeGradientPacks(v.ThemeGradientPacks)
	if v.ThemeStyle == StyleGradient && len(v.ThemeGradientPacks) < 2 {
		v.ThemeStyle = StyleSolid
	}
	switch v.StartDensity {
	case DensityCompact, DensityComfortable, DensitySpacious:
	default:
		v.StartDensity = DensityComfortable
	}
	v.StartCardOpacity = clamp(v.StartCardOpacity, 30, 95)
	v.StartCardRadius = clamp(v.StartCardRadius, 12, 32)
	v.StartBackgroundDim = clamp(v.StartBackgroundDim, 0, 90)
	v.RouteAccess = NormalizeRouteAccess(v.RouteAccess, v.StartPublic)
	v.StartPublic = v.RouteAccess[RouteStart] == HomeEntryAll || v.RouteAccess[RouteStart] == HomeEntryGuest
	v.SocialLinks = normalizeSocial(v.SocialLinks)
	v.HomeEntries = normalizeHome(v.HomeEntries)
	v.Projects = normalizeProjects(v.Projects)
	v.FriendLinks = normalizeFriendLinks(v.FriendLinks)
	return v
}

// Existing solid themes remain intact. Gradient packs must be distinct, Kit-valid
// IDs, and between two and four entries when actively selected.
func normalizeThemeGradientPacks(packs []string) []string {
	if len(packs) == 0 {
		return []string{"aurora", "ocean"}
	}
	if len(packs) < 2 || len(packs) > 4 {
		return []string{}
	}
	out := make([]string, 0, len(packs))
	seen := make(map[string]bool, len(packs))
	for _, p := range packs {
		p = strings.TrimSpace(p)
		if kittheme.ValidatePackName(p) != nil || seen[p] {
			return []string{}
		}
		seen[p] = true
		out = append(out, p)
	}
	return out
}

// Engines are server-configured. Accept only HTTPS templates with one {query}
// and no credentials, so user input cannot become a navigation protocol.
func normalizeSearchEngines(values []SearchEngine) []SearchEngine {
	if len(values) == 0 {
		return DefaultSearchEngines()
	}
	if len(values) > 12 {
		values = values[:12]
	}
	out := make([]SearchEngine, 0, len(values))
	seen := map[string]bool{}
	for _, item := range values {
		item.ID = trim(item.ID, 80)
		item.Name = trim(item.Name, 60)
		item.URL = trim(item.URL, 1000)
		item.IconURL = trim(item.IconURL, 1000)
		if item.ID == "" || item.Name == "" || !validSearchEngineID(item.ID) ||
			seen[item.ID] || strings.Count(item.URL, "{query}") != 1 {
			continue
		}
		u, err := url.Parse(strings.Replace(item.URL, "{query}", "searchterm", 1))
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
			continue
		}
		if item.IconURL != "" {
			icon, err := url.Parse(item.IconURL)
			if err != nil || icon.Scheme != "https" || icon.Hostname() == "" || icon.User != nil {
				item.IconURL = ""
			}
		}
		seen[item.ID] = true
		out = append(out, item)
	}
	if len(out) == 0 {
		return DefaultSearchEngines()
	}
	return out
}

func validSearchEngineID(value string) bool {
	for _, ch := range value {
		if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' ||
			ch >= '0' && ch <= '9' || ch == '_' || ch == '-') {
			return false
		}
	}
	return true
}

func normalizeQuotes(values []QuoteEntry) []QuoteEntry {
	if values == nil {
		return []QuoteEntry{}
	}
	if len(values) > 300 {
		values = values[:300]
	}
	out := make([]QuoteEntry, 0, len(values))
	ids := map[string]bool{}
	for i, item := range values {
		item.ID = trim(item.ID, 80)
		if item.ID == "" {
			item.ID = fmt.Sprintf("quote-%d", i)
		}
		if ids[item.ID] {
			item.ID = fmt.Sprintf("quote-%d", i)
		}
		if ids[item.ID] {
			continue
		}
		item.Text = trim(item.Text, 500)
		item.Author = trim(item.Author, 100)
		if item.Text == "" {
			continue
		}
		ids[item.ID] = true
		out = append(out, item)
	}
	return out
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
		if !ValidVisibility(item.Visibility) {
			if item.Disabled {
				item.Visibility = HomeEntryDisabled
			} else {
				item.Visibility = HomeEntryAll
			}
		}
		item.Disabled = item.Visibility == HomeEntryDisabled
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
		switch item.Visibility {
		case HomeEntryAuthenticated, HomeEntryGuest, HomeEntryDisabled:
		default:
			item.Visibility = HomeEntryAll
		}
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

func normalizeFriendLinks(values []FriendLink) []FriendLink {
	if values == nil {
		return []FriendLink{}
	}
	if len(values) > 40 {
		values = values[:40]
	}
	out := make([]FriendLink, 0, len(values))
	for i, item := range values {
		item.ID = trim(item.ID, 80)
		if item.ID == "" {
			item.ID = fmt.Sprintf("friend-%d", i)
		}
		item.Name = trim(item.Name, 100)
		item.URL = trim(item.URL, 1000)
		if item.Name != "" && item.URL != "" {
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
