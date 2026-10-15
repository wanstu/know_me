package server

import (
	"context"
	"errors"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wanstu/know_me/internal/blog"
	"github.com/wanstu/know_me/internal/navigation"
)

type mcpItemUpdate struct {
	ID         int64   `json:"id"`
	Name       *string `json:"name,omitempty"`
	URL        *string `json:"url,omitempty"`
	IconURL    *string `json:"iconUrl,omitempty"`
	Visibility *string `json:"visibility,omitempty"`
}
type mcpGroupUpdate struct {
	ID         int64   `json:"id"`
	Name       *string `json:"name,omitempty"`
	Icon       *string `json:"icon,omitempty"`
	Visibility *string `json:"visibility,omitempty"`
}
type mcpItemMove struct {
	ID       int64  `json:"id"`
	GroupID  int64  `json:"groupId"`
	ParentID *int64 `json:"parentId,omitempty"`
	Index    int    `json:"index" jsonschema:"Zero-based position in destination"`
}
type mcpTaxonomyMerge struct {
	Kind     string `json:"kind"`
	SourceID int64  `json:"sourceId"`
	TargetID int64  `json:"targetId"`
	Confirm  bool   `json:"confirm"`
}

func registerMCPNavigationWrites(m *mcp.Server, s *Server) {
	addMCPTool(m, "navigation_update_item", "Update a Start navigation item without affecting unspecified properties", false, func(ctx context.Context, in mcpItemUpdate) (any, error) {
		if in.ID <= 0 {
			return nil, errors.New("invalid_id")
		}
		patch := navigation.ItemPatch{Name: in.Name, URL: in.URL, IconURL: in.IconURL}
		if in.Visibility != nil {
			v, err := navVisibility(*in.Visibility)
			if err != nil {
				return nil, err
			}
			patch.Visibility = &v
		}
		ok, err := s.navigation.UpdateItem(ctx, in.ID, patch)
		return map[string]any{"updated": ok}, err
	})
	addMCPTool(m, "navigation_move_item", "Move a Start item into a group or folder with an explicit position", false, func(ctx context.Context, in mcpItemMove) (any, error) {
		if in.ID <= 0 || in.GroupID <= 0 || in.Index < 0 {
			return nil, errors.New("invalid_move")
		}
		err := s.navigation.MoveItem(ctx, in.ID, in.GroupID, in.ParentID, in.Index)
		return map[string]any{"ok": err == nil}, err
	})
	addMCPTool(m, "navigation_delete_item", "Delete a Start navigation item (requires confirm=true)", false, func(ctx context.Context, in mcpDelete) (any, error) {
		if in.ID <= 0 || !in.Confirm {
			return nil, errors.New("explicit_confirmation_required")
		}
		deleted, err := s.navigation.DeleteItem(ctx, in.ID)
		return map[string]any{"deleted": deleted}, err
	})
	addMCPTool(m, "navigation_update_group", "Update name, icon and visibility of a Start group", false, func(ctx context.Context, in mcpGroupUpdate) (any, error) {
		if in.ID <= 0 {
			return nil, errors.New("invalid_id")
		}
		patch := navigation.GroupPatch{Name: in.Name, Icon: in.Icon}
		if in.Visibility != nil {
			v, err := navVisibility(*in.Visibility)
			if err != nil {
				return nil, err
			}
			patch.Visibility = &v
		}
		updated, err := s.navigation.UpdateGroup(ctx, in.ID, patch)
		return map[string]any{"updated": updated}, err
	})
	addMCPTool(m, "navigation_delete_group", "Delete a Start navigation group (requires confirm=true)", false, func(ctx context.Context, in mcpDelete) (any, error) {
		if in.ID <= 0 || !in.Confirm {
			return nil, errors.New("explicit_confirmation_required")
		}
		deleted, err := s.navigation.DeleteGroup(ctx, in.ID)
		return map[string]any{"deleted": deleted}, err
	})
	addMCPTool(m, "taxonomy_merge", "Merge category or tag into another and remove the source (requires confirm=true)", false, func(ctx context.Context, in mcpTaxonomyMerge) (any, error) {
		if !in.Confirm || in.SourceID <= 0 || in.TargetID <= 0 {
			return nil, errors.New("explicit_confirmation_required")
		}
		var kind blog.TaxonomyKind
		switch in.Kind {
		case "category":
			kind = blog.TaxonomyCategory
		case "tag":
			kind = blog.TaxonomyTag
		default:
			return nil, errors.New("invalid_kind")
		}
		err := s.blog.MergeTaxonomy(ctx, kind, in.SourceID, in.TargetID)
		return map[string]any{"ok": err == nil}, err
	})
}
