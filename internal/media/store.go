package media

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const MaxBytes = 10 * 1024 * 1024

var allowedTypes = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/webp": "webp",
	"image/gif":  "gif",
}

type Record struct {
	ID           int64  `json:"id"`
	StorageKey   string `json:"storageKey"`
	OriginalName string `json:"originalName"`
	MIME         string `json:"mime"`
	Size         int64  `json:"size"`
	Alt          string `json:"alt"`
	CreatedAt    int64  `json:"createdAt"`
	URL          string `json:"url"`
}

type Store struct {
	db   *sql.DB
	root string
}

func NewStore(db *sql.DB, uploadsDir string) (*Store, error) {
	root, err := filepath.Abs(filepath.Clean(uploadsDir))
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	return &Store{db: db, root: root}, nil
}

func (s *Store) Save(ctx context.Context, originalName, mime string, bytes []byte, alt string) (Record, error) {
	ext, ok := allowedTypes[mime]
	if !ok {
		return Record{}, errors.New("unsupported_media_type")
	}
	if len(bytes) <= 0 || len(bytes) > MaxBytes {
		return Record{}, errors.New("media_size_invalid")
	}

	now := time.Now()
	random, err := randomHex(16)
	if err != nil {
		return Record{}, err
	}
	key := fmt.Sprintf("%04d/%02d/%s.%s", now.Year(), now.Month(), random, ext)
	path, err := s.FilePath(key)
	if err != nil {
		return Record{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return Record{}, err
	}
	if err := os.WriteFile(path, bytes, 0o644); err != nil {
		return Record{}, err
	}

	createdAt := now.UnixMilli()
	result, err := s.db.ExecContext(ctx,
		"INSERT INTO media (storage_key, original_name, mime, width, height, size, alt, created_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)",
		key, truncate(strings.TrimSpace(originalName), 240), mime, len(bytes), truncate(strings.TrimSpace(alt), 500), createdAt,
	)
	if err != nil {
		_ = os.Remove(path)
		return Record{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return Record{}, err
	}
	return s.GetByID(ctx, id)
}

func (s *Store) List(ctx context.Context, limit int) ([]Record, error) {
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := s.db.QueryContext(ctx,
		"SELECT id, storage_key, original_name, mime, size, alt, created_at FROM media ORDER BY created_at DESC LIMIT ?",
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Record{}
	for rows.Next() {
		item, err := scan(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) GetByID(ctx context.Context, id int64) (Record, error) {
	item, err := scan(s.db.QueryRowContext(ctx,
		"SELECT id, storage_key, original_name, mime, size, alt, created_at FROM media WHERE id = ? LIMIT 1", id))
	if err == sql.ErrNoRows {
		return Record{}, errors.New("media_not_found")
	}
	return item, err
}

func (s *Store) GetByStorageKey(ctx context.Context, key string) (Record, error) {
	item, err := scan(s.db.QueryRowContext(ctx,
		"SELECT id, storage_key, original_name, mime, size, alt, created_at FROM media WHERE storage_key = ? LIMIT 1", key))
	if err == sql.ErrNoRows {
		return Record{}, errors.New("media_not_found")
	}
	return item, err
}

func (s *Store) Delete(ctx context.Context, id int64) (bool, error) {
	item, err := s.GetByID(ctx, id)
	if err != nil {
		if err.Error() == "media_not_found" {
			return false, nil
		}
		return false, err
	}
	result, err := s.db.ExecContext(ctx, "DELETE FROM media WHERE id = ?", id)
	if err != nil {
		return false, err
	}
	changes, _ := result.RowsAffected()
	if path, pathErr := s.FilePath(item.StorageKey); pathErr == nil {
		_ = os.Remove(path)
	}
	return changes > 0, nil
}

func (s *Store) FilePath(storageKey string) (string, error) {
	normalized := strings.ReplaceAll(storageKey, "\\", "/")
	if normalized == "" || strings.HasPrefix(normalized, "/") || strings.Contains(normalized, "\x00") {
		return "", errors.New("invalid_storage_key")
	}
	parts := strings.Split(normalized, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return "", errors.New("invalid_storage_key")
		}
	}
	full := filepath.Join(append([]string{s.root}, parts...)...)
	abs, err := filepath.Abs(full)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(s.root, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("invalid_storage_key")
	}
	return abs, nil
}

func PublicURL(storageKey string) string {
	parts := strings.Split(strings.ReplaceAll(storageKey, "\\", "/"), "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}
	return "/media/" + strings.Join(parts, "/")
}

type scanner interface{ Scan(...any) error }

func scan(row scanner) (Record, error) {
	var item Record
	err := row.Scan(&item.ID, &item.StorageKey, &item.OriginalName, &item.MIME, &item.Size, &item.Alt, &item.CreatedAt)
	if err != nil {
		return Record{}, err
	}
	item.URL = PublicURL(item.StorageKey)
	return item, nil
}

func randomHex(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

func truncate(value string, max int) string {
	runes := []rune(value)
	if len(runes) > max {
		runes = runes[:max]
	}
	return string(runes)
}
