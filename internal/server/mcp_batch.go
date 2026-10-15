package server

import (
	"context"
	"errors"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wanstu/know_me/internal/blog"
)

type mcpBatchTaxonomy struct {
	IDs               []int64   `json:"ids" jsonschema:"1-50 distinct article IDs"`
	AddTags           []string  `json:"addTags,omitempty"`
	RemoveTags        []string  `json:"removeTags,omitempty"`
	ReplaceTags       *[]string `json:"replaceTags,omitempty" jsonschema:"Full replacement tags, [] to clear all"`
	AddCategories     []string  `json:"addCategories,omitempty"`
	RemoveCategories  []string  `json:"removeCategories,omitempty"`
	ReplaceCategories *[]string `json:"replaceCategories,omitempty"`
	Confirm           bool      `json:"confirm,omitempty" jsonschema:"False previews changes. Must be true to apply."`
}
type mcpBatchTaxonomyItem struct {
	ID            int64    `json:"id"`
	Title         string   `json:"title"`
	OldTags       []string `json:"oldTags"`
	Tags          []string `json:"tags"`
	OldCategories []string `json:"oldCategories"`
	Categories    []string `json:"categories"`
}

func registerMCPBatchTools(m *mcp.Server, s *Server) {
	addMCPTool(m, "posts_batch_taxonomy", "Preview or apply the same tag/category edits to 1-50 articles. confirm=false previews without writes.", false, func(ctx context.Context, in mcpBatchTaxonomy) (any, error) {
		if len(in.IDs) == 0 || len(in.IDs) > 50 {
			return nil, errors.New("ids_count_must_be_1_to_50")
		}
		if (in.ReplaceTags != nil && (len(in.AddTags) > 0 || len(in.RemoveTags) > 0)) ||
			(in.ReplaceCategories != nil && (len(in.AddCategories) > 0 || len(in.RemoveCategories) > 0)) {
			return nil, errors.New("cannot_mix_replace_and_incremental_edits")
		}
		seen := map[int64]bool{}
		entries := make([]blog.Post, 0, len(in.IDs))
		preview := make([]mcpBatchTaxonomyItem, 0, len(in.IDs))
		for _, id := range in.IDs {
			if id <= 0 || seen[id] {
				return nil, errors.New("invalid_or_duplicate_post_id")
			}
			seen[id] = true
			post, err := s.blog.GetByID(ctx, id)
			if err != nil {
				return nil, fmt.Errorf("post_%d: %w", id, err)
			}
			entries = append(entries, post)
			preview = append(preview, mcpBatchTaxonomyItem{
				ID: post.ID, Title: post.Title, OldTags: post.Tags,
				Tags:          updateMCPNames(post.Tags, in.AddTags, in.RemoveTags, in.ReplaceTags),
				OldCategories: post.Categories,
				Categories:    updateMCPNames(post.Categories, in.AddCategories, in.RemoveCategories, in.ReplaceCategories),
			})
		}
		if !in.Confirm {
			return map[string]any{"preview": true, "items": preview, "updated": 0}, nil
		}
		edits := make([]blog.TaxonomyBatchEdit, 0, len(entries))
		for i, post := range entries {
			item := preview[i]
			edits = append(edits, blog.TaxonomyBatchEdit{
				ID: post.ID, ExpectedUpdatedAt: post.UpdatedAt,
				Tags: item.Tags, Categories: item.Categories,
			})
		}
		// Both the revision snapshots and all association changes are atomic.
		saved, err := s.blog.BatchUpdateTaxonomy(ctx, edits)
		if err != nil {
			return nil, err
		}
		return map[string]any{"preview": false, "updated": len(saved), "failed": 0, "items": saved}, nil
	})
}
