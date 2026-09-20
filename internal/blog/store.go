package blog

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

type Store struct{ db *sql.DB }

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

const selectPost = "SELECT id, slug, title, excerpt, content_md, status, pinned, seo_title, seo_description, published_at, created_at, updated_at FROM posts"

type dbq interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type postRow struct {
	ID             int64
	Slug           string
	Title          string
	Excerpt        string
	ContentMD      string
	Status         Status
	Pinned         int
	SEOTitle       string
	SEODescription string
	PublishedAt    sql.NullInt64
	CreatedAt      int64
	UpdatedAt      int64
}

type rowScanner interface{ Scan(...any) error }

func scanPostRow(scanner rowScanner) (postRow, error) {
	var row postRow
	err := scanner.Scan(
		&row.ID, &row.Slug, &row.Title, &row.Excerpt, &row.ContentMD, &row.Status,
		&row.Pinned, &row.SEOTitle, &row.SEODescription, &row.PublishedAt, &row.CreatedAt, &row.UpdatedAt,
	)
	return row, err
}

func (s *Store) mapPost(ctx context.Context, q dbq, row postRow) (Post, error) {
	post := Post{
		ID: row.ID, Slug: row.Slug, Title: row.Title, Excerpt: row.Excerpt, ContentMD: row.ContentMD,
		Status: row.Status, Pinned: row.Pinned == 1, SEOTitle: row.SEOTitle, SEODescription: row.SEODescription,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, Tags: []string{}, Categories: []string{},
	}
	if row.PublishedAt.Valid {
		value := row.PublishedAt.Int64
		post.PublishedAt = &value
	}
	var err error
	post.Tags, err = relationNames(ctx, q, "tags", "post_tags", "tag_id", row.ID)
	if err != nil {
		return Post{}, err
	}
	post.Categories, err = relationNames(ctx, q, "categories", "post_categories", "category_id", row.ID)
	if err != nil {
		return Post{}, err
	}
	return post, nil
}

func relationNames(ctx context.Context, q dbq, table, joinTable, foreignKey string, postID int64) ([]string, error) {
	query := fmt.Sprintf(
		"SELECT %s.name FROM %s JOIN %s ON %s.%s = %s.id WHERE %s.post_id = ? ORDER BY %s.name",
		table, table, joinTable, joinTable, foreignKey, table, joinTable, table,
	)
	rows, err := q.QueryContext(ctx, query, postID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		result = append(result, name)
	}
	return result, rows.Err()
}

func (s *Store) Save(ctx context.Context, input SaveInput, id *int64) (Post, error) {
	title := strings.TrimSpace(input.Title)
	if title == "" {
		return Post{}, errors.New("title_required")
	}
	input.Status = normalizeStatus(input.Status)
	now := time.Now().UnixMilli()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Post{}, err
	}
	defer tx.Rollback()

	var existing *postRow
	if id != nil {
		row, err := scanPostRow(tx.QueryRowContext(ctx, selectPost+" WHERE id = ? LIMIT 1", *id))
		if err == sql.ErrNoRows {
			return Post{}, errors.New("post_not_found")
		}
		if err != nil {
			return Post{}, err
		}
		existing = &row
	}

	requested := strings.TrimSpace(input.Slug)
	if requested == "" {
		requested = title
	}
	slug, err := uniqueSlug(ctx, tx, requested, id)
	if err != nil {
		return Post{}, err
	}

	excerpt := strings.TrimSpace(input.Excerpt)
	if excerpt == "" {
		excerpt = ExcerptFrom(input.ContentMD)
	}

	publishedAt := input.PublishedAt
	if publishedAt == nil && existing != nil && existing.PublishedAt.Valid && input.Status == existing.Status {
		value := existing.PublishedAt.Int64
		publishedAt = &value
	}
	if input.Status == StatusPublished && publishedAt == nil {
		value := now
		publishedAt = &value
	}
	if input.Status == StatusScheduled && publishedAt == nil {
		return Post{}, errors.New("scheduled_time_required")
	}
	if input.Status == StatusDraft {
		publishedAt = nil
	}

	var postID int64
	if existing != nil && id != nil {
		if existing.ContentMD != input.ContentMD || existing.Title != title {
			metadata, _ := json.Marshal(map[string]any{
				"title": existing.Title, "slug": existing.Slug, "excerpt": existing.Excerpt,
				"status": existing.Status, "publishedAt": nullableNullInt(existing.PublishedAt),
			})
			if _, err := tx.ExecContext(ctx,
				"INSERT INTO post_revisions (post_id, content_md, metadata_json, created_at) VALUES (?, ?, ?, ?)",
				*id, existing.ContentMD, string(metadata), now,
			); err != nil {
				return Post{}, err
			}
		}
		_, err = tx.ExecContext(ctx,
			"UPDATE posts SET slug = ?, title = ?, excerpt = ?, content_md = ?, status = ?, pinned = ?, seo_title = ?, seo_description = ?, published_at = ?, updated_at = ? WHERE id = ?",
			slug, title, excerpt, input.ContentMD, input.Status, boolInt(input.Pinned),
			strings.TrimSpace(input.SEOTitle), strings.TrimSpace(input.SEODescription), nullableInt(input.PublishedAt, publishedAt), now, *id,
		)
		if err != nil {
			return Post{}, err
		}
		postID = *id
	} else {
		result, err := tx.ExecContext(ctx,
			"INSERT INTO posts (slug, title, excerpt, content_md, status, pinned, seo_title, seo_description, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			slug, title, excerpt, input.ContentMD, input.Status, boolInt(input.Pinned),
			strings.TrimSpace(input.SEOTitle), strings.TrimSpace(input.SEODescription), ptrValue(publishedAt), now, now,
		)
		if err != nil {
			return Post{}, err
		}
		postID, err = result.LastInsertId()
		if err != nil {
			return Post{}, err
		}
	}

	if err := syncRelations(ctx, tx, postID, input.Tags, input.Categories); err != nil {
		return Post{}, err
	}
	if err := syncFTS(ctx, tx, postID, title, excerpt, input.ContentMD); err != nil {
		return Post{}, err
	}
	if err := tx.Commit(); err != nil {
		return Post{}, err
	}
	return s.GetByID(ctx, postID)
}

func (s *Store) Delete(ctx context.Context, id int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "DELETE FROM posts_fts WHERE rowid = ?", id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM posts WHERE id = ?", id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) GetByID(ctx context.Context, id int64) (Post, error) {
	row, err := scanPostRow(s.db.QueryRowContext(ctx, selectPost+" WHERE id = ? LIMIT 1", id))
	if err == sql.ErrNoRows {
		return Post{}, errors.New("post_not_found")
	}
	if err != nil {
		return Post{}, err
	}
	return s.mapPost(ctx, s.db, row)
}

func (s *Store) PublishedNeighbors(ctx context.Context, slug string) (*Post, *Post, error) {
	current, err := s.GetPublishedBySlug(ctx, slug)
	if err != nil {
		return nil, nil, err
	}
	if current.PublishedAt == nil {
		return nil, nil, nil
	}
	now := time.Now().UnixMilli()
	publishedAt := *current.PublishedAt
	lookup := func(operator, order string) (*Post, error) {
		query := selectPost + " WHERE (status = 'published' OR (status = 'scheduled' AND published_at <= ?)) AND " +
			"((published_at " + operator + " ?) OR (published_at = ? AND id " + operator + " ?)) ORDER BY published_at " + order + ", id " + order + " LIMIT 1"
		row, err := scanPostRow(s.db.QueryRowContext(ctx, query, now, publishedAt, publishedAt, current.ID))
		if err == sql.ErrNoRows {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		post, err := s.mapPost(ctx, s.db, row)
		if err != nil {
			return nil, err
		}
		return &post, nil
	}
	previous, err := lookup("<", "DESC")
	if err != nil {
		return nil, nil, err
	}
	next, err := lookup(">", "ASC")
	if err != nil {
		return nil, nil, err
	}
	return previous, next, nil
}

func (s *Store) GetPublishedBySlug(ctx context.Context, slug string) (Post, error) {
	now := time.Now().UnixMilli()
	row, err := scanPostRow(s.db.QueryRowContext(ctx,
		selectPost+" WHERE slug = ? AND (status = 'published' OR (status = 'scheduled' AND published_at <= ?)) LIMIT 1",
		slug, now,
	))
	if err == sql.ErrNoRows {
		return Post{}, errors.New("post_not_found")
	}
	if err != nil {
		return Post{}, err
	}
	return s.mapPost(ctx, s.db, row)
}

func (s *Store) ListAdmin(ctx context.Context) ([]Post, error) {
	return s.listRows(ctx, s.db, selectPost+" ORDER BY updated_at DESC, id DESC")
}

func (s *Store) ListPublished(ctx context.Context, query string, limit int) ([]Post, error) {
	if limit <= 0 {
		limit = 30
	}
	if limit > 200 {
		limit = 200
	}
	now := time.Now().UnixMilli()
	query = strings.TrimSpace(query)
	if query != "" {
		match := ftsQuery(query)
		ftsSQL := "SELECT posts.id, posts.slug, posts.title, posts.excerpt, posts.content_md, posts.status, posts.pinned, posts.seo_title, posts.seo_description, posts.published_at, posts.created_at, posts.updated_at FROM posts JOIN posts_fts ON posts_fts.rowid = posts.id WHERE posts_fts MATCH ? AND (posts.status = 'published' OR (posts.status = 'scheduled' AND posts.published_at <= ?)) ORDER BY posts.pinned DESC, bm25(posts_fts), posts.published_at DESC, posts.id DESC LIMIT ?"
		if posts, err := s.listRows(ctx, s.db, ftsSQL, match, now, limit); err == nil {
			return posts, nil
		}
		like := "%" + query + "%"
		return s.listRows(ctx, s.db,
			selectPost+" WHERE (title LIKE ? OR excerpt LIKE ? OR content_md LIKE ?) AND (status = 'published' OR (status = 'scheduled' AND published_at <= ?)) ORDER BY pinned DESC, published_at DESC, id DESC LIMIT ?",
			like, like, like, now, limit,
		)
	}
	return s.listRows(ctx, s.db,
		selectPost+" WHERE (status = 'published' OR (status = 'scheduled' AND published_at <= ?)) ORDER BY pinned DESC, published_at DESC, id DESC LIMIT ?",
		now, limit,
	)
}

func (s *Store) FilterPublishedPage(ctx context.Context, query, tag, category, year string, page, limit int) ([]Post, int, int, error) {
	if page <= 0 {
		page = 1
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	now := time.Now().UnixMilli()
	clauses := []string{"(status = 'published' OR (status = 'scheduled' AND published_at <= ?))"}
	args := []any{now}
	query = strings.TrimSpace(query)
	if query != "" {
		like := "%" + query + "%"
		clauses = append(clauses, "(title LIKE ? OR excerpt LIKE ? OR content_md LIKE ?)")
		args = append(args, like, like, like)
	}
	tag = strings.TrimSpace(tag)
	if tag != "" {
		clauses = append(clauses, "EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = posts.id AND lower(t.name) = lower(?))")
		args = append(args, tag)
	}
	category = strings.TrimSpace(category)
	if category != "" {
		clauses = append(clauses, "EXISTS (SELECT 1 FROM post_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.post_id = posts.id AND lower(c.name) = lower(?))")
		args = append(args, category)
	}
	year = strings.TrimSpace(year)
	if year != "" {
		clauses = append(clauses, "strftime('%Y', published_at / 1000, 'unixepoch', 'localtime') = ?")
		args = append(args, year)
	}
	where := strings.Join(clauses, " AND ")
	var total int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM posts WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, page, err
	}
	if total == 0 {
		page = 1
	} else {
		totalPages := (total + limit - 1) / limit
		if page > totalPages {
			page = totalPages
		}
	}
	offset := (page - 1) * limit
	selectArgs := append(append([]any{}, args...), limit, offset)
	posts, err := s.listRows(ctx, s.db,
		selectPost+" WHERE "+where+" ORDER BY pinned DESC, published_at DESC, id DESC LIMIT ? OFFSET ?",
		selectArgs...,
	)
	if err != nil {
		return nil, 0, page, err
	}
	return posts, total, page, nil
}

func (s *Store) FilterPublished(ctx context.Context, query, tag, category, year string, limit int) ([]Post, error) {
	if limit <= 0 {
		limit = 30
	}
	fetch := limit
	if strings.TrimSpace(tag) != "" || strings.TrimSpace(category) != "" || strings.TrimSpace(year) != "" {
		fetch = 200
	}
	posts, err := s.ListPublished(ctx, query, fetch)
	if err != nil {
		return nil, err
	}
	tag = strings.ToLower(strings.TrimSpace(tag))
	category = strings.ToLower(strings.TrimSpace(category))
	year = strings.TrimSpace(year)
	filtered := make([]Post, 0, len(posts))
	for _, post := range posts {
		if tag != "" && !containsFold(post.Tags, tag) {
			continue
		}
		if category != "" && !containsFold(post.Categories, category) {
			continue
		}
		if year != "" {
			if post.PublishedAt == nil || time.UnixMilli(*post.PublishedAt).Format("2006") != year {
				continue
			}
		}
		filtered = append(filtered, post)
		if len(filtered) >= limit {
			break
		}
	}
	return filtered, nil
}

func (s *Store) listRows(ctx context.Context, q dbq, query string, args ...any) ([]Post, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	raw := []postRow{}
	for rows.Next() {
		row, err := scanPostRow(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		raw = append(raw, row)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	result := make([]Post, 0, len(raw))
	for _, row := range raw {
		post, err := s.mapPost(ctx, q, row)
		if err != nil {
			return nil, err
		}
		result = append(result, post)
	}
	return result, nil
}

func (s *Store) ListRevisions(ctx context.Context, postID int64, limit int) ([]Revision, error) {
	if limit <= 0 || limit > 50 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx,
		"SELECT id, post_id, content_md, metadata_json, created_at FROM post_revisions WHERE post_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
		postID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Revision{}
	for rows.Next() {
		var revision Revision
		var metadata string
		if err := rows.Scan(&revision.ID, &revision.PostID, &revision.ContentMD, &metadata, &revision.CreatedAt); err != nil {
			return nil, err
		}
		revision.Metadata = map[string]any{}
		_ = json.Unmarshal([]byte(metadata), &revision.Metadata)
		result = append(result, revision)
	}
	return result, rows.Err()
}

func (s *Store) RestoreRevision(ctx context.Context, postID, revisionID int64) (Post, error) {
	current, err := s.GetByID(ctx, postID)
	if err != nil {
		return Post{}, err
	}
	var content, metadataJSON string
	err = s.db.QueryRowContext(ctx,
		"SELECT content_md, metadata_json FROM post_revisions WHERE id = ? AND post_id = ? LIMIT 1",
		revisionID, postID,
	).Scan(&content, &metadataJSON)
	if err == sql.ErrNoRows {
		return Post{}, errors.New("revision_not_found")
	}
	if err != nil {
		return Post{}, err
	}

	metadata := map[string]any{}
	_ = json.Unmarshal([]byte(metadataJSON), &metadata)
	status := StatusDraft
	if raw, ok := metadata["status"].(string); ok && (Status(raw) == StatusPublished || Status(raw) == StatusScheduled) {
		status = Status(raw)
	}
	var publishedAt *int64
	if number, ok := metadata["publishedAt"].(float64); ok {
		value := int64(number)
		publishedAt = &value
	}
	title := current.Title
	if value, ok := metadata["title"].(string); ok {
		title = value
	}
	slug := current.Slug
	if value, ok := metadata["slug"].(string); ok {
		slug = value
	}
	excerpt := current.Excerpt
	if value, ok := metadata["excerpt"].(string); ok {
		excerpt = value
	}
	id := postID
	return s.Save(ctx, SaveInput{
		Title: title, Slug: slug, Excerpt: excerpt, ContentMD: content, Status: status,
		Pinned: current.Pinned, SEOTitle: current.SEOTitle, SEODescription: current.SEODescription,
		PublishedAt: publishedAt, Tags: current.Tags, Categories: current.Categories,
	}, &id)
}

func uniqueSlug(ctx context.Context, q dbq, requested string, exceptID *int64) (string, error) {
	base := NormalizeSlug(requested)
	value := base
	for index := 2; ; index++ {
		var found int64
		err := q.QueryRowContext(ctx, "SELECT id FROM posts WHERE slug = ? AND (? IS NULL OR id != ?) LIMIT 1", value, ptrValue(exceptID), ptrValue(exceptID)).Scan(&found)
		if err == sql.ErrNoRows {
			return value, nil
		}
		if err != nil {
			return "", err
		}
		value = fmt.Sprintf("%s-%d", base, index)
	}
}

func syncRelations(ctx context.Context, q dbq, postID int64, tags, categories []string) error {
	if tags != nil {
		if _, err := q.ExecContext(ctx, "DELETE FROM post_tags WHERE post_id = ?", postID); err != nil {
			return err
		}
		for _, name := range normalizeNames(tags) {
			id, err := ensureTaxonomy(ctx, q, TaxonomyTag, name)
			if err != nil {
				return err
			}
			if _, err := q.ExecContext(ctx, "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)", postID, id); err != nil {
				return err
			}
		}
	}
	if categories != nil {
		if _, err := q.ExecContext(ctx, "DELETE FROM post_categories WHERE post_id = ?", postID); err != nil {
			return err
		}
		for _, name := range normalizeNames(categories) {
			id, err := ensureTaxonomy(ctx, q, TaxonomyCategory, name)
			if err != nil {
				return err
			}
			if _, err := q.ExecContext(ctx, "INSERT OR IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)", postID, id); err != nil {
				return err
			}
		}
	}
	return nil
}

func syncFTS(ctx context.Context, q dbq, postID int64, title, excerpt, contentMD string) error {
	if _, err := q.ExecContext(ctx, "DELETE FROM posts_fts WHERE rowid = ?", postID); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, "INSERT INTO posts_fts (rowid, title, excerpt, content_text) VALUES (?, ?, ?, ?)", postID, title, excerpt, MarkdownToText(contentMD))
	return err
}

func normalizeNames(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		key := strings.ToLower(value)
		if value == "" || seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, value)
		if len(result) >= 30 {
			break
		}
	}
	sort.Strings(result)
	return result
}

func ftsQuery(query string) string {
	parts := strings.Fields(query)
	if len(parts) > 8 {
		parts = parts[:8]
	}
	quoted := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.ReplaceAll(part, "\"", "\"\"")
		quoted = append(quoted, "\""+part+"\"*")
	}
	return strings.Join(quoted, " AND ")
}

func containsFold(values []string, target string) bool {
	for _, value := range values {
		if strings.ToLower(value) == target {
			return true
		}
	}
	return false
}

func normalizeStatus(value Status) Status {
	switch value {
	case StatusPublished, StatusScheduled:
		return value
	default:
		return StatusDraft
	}
}

func nullableNullInt(value sql.NullInt64) any {
	if value.Valid {
		return value.Int64
	}
	return nil
}

func nullableInt(_ *int64, value *int64) any { return ptrValue(value) }

func ptrValue(value *int64) any {
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
