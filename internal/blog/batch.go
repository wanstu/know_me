package blog

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"time"
)

// TaxonomyBatchEdit specifies exact tags/categories for an article, with an
// optimistic timestamp from the preview. All edits commit in one transaction.
type TaxonomyBatchEdit struct {
	ID                int64
	ExpectedUpdatedAt int64
	Tags              []string
	Categories        []string
}

func (s *Store) BatchUpdateTaxonomy(ctx context.Context, edits []TaxonomyBatchEdit) ([]Post, error) {
	if len(edits) == 0 || len(edits) > 50 {
		return nil, errors.New("invalid_batch_size")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	before := make([]Post, 0, len(edits))
	seen := map[int64]bool{}
	for _, e := range edits {
		if e.ID <= 0 || seen[e.ID] {
			return nil, errors.New("invalid_or_duplicate_post_id")
		}
		seen[e.ID] = true
		row, err := scanPostRow(tx.QueryRowContext(ctx, selectPost+" WHERE id = ? LIMIT 1", e.ID))
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("post_not_found")
		}
		if err != nil {
			return nil, err
		}
		if row.UpdatedAt != e.ExpectedUpdatedAt {
			return nil, errors.New("post_modified_since_preview")
		}
		post, err := s.mapPost(ctx, tx, row)
		if err != nil {
			return nil, err
		}
		before = append(before, post)
	}
	for idx, e := range edits {
		prior := before[idx]
		tags, categories := normalizeNames(e.Tags), normalizeNames(e.Categories)
		if slices.Equal(normalizeNames(prior.Tags), tags) && slices.Equal(normalizeNames(prior.Categories), categories) {
			continue
		}
		now := time.Now().UnixMilli()
		if now <= prior.UpdatedAt {
			now = prior.UpdatedAt + 1
		}
		metadata, _ := json.Marshal(map[string]any{
			"title": prior.Title, "slug": prior.Slug, "excerpt": prior.Excerpt,
			"status": prior.Status, "publishedAt": prior.PublishedAt,
			"firstPublishedAt": prior.FirstPublishedAt, "pinned": prior.Pinned,
			"seoTitle": prior.SEOTitle, "seoDescription": prior.SEODescription,
			"tags": prior.Tags, "categories": prior.Categories,
		})
		if _, err := tx.ExecContext(ctx, "INSERT INTO post_revisions(post_id,content_md,metadata_json,created_at) VALUES(?,?,?,?)",
			e.ID, prior.ContentMD, string(metadata), now); err != nil {
			return nil, err
		}
		if err := syncRelations(ctx, tx, e.ID, tags, categories); err != nil {
			return nil, err
		}
		result, err := tx.ExecContext(ctx, "UPDATE posts SET updated_at=? WHERE id=? AND updated_at=?", now, e.ID, prior.UpdatedAt)
		if err != nil {
			return nil, err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return nil, err
		}
		if n != 1 {
			return nil, errors.New("post_modified_since_preview")
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	out := make([]Post, 0, len(edits))
	for _, e := range edits {
		v, err := s.GetByID(ctx, e.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}
