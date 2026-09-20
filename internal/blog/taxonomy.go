package blog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (s *Store) ListTaxonomyDetails(ctx context.Context) (TaxonomyDetails, error) {
	tags, err := taxonomyDetails(ctx, s.db, TaxonomyTag)
	if err != nil {
		return TaxonomyDetails{}, err
	}
	categories, err := taxonomyDetails(ctx, s.db, TaxonomyCategory)
	if err != nil {
		return TaxonomyDetails{}, err
	}
	return TaxonomyDetails{Tags: tags, Categories: categories}, nil
}

func (s *Store) ListTaxonomy(ctx context.Context) (map[string][]string, error) {
	result := map[string][]string{"tags": {}, "categories": {}}
	now := time.Now().UnixMilli()
	for _, pair := range []struct {
		key, table, join, foreign string
	}{
		{"tags", "tags", "post_tags", "tag_id"},
		{"categories", "categories", "post_categories", "category_id"},
	} {
		query := fmt.Sprintf(
			"SELECT DISTINCT x.name FROM %s x JOIN %s rel ON rel.%s = x.id JOIN posts p ON p.id = rel.post_id WHERE (p.status = 'published' OR (p.status = 'scheduled' AND p.published_at <= ?)) ORDER BY x.name",
			pair.table, pair.join, pair.foreign,
		)
		rows, err := s.db.QueryContext(ctx, query, now)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				rows.Close()
				return nil, err
			}
			result[pair.key] = append(result[pair.key], name)
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (s *Store) CreateTaxonomy(ctx context.Context, kind TaxonomyKind, name string) (int64, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return 0, errors.New("taxonomy_name_required")
	}
	table, _, _ := taxonomyMeta(kind)
	var id int64
	err := s.db.QueryRowContext(ctx, "SELECT id FROM "+table+" WHERE name = ? COLLATE NOCASE LIMIT 1", name).Scan(&id)
	if err == nil {
		return 0, errors.New("taxonomy_name_exists")
	}
	if err != sql.ErrNoRows {
		return 0, err
	}
	return ensureTaxonomy(ctx, s.db, kind, name)
}

func (s *Store) RenameTaxonomy(ctx context.Context, kind TaxonomyKind, id int64, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("taxonomy_name_required")
	}
	table, _, _ := taxonomyMeta(kind)

	var current string
	err := s.db.QueryRowContext(ctx, "SELECT name FROM "+table+" WHERE id = ? LIMIT 1", id).Scan(&current)
	if err == sql.ErrNoRows {
		return errors.New("taxonomy_not_found")
	}
	if err != nil {
		return err
	}

	var duplicate int64
	err = s.db.QueryRowContext(ctx, "SELECT id FROM "+table+" WHERE name = ? COLLATE NOCASE AND id != ? LIMIT 1", name, id).Scan(&duplicate)
	if err == nil {
		return errors.New("taxonomy_name_exists")
	}
	if err != sql.ErrNoRows {
		return err
	}

	slug, err := uniqueTaxonomySlug(ctx, s.db, table, name, &id)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, "UPDATE "+table+" SET name = ?, slug = ?, updated_at = ? WHERE id = ?", name, slug, time.Now().UnixMilli(), id)
	return err
}

func (s *Store) MergeTaxonomy(ctx context.Context, kind TaxonomyKind, sourceID, targetID int64) error {
	if sourceID <= 0 || targetID <= 0 || sourceID == targetID {
		return errors.New("invalid_taxonomy_merge")
	}
	table, join, foreign := taxonomyMeta(kind)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, id := range []int64{sourceID, targetID} {
		var exists int
		err := tx.QueryRowContext(ctx, "SELECT 1 FROM "+table+" WHERE id = ? LIMIT 1", id).Scan(&exists)
		if err == sql.ErrNoRows {
			return errors.New("taxonomy_not_found")
		}
		if err != nil {
			return err
		}
	}

	query := fmt.Sprintf(
		"INSERT OR IGNORE INTO %s (post_id, %s) SELECT post_id, ? FROM %s WHERE %s = ?",
		join, foreign, join, foreign,
	)
	if _, err := tx.ExecContext(ctx, query, targetID, sourceID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM "+join+" WHERE "+foreign+" = ?", sourceID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE id = ?", sourceID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteTaxonomy(ctx context.Context, kind TaxonomyKind, id int64) (bool, error) {
	table, _, _ := taxonomyMeta(kind)
	result, err := s.db.ExecContext(ctx, "DELETE FROM "+table+" WHERE id = ?", id)
	if err != nil {
		return false, err
	}
	changes, _ := result.RowsAffected()
	return changes > 0, nil
}

func (s *Store) ArchiveCounts(ctx context.Context) ([]ArchiveCount, error) {
	now := time.Now().UnixMilli()
	rows, err := s.db.QueryContext(ctx, "SELECT strftime('%Y', published_at / 1000, 'unixepoch', 'localtime') AS year, COUNT(*) FROM posts WHERE published_at IS NOT NULL AND (status = 'published' OR (status = 'scheduled' AND published_at <= ?)) GROUP BY year ORDER BY year DESC", now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []ArchiveCount{}
	for rows.Next() {
		var item ArchiveCount
		if err := rows.Scan(&item.Year, &item.Count); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func taxonomyDetails(ctx context.Context, q dbq, kind TaxonomyKind) ([]TaxonomyDetail, error) {
	table, join, foreign := taxonomyMeta(kind)
	query := fmt.Sprintf(
		"SELECT %s.id, %s.name, %s.slug, COUNT(%s.post_id) FROM %s LEFT JOIN %s ON %s.%s = %s.id GROUP BY %s.id ORDER BY %s.name",
		table, table, table, join, table, join, join, foreign, table, table, table,
	)
	rows, err := q.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []TaxonomyDetail{}
	for rows.Next() {
		var item TaxonomyDetail
		if err := rows.Scan(&item.ID, &item.Name, &item.Slug, &item.Count); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func ensureTaxonomy(ctx context.Context, q dbq, kind TaxonomyKind, name string) (int64, error) {
	table, _, _ := taxonomyMeta(kind)
	var id int64
	err := q.QueryRowContext(ctx, "SELECT id FROM "+table+" WHERE name = ? COLLATE NOCASE LIMIT 1", name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != sql.ErrNoRows {
		return 0, err
	}

	slug, err := uniqueTaxonomySlug(ctx, q, table, name, nil)
	if err != nil {
		return 0, err
	}
	now := time.Now().UnixMilli()
	var result sql.Result
	if kind == TaxonomyCategory {
		result, err = q.ExecContext(ctx, "INSERT INTO categories (slug, name, description, created_at, updated_at) VALUES (?, ?, '', ?, ?)", slug, name, now, now)
	} else {
		result, err = q.ExecContext(ctx, "INSERT INTO tags (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)", slug, name, now, now)
	}
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func uniqueTaxonomySlug(ctx context.Context, q dbq, table, name string, exceptID *int64) (string, error) {
	base := NormalizeSlug(name)
	value := base
	for index := 2; ; index++ {
		var found int64
		err := q.QueryRowContext(ctx, "SELECT id FROM "+table+" WHERE slug = ? AND (? IS NULL OR id != ?) LIMIT 1", value, ptrValue(exceptID), ptrValue(exceptID)).Scan(&found)
		if err == sql.ErrNoRows {
			return value, nil
		}
		if err != nil {
			return "", err
		}
		value = fmt.Sprintf("%s-%d", base, index)
	}
}

func taxonomyMeta(kind TaxonomyKind) (table, join, foreign string) {
	if kind == TaxonomyCategory {
		return "categories", "post_categories", "category_id"
	}
	return "tags", "post_tags", "tag_id"
}
