package media

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
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
	Width        int    `json:"width"`
	Height       int    `json:"height"`
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
	width, height := imageDimensions(bytes, mime)
	if width <= 0 || height <= 0 {
		return Record{}, errors.New("invalid_media_file")
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
		"INSERT INTO media (storage_key, original_name, mime, width, height, size, alt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		key, truncate(strings.TrimSpace(originalName), 240), mime, nullableDimension(width), nullableDimension(height), len(bytes), truncate(strings.TrimSpace(alt), 500), createdAt,
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
		"SELECT id, storage_key, original_name, mime, width, height, size, alt, created_at FROM media ORDER BY created_at DESC LIMIT ?",
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
		"SELECT id, storage_key, original_name, mime, width, height, size, alt, created_at FROM media WHERE id = ? LIMIT 1", id))
	if err == sql.ErrNoRows {
		return Record{}, errors.New("media_not_found")
	}
	return item, err
}

func (s *Store) GetByStorageKey(ctx context.Context, key string) (Record, error) {
	item, err := scan(s.db.QueryRowContext(ctx,
		"SELECT id, storage_key, original_name, mime, width, height, size, alt, created_at FROM media WHERE storage_key = ? LIMIT 1", key))
	if err == sql.ErrNoRows {
		return Record{}, errors.New("media_not_found")
	}
	return item, err
}

func (s *Store) UpdateAlt(ctx context.Context, id int64, alt string) (Record, error) {
	result, err := s.db.ExecContext(ctx, "UPDATE media SET alt = ? WHERE id = ?", truncate(strings.TrimSpace(alt), 500), id)
	if err != nil {
		return Record{}, err
	}
	changes, _ := result.RowsAffected()
	if changes == 0 {
		return Record{}, errors.New("media_not_found")
	}
	return s.GetByID(ctx, id)
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
	var width, height sql.NullInt64
	err := row.Scan(&item.ID, &item.StorageKey, &item.OriginalName, &item.MIME, &width, &height, &item.Size, &item.Alt, &item.CreatedAt)
	if width.Valid {
		item.Width = int(width.Int64)
	}
	if height.Valid {
		item.Height = int(height.Int64)
	}
	if err != nil {
		return Record{}, err
	}
	item.URL = PublicURL(item.StorageKey)
	return item, nil
}

func imageDimensions(data []byte, mime string) (int, int) {
	if mime == "image/webp" {
		return webpDimensions(data)
	}
	if mime != "image/jpeg" && mime != "image/png" && mime != "image/gif" {
		return 0, 0
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return 0, 0
	}
	expected := map[string]string{
		"image/jpeg": "jpeg",
		"image/png":  "png",
		"image/gif":  "gif",
	}[mime]
	if format != expected {
		return 0, 0
	}
	return config.Width, config.Height
}

func webpDimensions(data []byte) (int, int) {
	if len(data) < 12 || string(data[0:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return 0, 0
	}
	for offset := 12; offset+8 <= len(data); {
		chunkType := string(data[offset : offset+4])
		chunkSize := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		payloadStart := offset + 8
		payloadEnd := payloadStart + chunkSize
		if chunkSize < 0 || payloadEnd < payloadStart || payloadEnd > len(data) {
			return 0, 0
		}
		payload := data[payloadStart:payloadEnd]
		switch chunkType {
		case "VP8X":
			if len(payload) >= 10 {
				width := 1 + int(payload[4]) + int(payload[5])<<8 + int(payload[6])<<16
				height := 1 + int(payload[7]) + int(payload[8])<<8 + int(payload[9])<<16
				return width, height
			}
		case "VP8L":
			if len(payload) >= 5 && payload[0] == 0x2f {
				bits := binary.LittleEndian.Uint32(payload[1:5])
				width := int(bits&0x3fff) + 1
				height := int((bits>>14)&0x3fff) + 1
				return width, height
			}
		case "VP8 ":
			if len(payload) >= 10 && payload[3] == 0x9d && payload[4] == 0x01 && payload[5] == 0x2a {
				width := int(binary.LittleEndian.Uint16(payload[6:8]) & 0x3fff)
				height := int(binary.LittleEndian.Uint16(payload[8:10]) & 0x3fff)
				return width, height
			}
		}
		offset = payloadEnd
		if chunkSize%2 != 0 {
			offset++
		}
	}
	return 0, 0
}

func nullableDimension(value int) any {
	if value <= 0 {
		return nil
	}
	return value
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
