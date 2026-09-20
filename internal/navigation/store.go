package navigation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
)

var (
	navURLPattern   = regexp.MustCompile(`(?i)^(https?:|about:|moz-extension:|chrome:|chrome-extension:|edge:|file:)`)
	iconURLPattern  = regexp.MustCompile(`(?i)^https?://`)
	browserLocalURL = regexp.MustCompile(`(?i)^(about|moz-extension|chrome|chrome-extension|edge|file):`)
)

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

type queryer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *Store) Tree(ctx context.Context, includePrivate bool) (Tree, error) {
	private := 0
	if includePrivate {
		private = 1
	}
	groupRows, err := s.db.QueryContext(ctx, `
SELECT id, external_id, name, icon, sort_order, visibility, extra_json
FROM nav_groups
WHERE (? = 1 OR visibility = 'public')
ORDER BY sort_order ASC, id ASC`, private)
	if err != nil {
		return Tree{}, err
	}
	defer groupRows.Close()

	var groups []*Group
	for groupRows.Next() {
		var g Group
		var external sql.NullString
		var extra string
		if err := groupRows.Scan(&g.ID, &external, &g.Name, &g.Icon, &g.SortOrder, &g.Visibility, &extra); err != nil {
			return Tree{}, err
		}
		if external.Valid {
			value := external.String
			g.ExternalID = &value
		}
		g.Extra = parseExtra(extra)
		g.Items = []*Item{}
		groups = append(groups, &g)
	}
	if err := groupRows.Err(); err != nil {
		return Tree{}, err
	}

	itemRows, err := s.db.QueryContext(ctx, `
SELECT id, external_id, group_id, parent_id, type, name, url, icon_url, icon_text,
       background_color, size, visit_count, sort_order, visibility, browser_local, extra_json
FROM nav_items
WHERE (? = 1 OR (visibility = 'public' AND browser_local = 0))
ORDER BY group_id ASC, parent_id ASC, sort_order ASC, id ASC`, private)
	if err != nil {
		return Tree{}, err
	}
	defer itemRows.Close()

	byID := map[int64]*Item{}
	order := make([]*Item, 0)
	for itemRows.Next() {
		item, err := scanItem(itemRows)
		if err != nil {
			return Tree{}, err
		}
		byID[item.ID] = item
		order = append(order, item)
	}
	if err := itemRows.Err(); err != nil {
		return Tree{}, err
	}

	groupItems := map[int64][]*Item{}
	for _, item := range order {
		if item.ParentID != nil {
			if parent, ok := byID[*item.ParentID]; ok {
				parent.Children = append(parent.Children, item)
				continue
			}
			if !includePrivate {
				// A public child must not be promoted to the root when its
				// parent folder is private and therefore absent from the
				// public tree.
				continue
			}
		}
		groupItems[item.GroupID] = append(groupItems[item.GroupID], item)
	}
	for _, group := range groups {
		group.Items = groupItems[group.ID]
		if group.Items == nil {
			group.Items = []*Item{}
		}
	}
	return Tree{Groups: groups}, nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanItem(row rowScanner) (*Item, error) {
	var item Item
	var external sql.NullString
	var parent sql.NullInt64
	var local int
	var extra string
	if err := row.Scan(
		&item.ID, &external, &item.GroupID, &parent, &item.Type, &item.Name, &item.URL,
		&item.IconURL, &item.IconText, &item.BackgroundColor, &item.Size, &item.VisitCount,
		&item.SortOrder, &item.Visibility, &local, &extra,
	); err != nil {
		return nil, err
	}
	if external.Valid {
		value := external.String
		item.ExternalID = &value
	}
	if parent.Valid {
		value := parent.Int64
		item.ParentID = &value
	}
	item.BrowserLocal = local == 1
	item.Extra = parseExtra(extra)
	item.Children = []*Item{}
	return &item, nil
}

func (s *Store) CreateGroup(ctx context.Context, input GroupInput) (int64, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return 0, errors.New("group_name_required")
	}
	visibility := normalizeVisibility(input.Visibility)
	sortOrder := 0
	if input.SortOrder != nil {
		sortOrder = *input.SortOrder
	} else if err := s.db.QueryRowContext(ctx, "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM nav_groups").Scan(&sortOrder); err != nil {
		return 0, err
	}
	now := time.Now().UnixMilli()
	extra, _ := json.Marshal(defaultExtra(input.Extra))
	result, err := s.db.ExecContext(ctx,
		"INSERT INTO nav_groups (external_id, name, icon, sort_order, visibility, extra_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		nullableString(input.ExternalID), name, strings.TrimSpace(input.Icon), sortOrder, visibility, string(extra), now, now,
	)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (s *Store) UpdateGroup(ctx context.Context, id int64, patch GroupPatch) (bool, error) {
	var current Group
	var external sql.NullString
	var extraJSON string
	err := s.db.QueryRowContext(ctx,
		"SELECT name, icon, visibility, external_id, sort_order, extra_json FROM nav_groups WHERE id = ?",
		id,
	).Scan(&current.Name, &current.Icon, &current.Visibility, &external, &current.SortOrder, &extraJSON)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if external.Valid {
		value := external.String
		current.ExternalID = &value
	}
	current.Extra = parseExtra(extraJSON)

	if patch.Name != nil {
		current.Name = strings.TrimSpace(*patch.Name)
		if current.Name == "" {
			return false, errors.New("group_name_required")
		}
	}
	if patch.Icon != nil {
		current.Icon = strings.TrimSpace(*patch.Icon)
	}
	if patch.Visibility != nil {
		current.Visibility = normalizeVisibility(*patch.Visibility)
	}
	if patch.ExternalID != nil {
		current.ExternalID = *patch.ExternalID
	}
	if patch.SortOrder != nil {
		current.SortOrder = *patch.SortOrder
	}
	if patch.Extra != nil {
		current.Extra = defaultExtra(*patch.Extra)
	}
	extra, _ := json.Marshal(current.Extra)
	_, err = s.db.ExecContext(ctx,
		"UPDATE nav_groups SET external_id = ?, name = ?, icon = ?, sort_order = ?, visibility = ?, extra_json = ?, updated_at = ? WHERE id = ?",
		nullableString(current.ExternalID), current.Name, current.Icon, current.SortOrder, current.Visibility, string(extra), time.Now().UnixMilli(), id,
	)
	return err == nil, err
}

func (s *Store) DeleteGroup(ctx context.Context, id int64) (bool, error) {
	result, err := s.db.ExecContext(ctx, "DELETE FROM nav_groups WHERE id = ?", id)
	if err != nil {
		return false, err
	}
	changes, _ := result.RowsAffected()
	return changes > 0, nil
}

func (s *Store) CreateItem(ctx context.Context, input ItemInput) (int64, error) {
	return createItem(ctx, s.db, input)
}

func createItem(ctx context.Context, q queryer, input ItemInput) (int64, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return 0, errors.New("item_name_required")
	}
	url := strings.TrimSpace(input.URL)
	iconURL := strings.TrimSpace(input.IconURL)
	if err := validateNavURL(url); err != nil {
		return 0, err
	}
	if err := validateIconURL(iconURL); err != nil {
		return 0, err
	}
	if err := validatePlacement(ctx, q, 0, input.GroupID, input.ParentID); err != nil {
		return 0, err
	}

	itemType := input.Type
	if itemType != ItemFolder {
		itemType = ItemLink
	}
	size := normalizeSize(input.Size)
	visibility := normalizeVisibility(input.Visibility)
	local := isBrowserLocal(url)
	if input.BrowserLocal != nil {
		local = *input.BrowserLocal
	}
	sortOrder := 0
	if input.SortOrder != nil {
		sortOrder = *input.SortOrder
	} else {
		var err error
		sortOrder, err = nextItemSort(ctx, q, input.GroupID, input.ParentID)
		if err != nil {
			return 0, err
		}
	}
	extra, _ := json.Marshal(defaultExtra(input.Extra))
	now := time.Now().UnixMilli()
	result, err := q.ExecContext(ctx, `
INSERT INTO nav_items
(external_id, group_id, parent_id, type, name, url, icon_url, icon_text, background_color, size, visit_count, sort_order, visibility, browser_local, extra_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		nullableString(input.ExternalID), input.GroupID, nullableInt64(input.ParentID), itemType, name, url,
		iconURL, strings.TrimSpace(input.IconText), strings.TrimSpace(input.BackgroundColor), size,
		input.VisitCount, sortOrder, visibility, boolInt(local), string(extra), now, now,
	)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (s *Store) UpdateItem(ctx context.Context, id int64, patch ItemPatch) (bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	updated, err := updateItem(ctx, tx, id, patch)
	if err != nil || !updated {
		return updated, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func updateItem(ctx context.Context, q queryer, id int64, patch ItemPatch) (bool, error) {
	row := q.QueryRowContext(ctx, `
SELECT id, external_id, group_id, parent_id, type, name, url, icon_url, icon_text,
       background_color, size, visit_count, sort_order, visibility, browser_local, extra_json
FROM nav_items WHERE id = ?`, id)
	current, err := scanItem(row)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	groupID := current.GroupID
	if patch.GroupID != nil {
		groupID = *patch.GroupID
	}
	parentID := current.ParentID
	if patch.ParentID != nil {
		parentID = *patch.ParentID
	}
	itemType := current.Type
	if patch.Type != nil {
		if *patch.Type == ItemFolder {
			itemType = ItemFolder
		} else {
			itemType = ItemLink
		}
	}
	name := current.Name
	if patch.Name != nil {
		name = strings.TrimSpace(*patch.Name)
	}
	if name == "" {
		return false, errors.New("item_name_required")
	}
	url := current.URL
	if patch.URL != nil {
		url = strings.TrimSpace(*patch.URL)
	}
	iconURL := current.IconURL
	if patch.IconURL != nil {
		iconURL = strings.TrimSpace(*patch.IconURL)
	}
	if err := validateNavURL(url); err != nil {
		return false, err
	}
	if err := validateIconURL(iconURL); err != nil {
		return false, err
	}
	if err := validatePlacement(ctx, q, id, groupID, parentID); err != nil {
		return false, err
	}

	if current.Type == ItemFolder && itemType != ItemFolder {
		var exists int
		err := q.QueryRowContext(ctx, "SELECT 1 FROM nav_items WHERE parent_id = ? LIMIT 1", id).Scan(&exists)
		if err == nil {
			return false, errors.New("folder_has_children")
		}
		if err != sql.ErrNoRows {
			return false, err
		}
	}

	moved := groupID != current.GroupID || !sameNullableID(parentID, current.ParentID)
	sortOrder := current.SortOrder
	if patch.SortOrder != nil {
		sortOrder = *patch.SortOrder
	} else if moved {
		sortOrder, err = nextItemSort(ctx, q, groupID, parentID)
		if err != nil {
			return false, err
		}
	}

	local := current.BrowserLocal
	if patch.URL != nil {
		local = isBrowserLocal(url)
	}
	if patch.BrowserLocal != nil {
		local = *patch.BrowserLocal
	}
	externalID := current.ExternalID
	if patch.ExternalID != nil {
		externalID = *patch.ExternalID
	}
	iconText := current.IconText
	if patch.IconText != nil {
		iconText = strings.TrimSpace(*patch.IconText)
	}
	background := current.BackgroundColor
	if patch.BackgroundColor != nil {
		background = strings.TrimSpace(*patch.BackgroundColor)
	}
	size := current.Size
	if patch.Size != nil {
		size = normalizeSize(*patch.Size)
	}
	visitCount := current.VisitCount
	if patch.VisitCount != nil {
		visitCount = *patch.VisitCount
	}
	visibility := current.Visibility
	if patch.Visibility != nil {
		visibility = normalizeVisibility(*patch.Visibility)
	}
	extra := defaultExtra(current.Extra)
	if patch.Extra != nil {
		for key, value := range defaultExtra(*patch.Extra) {
			extra[key] = value
		}
	}
	extraJSON, _ := json.Marshal(extra)

	_, err = q.ExecContext(ctx, `
UPDATE nav_items
SET external_id = ?, group_id = ?, parent_id = ?, type = ?, name = ?, url = ?, icon_url = ?, icon_text = ?,
    background_color = ?, size = ?, visit_count = ?, sort_order = ?, visibility = ?, browser_local = ?, extra_json = ?, updated_at = ?
WHERE id = ?`,
		nullableString(externalID), groupID, nullableInt64(parentID), itemType, name, url, iconURL, iconText,
		background, size, visitCount, sortOrder, visibility, boolInt(local), string(extraJSON), time.Now().UnixMilli(), id,
	)
	if err != nil {
		return false, err
	}
	if groupID != current.GroupID && current.Type == ItemFolder {
		if err := moveDescendantsToGroup(ctx, q, id, groupID); err != nil {
			return false, err
		}
	}
	return true, nil
}

func (s *Store) DeleteItem(ctx context.Context, id int64) (bool, error) {
	result, err := s.db.ExecContext(ctx, "DELETE FROM nav_items WHERE id = ?", id)
	if err != nil {
		return false, err
	}
	changes, _ := result.RowsAffected()
	return changes > 0, nil
}

func (s *Store) BulkDelete(ctx context.Context, ids []int64) (int, error) {
	roots, err := collapseDescendantSelection(ctx, s.db, ids)
	if err != nil || len(roots) == 0 {
		return 0, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	changes := 0
	for _, id := range roots {
		result, err := tx.ExecContext(ctx, "DELETE FROM nav_items WHERE id = ?", id)
		if err != nil {
			return 0, err
		}
		count, _ := result.RowsAffected()
		changes += int(count)
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return changes, nil
}

func (s *Store) BulkMove(ctx context.Context, ids []int64, groupID int64, parentID *int64) (int, error) {
	roots, err := collapseDescendantSelection(ctx, s.db, ids)
	if err != nil || len(roots) == 0 {
		return 0, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if err := ensureGroupExists(ctx, tx, groupID); err != nil {
		return 0, err
	}
	for _, id := range roots {
		var exists int
		err := tx.QueryRowContext(ctx, "SELECT 1 FROM nav_items WHERE id = ? LIMIT 1", id).Scan(&exists)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return 0, err
		}
		if err := validatePlacement(ctx, tx, id, groupID, parentID); err != nil {
			return 0, err
		}
	}
	moved := 0
	for _, id := range roots {
		g := groupID
		p := parentID
		ok, err := updateItem(ctx, tx, id, ItemPatch{GroupID: &g, ParentID: &p})
		if err != nil {
			return 0, err
		}
		if ok {
			moved++
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return moved, nil
}

func (s *Store) MoveItem(ctx context.Context, id, groupID int64, parentID *int64, index int) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := validatePlacement(ctx, tx, id, groupID, parentID); err != nil {
		return err
	}
	g := groupID
	p := parentID
	updated, err := updateItem(ctx, tx, id, ItemPatch{GroupID: &g, ParentID: &p})
	if err != nil {
		return err
	}
	if !updated {
		return errors.New("item_not_found")
	}
	rows, err := tx.QueryContext(ctx,
		"SELECT id FROM nav_items WHERE group_id = ? AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?) ORDER BY sort_order ASC, id ASC",
		groupID, nullableInt64(parentID), nullableInt64(parentID),
	)
	if err != nil {
		return err
	}
	ids := []int64{}
	for rows.Next() {
		var siblingID int64
		if err := rows.Scan(&siblingID); err != nil {
			rows.Close()
			return err
		}
		if siblingID != id {
			ids = append(ids, siblingID)
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if index < 0 {
		index = 0
	}
	if index > len(ids) {
		index = len(ids)
	}
	ids = append(ids, 0)
	copy(ids[index+1:], ids[index:])
	ids[index] = id
	now := time.Now().UnixMilli()
	for order, siblingID := range ids {
		if _, err := tx.ExecContext(ctx,
			"UPDATE nav_items SET group_id = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?",
			groupID, nullableInt64(parentID), order, now, siblingID,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ReorderGroups(ctx context.Context, ids []int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().UnixMilli()
	for index, id := range ids {
		if _, err := tx.ExecContext(ctx, "UPDATE nav_groups SET sort_order = ?, updated_at = ? WHERE id = ?", index, now, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ReorderItems(ctx context.Context, groupID int64, parentID *int64, ids []int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().UnixMilli()
	for index, id := range ids {
		if _, err := tx.ExecContext(ctx,
			"UPDATE nav_items SET group_id = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?",
			groupID, nullableInt64(parentID), index, now, id,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) IncrementVisit(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, "UPDATE nav_items SET visit_count = visit_count + 1, updated_at = ? WHERE id = ?", time.Now().UnixMilli(), id)
	return err
}

func collapseDescendantSelection(ctx context.Context, q queryer, ids []int64) ([]int64, error) {
	selected := map[int64]bool{}
	for _, id := range ids {
		if id > 0 {
			selected[id] = true
		}
	}
	roots := make([]int64, 0, len(selected))
	for id := range selected {
		var parent sql.NullInt64
		err := q.QueryRowContext(ctx, "SELECT parent_id FROM nav_items WHERE id = ? LIMIT 1", id).Scan(&parent)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, err
		}
		nested := false
		for parent.Valid {
			if selected[parent.Int64] {
				nested = true
				break
			}
			err := q.QueryRowContext(ctx, "SELECT parent_id FROM nav_items WHERE id = ? LIMIT 1", parent.Int64).Scan(&parent)
			if err == sql.ErrNoRows {
				parent = sql.NullInt64{}
				break
			}
			if err != nil {
				return nil, err
			}
		}
		if !nested {
			roots = append(roots, id)
		}
	}
	return roots, nil
}

func validatePlacement(ctx context.Context, q queryer, itemID, groupID int64, parentID *int64) error {
	if err := ensureGroupExists(ctx, q, groupID); err != nil {
		return err
	}
	if parentID == nil {
		return nil
	}
	cursor := *parentID
	first := true
	for cursor > 0 {
		if itemID > 0 && cursor == itemID {
			return errors.New("navigation_cycle")
		}
		var rowGroup int64
		var parent sql.NullInt64
		var itemType ItemType
		err := q.QueryRowContext(ctx,
			"SELECT group_id, parent_id, type FROM nav_items WHERE id = ? LIMIT 1",
			cursor,
		).Scan(&rowGroup, &parent, &itemType)
		if err == sql.ErrNoRows {
			return errors.New("parent_not_found")
		}
		if err != nil {
			return err
		}
		if rowGroup != groupID {
			return errors.New("parent_group_mismatch")
		}
		if first && itemType != ItemFolder {
			return errors.New("parent_not_folder")
		}
		first = false
		if !parent.Valid {
			break
		}
		cursor = parent.Int64
	}
	return nil
}

func ensureGroupExists(ctx context.Context, q queryer, groupID int64) error {
	var exists int
	err := q.QueryRowContext(ctx, "SELECT 1 FROM nav_groups WHERE id = ? LIMIT 1", groupID).Scan(&exists)
	if err == sql.ErrNoRows {
		return errors.New("group_not_found")
	}
	return err
}

func nextItemSort(ctx context.Context, q queryer, groupID int64, parentID *int64) (int, error) {
	var value int
	err := q.QueryRowContext(ctx,
		"SELECT COALESCE(MAX(sort_order), -1) + 1 FROM nav_items WHERE group_id = ? AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)",
		groupID, nullableInt64(parentID), nullableInt64(parentID),
	).Scan(&value)
	return value, err
}

func moveDescendantsToGroup(ctx context.Context, q queryer, itemID, groupID int64) error {
	_, err := q.ExecContext(ctx, `
WITH RECURSIVE descendants(id) AS (
  SELECT id FROM nav_items WHERE parent_id = ?
  UNION ALL
  SELECT nav_items.id FROM nav_items JOIN descendants ON nav_items.parent_id = descendants.id
)
UPDATE nav_items SET group_id = ?, updated_at = ? WHERE id IN (SELECT id FROM descendants)`,
		itemID, groupID, time.Now().UnixMilli(),
	)
	return err
}

func validateNavURL(value string) error {
	value = strings.TrimSpace(value)
	if value == "" || navURLPattern.MatchString(value) {
		return nil
	}
	return errors.New("unsupported_nav_url")
}

func validateIconURL(value string) error {
	value = strings.TrimSpace(value)
	if value == "" || iconURLPattern.MatchString(value) || strings.HasPrefix(value, "/media/") {
		return nil
	}
	return errors.New("unsupported_icon_url")
}

func isBrowserLocal(value string) bool {
	return browserLocalURL.MatchString(strings.TrimSpace(value))
}

func normalizeVisibility(value Visibility) Visibility {
	if value == VisibilityPublic {
		return VisibilityPublic
	}
	return VisibilityPrivate
}

func normalizeSize(value ItemSize) ItemSize {
	switch value {
	case Size2x1, Size2x2:
		return value
	default:
		return Size1x1
	}
}

func parseExtra(value string) map[string]any {
	var result map[string]any
	if err := json.Unmarshal([]byte(value), &result); err != nil || result == nil {
		return map[string]any{}
	}
	return result
}

func defaultExtra(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableInt64(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func sameNullableID(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
