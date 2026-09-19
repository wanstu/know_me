package navigation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type importedItem struct {
	ExternalID      *string
	Name            string
	URL             string
	Type            ItemType
	IconURL         string
	IconText        string
	BackgroundColor string
	Size            ItemSize
	VisitCount      int64
	BrowserLocal    bool
	Extra           map[string]any
	Children        []importedItem
}

type importedGroup struct {
	ExternalID *string
	Name       string
	Icon       string
	Extra      map[string]any
	Items      []importedItem
}

type ItabImportPreview struct {
	Groups       int `json:"groups"`
	Items        int `json:"items"`
	Folders      int `json:"folders"`
	BrowserLocal int `json:"browserLocal"`
	Conflicts    int `json:"conflicts"`
}

type ItabImportResult struct {
	ItabImportPreview
	AddedGroups   int `json:"addedGroups"`
	AddedItems    int `json:"addedItems"`
	UpdatedGroups int `json:"updatedGroups"`
	UpdatedItems  int `json:"updatedItems"`
	SkippedGroups int `json:"skippedGroups"`
	SkippedItems  int `json:"skippedItems"`
}

func ParseItab(raw string) ([]importedGroup, error) {
	var root map[string]any
	if err := json.Unmarshal([]byte(raw), &root); err != nil {
		return nil, errors.New("itab_invalid_json")
	}
	values, ok := root["navConfig"].([]any)
	if !ok {
		return nil, errors.New("itab_missing_nav_config")
	}
	groups := make([]importedGroup, 0, len(values))
	for _, value := range values {
		groups = append(groups, parseImportedGroup(value))
	}
	return groups, nil
}

func parseImportedGroup(value any) importedGroup {
	source := asObject(value)
	items := []importedItem{}
	if children, ok := source["children"].([]any); ok {
		items = make([]importedItem, 0, len(children))
		for _, child := range children {
			items = append(items, parseImportedItem(child))
		}
	}
	return importedGroup{
		ExternalID: optionalText(source["id"]),
		Name:       textValue(source["name"], "未命名分组"),
		Icon:       textValue(source["icon"], ""),
		Extra:      extraFields(source, "id", "name", "icon", "children"),
		Items:      items,
	}
}

func parseImportedItem(value any) importedItem {
	source := asObject(value)
	rawChildren, _ := source["children"].([]any)
	originalType := textValue(source["type"], "")
	if originalType == "" {
		if len(rawChildren) > 0 {
			originalType = "folder"
		} else {
			originalType = "text"
		}
	}
	itemType := ItemLink
	if originalType == "folder" || len(rawChildren) > 0 {
		itemType = ItemFolder
	}
	url := textValue(source["url"], "")
	extra := extraFields(source, "id", "url", "type", "name", "src", "iconText", "backgroundColor", "view", "size", "children")
	_, hadView := source["view"]
	extra["__knowMeItab"] = map[string]any{
		"originalType": originalType,
		"originalSize": textValue(source["size"], ""),
		"hadView":      hadView,
	}

	children := make([]importedItem, 0, len(rawChildren))
	for _, child := range rawChildren {
		children = append(children, parseImportedItem(child))
	}

	return importedItem{
		ExternalID:      optionalText(source["id"]),
		Name:            textValue(source["name"], "未命名"),
		URL:             url,
		Type:            itemType,
		IconURL:         textValue(source["src"], ""),
		IconText:        textValue(source["iconText"], ""),
		BackgroundColor: textValue(source["backgroundColor"], ""),
		Size:            importSize(source["size"]),
		VisitCount:      integerValue(source["view"]),
		BrowserLocal:    isBrowserLocal(url),
		Extra:           extra,
		Children:        children,
	}
}

func (s *Store) PreviewItabImport(ctx context.Context, raw string) (ItabImportPreview, error) {
	groups, err := ParseItab(raw)
	if err != nil {
		return ItabImportPreview{}, err
	}
	tree, err := s.Tree(ctx, true)
	if err != nil {
		return ItabImportPreview{}, err
	}
	var preview ItabImportPreview
	preview.Groups = len(groups)
	for _, group := range groups {
		all := flattenImported(group.Items)
		preview.Items += len(all)
		for _, item := range all {
			if item.Type == ItemFolder {
				preview.Folders++
			}
			if item.BrowserLocal {
				preview.BrowserLocal++
			}
		}
		var match *Group
		for _, candidate := range tree.Groups {
			if groupMatches(group, candidate) {
				match = candidate
				break
			}
		}
		if match != nil {
			preview.Conflicts++
			preview.Conflicts += countItemConflicts(group.Items, match.Items)
		}
	}
	return preview, nil
}

func flattenImported(items []importedItem) []importedItem {
	var output []importedItem
	var visit func(importedItem)
	visit = func(item importedItem) {
		output = append(output, item)
		for _, child := range item.Children {
			visit(child)
		}
	}
	for _, item := range items {
		visit(item)
	}
	return output
}

func groupMatches(imported importedGroup, existing *Group) bool {
	if imported.ExternalID != nil && existing.ExternalID != nil && *existing.ExternalID == *imported.ExternalID {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(existing.Name), strings.TrimSpace(imported.Name))
}

func itemMatches(imported importedItem, existing *Item) bool {
	if imported.ExternalID != nil && existing.ExternalID != nil && *existing.ExternalID == *imported.ExternalID {
		return true
	}
	if imported.URL != "" && existing.URL == imported.URL {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(existing.Name), strings.TrimSpace(imported.Name))
}

func countItemConflicts(imported []importedItem, existing []*Item) int {
	conflicts := 0
	for _, item := range imported {
		var match *Item
		for _, candidate := range existing {
			if itemMatches(item, candidate) {
				match = candidate
				break
			}
		}
		if match != nil {
			conflicts++
			conflicts += countItemConflicts(item.Children, match.Children)
		}
	}
	return conflicts
}

type importCounts struct {
	AddedGroups   int
	AddedItems    int
	UpdatedGroups int
	UpdatedItems  int
	SkippedGroups int
	SkippedItems  int
}

func (s *Store) ApplyItabImport(ctx context.Context, raw, strategy string, overwrite bool) (ItabImportResult, error) {
	groups, err := ParseItab(raw)
	if err != nil {
		return ItabImportResult{}, err
	}
	preview, err := s.PreviewItabImport(ctx, raw)
	if err != nil {
		return ItabImportResult{}, err
	}
	if strategy != "replace" {
		strategy = "merge"
	}
	counts := importCounts{}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ItabImportResult{}, err
	}
	defer tx.Rollback()

	if strategy == "replace" {
		if _, err := tx.ExecContext(ctx, "DELETE FROM nav_groups"); err != nil {
			return ItabImportResult{}, err
		}
	}
	for groupIndex, group := range groups {
		var existingID *int64
		if strategy != "replace" {
			existingID, err = findImportedGroup(ctx, tx, group)
			if err != nil {
				return ItabImportResult{}, err
			}
		}
		var groupID int64
		if existingID != nil {
			groupID = *existingID
			if overwrite {
				if err := updateGroupFromImport(ctx, tx, groupID, group, groupIndex); err != nil {
					return ItabImportResult{}, err
				}
				counts.UpdatedGroups++
			} else {
				counts.SkippedGroups++
			}
		} else {
			groupID, err = insertGroupFromImport(ctx, tx, group, groupIndex)
			if err != nil {
				return ItabImportResult{}, err
			}
			counts.AddedGroups++
		}
		if err := mergeImportedItems(ctx, tx, groupID, nil, group.Items, overwrite || strategy == "replace", &counts); err != nil {
			return ItabImportResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return ItabImportResult{}, err
	}

	return ItabImportResult{
		ItabImportPreview: preview,
		AddedGroups:       counts.AddedGroups,
		AddedItems:        counts.AddedItems,
		UpdatedGroups:     counts.UpdatedGroups,
		UpdatedItems:      counts.UpdatedItems,
		SkippedGroups:     counts.SkippedGroups,
		SkippedItems:      counts.SkippedItems,
	}, nil
}

func findImportedGroup(ctx context.Context, q queryer, group importedGroup) (*int64, error) {
	if group.ExternalID != nil {
		var id int64
		err := q.QueryRowContext(ctx, "SELECT id FROM nav_groups WHERE external_id = ? LIMIT 1", *group.ExternalID).Scan(&id)
		if err == nil {
			return &id, nil
		}
		if err != sql.ErrNoRows {
			return nil, err
		}
	}
	var id int64
	err := q.QueryRowContext(ctx, "SELECT id FROM nav_groups WHERE name = ? COLLATE NOCASE LIMIT 1", group.Name).Scan(&id)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func findImportedItem(ctx context.Context, q queryer, groupID int64, parentID *int64, item importedItem) (*int64, error) {
	parentClause := "((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)"
	if item.ExternalID != nil {
		var id int64
		err := q.QueryRowContext(ctx,
			"SELECT id FROM nav_items WHERE group_id = ? AND "+parentClause+" AND external_id = ? LIMIT 1",
			groupID, nullableInt64(parentID), nullableInt64(parentID), *item.ExternalID,
		).Scan(&id)
		if err == nil {
			return &id, nil
		}
		if err != sql.ErrNoRows {
			return nil, err
		}
	}
	if item.URL != "" {
		var id int64
		err := q.QueryRowContext(ctx,
			"SELECT id FROM nav_items WHERE group_id = ? AND "+parentClause+" AND url = ? LIMIT 1",
			groupID, nullableInt64(parentID), nullableInt64(parentID), item.URL,
		).Scan(&id)
		if err == nil {
			return &id, nil
		}
		if err != sql.ErrNoRows {
			return nil, err
		}
	}
	var id int64
	err := q.QueryRowContext(ctx,
		"SELECT id FROM nav_items WHERE group_id = ? AND "+parentClause+" AND name = ? COLLATE NOCASE LIMIT 1",
		groupID, nullableInt64(parentID), nullableInt64(parentID), item.Name,
	).Scan(&id)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func insertGroupFromImport(ctx context.Context, q queryer, group importedGroup, sortOrder int) (int64, error) {
	extra, _ := json.Marshal(group.Extra)
	now := time.Now().UnixMilli()
	result, err := q.ExecContext(ctx,
		"INSERT INTO nav_groups (external_id, name, icon, sort_order, visibility, extra_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		nullableString(group.ExternalID), group.Name, group.Icon, sortOrder, VisibilityPrivate, string(extra), now, now,
	)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func updateGroupFromImport(ctx context.Context, q queryer, id int64, group importedGroup, sortOrder int) error {
	extra, _ := json.Marshal(group.Extra)
	_, err := q.ExecContext(ctx,
		"UPDATE nav_groups SET external_id = ?, name = ?, icon = ?, sort_order = ?, extra_json = ?, updated_at = ? WHERE id = ?",
		nullableString(group.ExternalID), group.Name, group.Icon, sortOrder, string(extra), time.Now().UnixMilli(), id,
	)
	return err
}

func insertItemFromImport(ctx context.Context, q queryer, groupID int64, parentID *int64, item importedItem, sortOrder int) (int64, error) {
	extra, _ := json.Marshal(item.Extra)
	now := time.Now().UnixMilli()
	result, err := q.ExecContext(ctx, `
INSERT INTO nav_items
(external_id, group_id, parent_id, type, name, url, icon_url, icon_text, background_color, size, visit_count, sort_order, visibility, browser_local, extra_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		nullableString(item.ExternalID), groupID, nullableInt64(parentID), item.Type, item.Name, item.URL,
		item.IconURL, item.IconText, item.BackgroundColor, item.Size, item.VisitCount, sortOrder, VisibilityPrivate,
		boolInt(item.BrowserLocal), string(extra), now, now,
	)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func updateItemFromImport(ctx context.Context, q queryer, id, groupID int64, parentID *int64, item importedItem, sortOrder int) error {
	extra, _ := json.Marshal(item.Extra)
	_, err := q.ExecContext(ctx, `
UPDATE nav_items
SET external_id = ?, group_id = ?, parent_id = ?, type = ?, name = ?, url = ?, icon_url = ?, icon_text = ?,
    background_color = ?, size = ?, visit_count = ?, sort_order = ?, browser_local = ?, extra_json = ?, updated_at = ?
WHERE id = ?`,
		nullableString(item.ExternalID), groupID, nullableInt64(parentID), item.Type, item.Name, item.URL, item.IconURL,
		item.IconText, item.BackgroundColor, item.Size, item.VisitCount, sortOrder, boolInt(item.BrowserLocal),
		string(extra), time.Now().UnixMilli(), id,
	)
	return err
}

func mergeImportedItems(ctx context.Context, q queryer, groupID int64, parentID *int64, items []importedItem, overwrite bool, counts *importCounts) error {
	for index, item := range items {
		existingID, err := findImportedItem(ctx, q, groupID, parentID, item)
		if err != nil {
			return err
		}
		var itemID int64
		if existingID != nil {
			itemID = *existingID
			if overwrite {
				if err := updateItemFromImport(ctx, q, itemID, groupID, parentID, item, index); err != nil {
					return err
				}
				counts.UpdatedItems++
			} else {
				counts.SkippedItems++
			}
		} else {
			itemID, err = insertItemFromImport(ctx, q, groupID, parentID, item, index)
			if err != nil {
				return err
			}
			counts.AddedItems++
		}
		if len(item.Children) > 0 {
			parent := itemID
			if err := mergeImportedItems(ctx, q, groupID, &parent, item.Children, overwrite, counts); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) ExportItab(ctx context.Context) ([]byte, error) {
	tree, err := s.Tree(ctx, true)
	if err != nil {
		return nil, err
	}
	groups := make([]any, 0, len(tree.Groups))
	for _, group := range tree.Groups {
		groups = append(groups, exportGroup(group))
	}
	body := map[string]any{"navConfig": groups}
	return json.MarshalIndent(body, "", "  ")
}

func exportGroup(group *Group) map[string]any {
	result := copyObject(group.Extra)
	if group.ExternalID != nil {
		result["id"] = *group.ExternalID
	} else {
		result["id"] = fmt.Sprintf("know_me_group_%d", group.ID)
	}
	result["name"] = group.Name
	result["icon"] = group.Icon
	children := make([]any, 0, len(group.Items))
	for _, item := range group.Items {
		children = append(children, exportItem(item))
	}
	result["children"] = children
	return result
}

func exportItem(item *Item) map[string]any {
	copy, meta := splitExtra(item.Extra)
	originalType := textValue(meta["originalType"], "")
	itemType := "text"
	if item.Type == ItemFolder {
		itemType = "folder"
	} else if originalType == "icon" || originalType == "text" {
		itemType = originalType
	} else if item.IconURL != "" {
		itemType = "icon"
	}

	if item.ExternalID != nil {
		copy["id"] = *item.ExternalID
	} else {
		copy["id"] = fmt.Sprintf("know_me_%d", item.ID)
	}
	copy["url"] = item.URL
	copy["name"] = item.Name
	copy["src"] = item.IconURL
	copy["type"] = itemType
	copy["iconText"] = item.IconText
	copy["backgroundColor"] = item.BackgroundColor
	copy["size"] = exportSize(item.Size)
	if boolValue(meta["hadView"]) || item.VisitCount > 0 {
		copy["view"] = item.VisitCount
	}
	if item.Type == ItemFolder {
		children := make([]any, 0, len(item.Children))
		for _, child := range item.Children {
			children = append(children, exportItem(child))
		}
		copy["children"] = children
	}
	return copy
}

func splitExtra(extra map[string]any) (map[string]any, map[string]any) {
	copy := copyObject(extra)
	meta := asObject(copy["__knowMeItab"])
	delete(copy, "__knowMeItab")
	return copy, meta
}

func importSize(value any) ItemSize {
	switch textValue(value, "") {
	case "2x4":
		return Size2x1
	case "4x4", "4x2":
		return Size2x2
	default:
		return Size1x1
	}
}

func exportSize(value ItemSize) string {
	switch value {
	case Size2x1:
		return "2x4"
	case Size2x2:
		return "4x4"
	default:
		return "2x2"
	}
}

func asObject(value any) map[string]any {
	if object, ok := value.(map[string]any); ok && object != nil {
		return object
	}
	return map[string]any{}
}

func copyObject(value map[string]any) map[string]any {
	result := map[string]any{}
	for key, item := range value {
		result[key] = item
	}
	return result
}

func textValue(value any, fallback string) string {
	if text, ok := value.(string); ok {
		return text
	}
	return fallback
}

func optionalText(value any) *string {
	text, ok := value.(string)
	if !ok || text == "" {
		return nil
	}
	return &text
}

func integerValue(value any) int64 {
	switch number := value.(type) {
	case float64:
		return int64(number)
	case int:
		return int64(number)
	case int64:
		return number
	case json.Number:
		result, _ := number.Int64()
		return result
	default:
		return 0
	}
}

func boolValue(value any) bool {
	result, _ := value.(bool)
	return result
}

func extraFields(source map[string]any, known ...string) map[string]any {
	excluded := map[string]bool{}
	for _, key := range known {
		excluded[key] = true
	}
	result := map[string]any{}
	for key, value := range source {
		if !excluded[key] {
			result[key] = value
		}
	}
	return result
}
