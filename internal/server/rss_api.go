package server

import (
	"encoding/xml"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type rssFeed struct {
	XMLName xml.Name   `xml:"rss"`
	Version string     `xml:"version,attr"`
	Channel rssChannel `xml:"channel"`
}

type rssChannel struct {
	Title         string    `xml:"title"`
	Link          string    `xml:"link"`
	Description   string    `xml:"description"`
	Language      string    `xml:"language"`
	LastBuildDate string    `xml:"lastBuildDate,omitempty"`
	Items         []rssItem `xml:"item"`
}

type rssItem struct {
	Title       string  `xml:"title"`
	Link        string  `xml:"link"`
	GUID        rssGUID `xml:"guid"`
	Description string  `xml:"description"`
	PubDate     string  `xml:"pubDate"`
}

type rssGUID struct {
	IsPermaLink string `xml:"isPermaLink,attr"`
	Value       string `xml:",chardata"`
}

func (s *Server) registerRSSFeed(mux *http.ServeMux) {
	mux.HandleFunc("GET /feed.xml", s.handleRSSFeed)
}

func rssBaseURL(r *http.Request) string {
	scheme := "http"
	// Honour the HTTPS endpoint used by conventional reverse proxies.
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return (&url.URL{Scheme: scheme, Host: r.Host}).String()
}

func rssDate(milliseconds int64) string {
	return time.UnixMilli(milliseconds).UTC().Format(time.RFC1123Z)
}

func (s *Server) handleRSSFeed(w http.ResponseWriter, r *http.Request) {
	posts, err := s.blog.ListFeed(r.Context(), 50)
	if err != nil {
		slog.Error("load RSS feed posts", "error", err)
		http.Error(w, "feed_unavailable", http.StatusInternalServerError)
		return
	}
	site, err := s.settings.GetSite(r.Context())
	if err != nil {
		slog.Error("load RSS feed settings", "error", err)
		http.Error(w, "feed_unavailable", http.StatusInternalServerError)
		return
	}

	base := rssBaseURL(r)
	title := site.ProfileName
	if title == "" {
		title = "Know Me"
	}
	description := site.ProfileTagline
	if description == "" {
		description = "最新文章"
	}
	feed := rssFeed{
		Version: "2.0",
		Channel: rssChannel{
			Title:       title,
			Link:        base + "/blog",
			Description: description,
			Language:    "zh-CN",
			Items:       make([]rssItem, 0, len(posts)),
		},
	}
	var newestUpdated int64
	for _, post := range posts {
		link := base + "/blog/" + url.PathEscape(post.Slug)
		published := post.UpdatedAt
		if post.PublishedAt != nil {
			published = *post.PublishedAt
		}
		if post.UpdatedAt > newestUpdated {
			newestUpdated = post.UpdatedAt
		}
		feed.Channel.Items = append(feed.Channel.Items, rssItem{
			Title:       post.Title,
			Link:        link,
			GUID:        rssGUID{IsPermaLink: "true", Value: link},
			Description: post.Excerpt,
			PubDate:     rssDate(published),
		})
	}
	if newestUpdated > 0 {
		feed.Channel.LastBuildDate = rssDate(newestUpdated)
	}

	body, err := xml.MarshalIndent(feed, "", "  ")
	if err != nil {
		slog.Error("marshal RSS feed", "error", err)
		http.Error(w, "feed_unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/rss+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(xml.Header))
	_, _ = w.Write(body)
	_, _ = w.Write([]byte("\n"))
}
