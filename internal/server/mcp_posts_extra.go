package server

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wanstu/know_me/internal/blog"
)

// MCP timestamps are Unix MILLISECONDS. Reject second-based input rather
// than silently publishing articles decades away from their requested date.
// MCP accepts timezone-explicit RFC3339 timestamps, or YYYY-MM-DD (UTC).
// A plain date is not interpreted using the server's local timezone.
func resolveMCPDate(epoch *int64, formatted *string) (*int64, error) {
	if formatted == nil {
		return epoch, nil
	}
	if epoch != nil {
		return nil, errors.New("ambiguous_publication_date")
	}
	raw := strings.TrimSpace(*formatted)
	if raw == "" {
		return nil, errors.New("invalid_publication_date")
	}
	var parsed time.Time
	var err error
	if len(raw) == 10 {
		parsed, err = time.Parse("2006-01-02", raw)
	} else {
		parsed, err = time.Parse(time.RFC3339, raw)
	}
	if err != nil {
		return nil, errors.New("invalid_publication_date_use_RFC3339_or_YYYY-MM-DD")
	}
	millis := parsed.UnixMilli()
	return &millis, nil
}
func validMCPMillis(value int64) bool {
	return value >= 100_000_000_000 && value < 10_000_000_000_000
}
func validateMCPPostDates(status blog.Status, published, first *int64) error {
	if published != nil && !validMCPMillis(*published) {
		return errors.New("publishedAt_must_be_unix_milliseconds")
	}
	if first != nil && !validMCPMillis(*first) {
		return errors.New("firstPublishedAt_must_be_unix_milliseconds")
	}
	now := time.Now().UnixMilli()
	if status == blog.StatusScheduled {
		if published == nil || *published <= now {
			return errors.New("scheduled_requires_future_publishedAt")
		}
	} else if status == blog.StatusPublished && published != nil && *published > now {
		return errors.New("future_publication_requires_scheduled_status")
	}
	if status == blog.StatusDraft && published != nil {
		return errors.New("draft_cannot_have_publishedAt")
	}
	return nil
}
func containsMCPName(values []string, expected string) bool {
	for _, v := range values {
		if strings.EqualFold(strings.TrimSpace(v), expected) {
			return true
		}
	}
	return false
}

// posts_set_status encodes the entire publication lifecycle explicitly.

type mcpPostTaxonomy struct {
	ID                int64     `json:"id"`
	AddTags           []string  `json:"addTags,omitempty" jsonschema:"Add tag names while preserving existing tags"`
	RemoveTags        []string  `json:"removeTags,omitempty" jsonschema:"Remove tag names without affecting others"`
	ReplaceTags       *[]string `json:"replaceTags,omitempty" jsonschema:"Optional complete tag replacement; an empty [] clears all tags"`
	AddCategories     []string  `json:"addCategories,omitempty"`
	RemoveCategories  []string  `json:"removeCategories,omitempty"`
	ReplaceCategories *[]string `json:"replaceCategories,omitempty"`
	ExpectedUpdatedAt *int64    `json:"expectedUpdatedAt,omitempty"`
}

func updateMCPNames(current, add, remove []string, replace *[]string) []string {
	if replace != nil {
		return append([]string{}, (*replace)...)
	}
	result := make([]string, 0, len(current)+len(add))
	for _, item := range current {
		if !containsMCPName(remove, item) && !containsMCPName(result, item) {
			result = append(result, item)
		}
	}
	for _, item := range add {
		if strings.TrimSpace(item) != "" && !containsMCPName(result, item) {
			result = append(result, item)
		}
	}
	return result
}

type mcpPostStatus struct {
	ID                int64   `json:"id"`
	Action            string  `json:"action" jsonschema:"publish, unpublish, or schedule"`
	PublishedAt       *int64  `json:"publishedAt,omitempty" jsonschema:"Unix milliseconds: past date for publish, future date for schedule. Publish without a date means now."`
	PublishedAtDate   *string `json:"publishedAtDate,omitempty" jsonschema:"RFC3339 with timezone, e.g. 2026-10-15T10:00:00+08:00, or YYYY-MM-DD (UTC). Do not combine with publishedAt."`
	ExpectedUpdatedAt *int64  `json:"expectedUpdatedAt,omitempty" jsonschema:"Optional last-seen updatedAt to reject stale edits"`
}
type mcpRevisionList struct {
	ID    int64 `json:"id"`
	Limit int   `json:"limit,omitempty" jsonschema:"Maximum revisions (1..50)"`
}
type mcpRevisionID struct {
	ID         int64 `json:"id"`
	RevisionID int64 `json:"revisionId"`
}
type mcpRevisionRestore struct {
	ID         int64 `json:"id"`
	RevisionID int64 `json:"revisionId"`
	Confirm    bool  `json:"confirm" jsonschema:"Must be true: restoring can also change the public publication state"`
}

func registerMCPPostReadExtras(m *mcp.Server, s *Server) {
	addMCPTool(m, "posts_revisions_list", "List revision metadata and sizes of a post, without downloading all historical Markdown bodies", true, func(ctx context.Context, in mcpRevisionList) (any, error) {
		if in.ID <= 0 {
			return nil, errors.New("invalid_id")
		}
		if _, err := s.blog.GetByID(ctx, in.ID); err != nil {
			return nil, err
		}
		revisions, err := s.blog.ListRevisions(ctx, in.ID, in.Limit)
		if err != nil {
			return nil, err
		}
		type summary struct {
			ID            int64          `json:"id"`
			CreatedAt     int64          `json:"createdAt"`
			ContentLength int            `json:"contentLength"`
			Metadata      map[string]any `json:"metadata"`
		}
		result := make([]summary, 0, len(revisions))
		for _, rev := range revisions {
			result = append(result, summary{ID: rev.ID, CreatedAt: rev.CreatedAt, ContentLength: len(rev.ContentMD), Metadata: rev.Metadata})
		}
		return map[string]any{"revisions": result}, nil
	})
	addMCPTool(m, "posts_revision_get", "Read the complete Markdown and metadata for a specific historical article revision", true, func(ctx context.Context, in mcpRevisionID) (any, error) {
		if in.ID <= 0 || in.RevisionID <= 0 {
			return nil, errors.New("invalid_id")
		}
		rev, err := s.blog.GetRevision(ctx, in.ID, in.RevisionID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"revision": rev}, nil
	})
}
func registerMCPPostWriteExtras(m *mcp.Server, s *Server) {
	addMCPTool(m, "posts_set_status", "Publish immediately, unpublish to draft, or schedule a post for the future; preserve original first publication time", false, func(ctx context.Context, in mcpPostStatus) (any, error) {
		if in.ID <= 0 {
			return nil, errors.New("invalid_id")
		}
		p, err := s.blog.GetByID(ctx, in.ID)
		if err != nil {
			return nil, err
		}
		if in.ExpectedUpdatedAt != nil && *in.ExpectedUpdatedAt != p.UpdatedAt {
			return nil, errors.New("post_modified_since_read")
		}
		publishedAt, err := resolveMCPDate(in.PublishedAt, in.PublishedAtDate)
		if err != nil {
			return nil, err
		}
		switch in.Action {
		case "publish":
			previous := p.Status
			p.Status = blog.StatusPublished
			if publishedAt != nil {
				p.PublishedAt = publishedAt
			} else if previous != blog.StatusPublished {
				now := time.Now().UnixMilli()
				p.PublishedAt = &now
			}
		case "unpublish":
			if publishedAt != nil {
				return nil, errors.New("unpublish_does_not_accept_publishedAt")
			}
			p.Status = blog.StatusDraft
			p.PublishedAt = nil
		case "schedule":
			p.Status = blog.StatusScheduled
			if publishedAt != nil {
				p.PublishedAt = publishedAt
			}
		default:
			return nil, errors.New("invalid_action")
		}
		if err := validateMCPPostDates(p.Status, p.PublishedAt, p.FirstPublishedAt); err != nil {
			return nil, err
		}
		updated, err := s.blog.Save(ctx, blog.SaveInput{Title: p.Title, Slug: p.Slug, Excerpt: p.Excerpt, ContentMD: p.ContentMD, Status: p.Status, Pinned: p.Pinned, SEOTitle: p.SEOTitle, SEODescription: p.SEODescription, PublishedAt: p.PublishedAt, FirstPublishedAt: p.FirstPublishedAt, Tags: p.Tags, Categories: p.Categories}, &in.ID)
		return map[string]any{"post": updated}, err
	})
	addMCPTool(m, "posts_taxonomy_update", "Add, remove or replace categories and tags on an article without touching its Markdown and unrelated metadata", false, func(ctx context.Context, in mcpPostTaxonomy) (any, error) {
		if in.ID <= 0 {
			return nil, errors.New("invalid_id")
		}
		if (in.ReplaceTags != nil && (len(in.AddTags) > 0 || len(in.RemoveTags) > 0)) ||
			(in.ReplaceCategories != nil && (len(in.AddCategories) > 0 || len(in.RemoveCategories) > 0)) {
			return nil, errors.New("cannot_mix_replace_and_incremental_edits")
		}
		post, err := s.blog.GetByID(ctx, in.ID)
		if err != nil {
			return nil, err
		}
		if in.ExpectedUpdatedAt != nil && post.UpdatedAt != *in.ExpectedUpdatedAt {
			return nil, errors.New("post_modified_since_read")
		}
		post.Tags = updateMCPNames(post.Tags, in.AddTags, in.RemoveTags, in.ReplaceTags)
		post.Categories = updateMCPNames(post.Categories, in.AddCategories, in.RemoveCategories, in.ReplaceCategories)
		updated, err := s.blog.Save(ctx, blog.SaveInput{
			Title: post.Title, Slug: post.Slug, Excerpt: post.Excerpt, ContentMD: post.ContentMD,
			Status: post.Status, Pinned: post.Pinned, SEOTitle: post.SEOTitle, SEODescription: post.SEODescription,
			PublishedAt: post.PublishedAt, FirstPublishedAt: post.FirstPublishedAt, Tags: post.Tags, Categories: post.Categories,
		}, &in.ID)
		return map[string]any{"post": updated}, err
	})
	addMCPTool(m, "posts_revision_restore", "Restore a historical article revision including original tags, categories and metadata when present; confirmation required", false, func(ctx context.Context, in mcpRevisionRestore) (any, error) {
		if in.ID <= 0 || in.RevisionID <= 0 || !in.Confirm {
			return nil, errors.New("explicit_confirmation_required")
		}
		p, err := s.blog.RestoreRevision(ctx, in.ID, in.RevisionID)
		return map[string]any{"post": p}, err
	})
}
