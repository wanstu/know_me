package backup

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/wanstu/know_me/internal/blog"
)

const (
	Format                   = "know_me_backup"
	Version                  = 1
	MaxBytes                 = 100 * 1024 * 1024
	MaxExtractedUploadFile   = 64 * 1024 * 1024
	MaxExtractedUploadsTotal = 512 * 1024 * 1024
	MaxExtractedUploadFiles  = 10000
)

var contentTables = []string{
	"media",
	"posts",
	"post_revisions",
	"categories",
	"tags",
	"post_categories",
	"post_tags",
	"nav_groups",
	"nav_items",
	"settings",
}

type Payload struct {
	Format     string                      `json:"format"`
	Version    int                         `json:"version"`
	ExportedAt string                      `json:"exportedAt"`
	Tables     map[string][]map[string]any `json:"tables"`
}

type RestoreResult struct {
	Version         int    `json:"version"`
	ExportedAt      string `json:"exportedAt"`
	Posts           int    `json:"posts"`
	NavigationItems int    `json:"navigationItems"`
	Media           int    `json:"media"`
}

type Activity struct {
	LastExportAt        string `json:"lastExportAt"`
	LastRestoreAt       string `json:"lastRestoreAt"`
	LastRestoreSourceAt string `json:"lastRestoreSourceAt"`
	LastRestoreVersion  int    `json:"lastRestoreVersion"`
	LastRestorePosts    int    `json:"lastRestorePosts"`
	LastRestoreMedia    int    `json:"lastRestoreMedia"`
}

type Preview struct {
	Format          string `json:"format"`
	Version         int    `json:"version"`
	ExportedAt      string `json:"exportedAt"`
	Posts           int    `json:"posts"`
	NavigationItems int    `json:"navigationItems"`
	Media           int    `json:"media"`
	Settings        int    `json:"settings"`
	UploadFiles     int    `json:"uploadFiles"`
	Compatible      bool   `json:"compatible"`
}

type Store struct {
	db          *sql.DB
	uploadsRoot string
}

func NewStore(db *sql.DB, uploadsDir string) (*Store, error) {
	root, err := filepath.Abs(filepath.Clean(uploadsDir))
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	return &Store{db: db, uploadsRoot: root}, nil
}

func (s *Store) Create(ctx context.Context) ([]byte, error) {
	tables := make(map[string][]map[string]any, len(contentTables))
	for _, table := range contentTables {
		rows, err := readTable(ctx, s.db, table)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", table, err)
		}
		if table == "settings" {
			rows = withoutBackupActivity(rows)
		}
		tables[table] = rows
	}
	payload := Payload{
		Format: Format, Version: Version, ExportedAt: time.Now().UTC().Format(time.RFC3339), Tables: tables,
	}

	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	manifest, err := writer.CreateHeader(&zip.FileHeader{
		Name: "backup.json", Method: zip.Deflate,
	})
	if err != nil {
		return nil, err
	}
	body, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil, err
	}
	if _, err := manifest.Write(body); err != nil {
		return nil, err
	}

	readme, err := writer.CreateHeader(&zip.FileHeader{Name: "README.txt", Method: zip.Deflate})
	if err != nil {
		return nil, err
	}
	_, _ = io.WriteString(readme,
		"know_me backup\n\n"+
			"This archive contains site content, settings, navigation, blog data and media.\n"+
			"Administrator credentials and active sessions are intentionally NOT included.\n"+
			"Exported: "+payload.ExportedAt+"\n",
	)

	if err := filepath.WalkDir(s.uploadsRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(s.uploadsRoot, path)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if _, err := safeRelative(relative); err != nil {
			return err
		}
		fileWriter, err := writer.CreateHeader(&zip.FileHeader{Name: "uploads/" + relative, Method: zip.Deflate})
		if err != nil {
			return err
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(fileWriter, file)
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	}); err != nil {
		_ = writer.Close()
		return nil, err
	}

	if err := writer.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func (s *Store) Activity(ctx context.Context) (Activity, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, "SELECT value_json FROM settings WHERE key = 'backup_activity' LIMIT 1").Scan(&raw)
	if err == sql.ErrNoRows {
		return Activity{}, nil
	}
	if err != nil {
		return Activity{}, err
	}
	var value Activity
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return Activity{}, nil
	}
	return value, nil
}

func (s *Store) RecordExport(ctx context.Context) error {
	value, err := s.Activity(ctx)
	if err != nil {
		return err
	}
	value.LastExportAt = time.Now().UTC().Format(time.RFC3339)
	return s.setActivity(ctx, value)
}

func (s *Store) RecordRestore(ctx context.Context, result RestoreResult) error {
	value, err := s.Activity(ctx)
	if err != nil {
		return err
	}
	value.LastRestoreAt = time.Now().UTC().Format(time.RFC3339)
	value.LastRestoreSourceAt = result.ExportedAt
	value.LastRestoreVersion = result.Version
	value.LastRestorePosts = result.Posts
	value.LastRestoreMedia = result.Media
	return s.setActivity(ctx, value)
}

func (s *Store) setActivity(ctx context.Context, value Activity) error {
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx,
		"INSERT INTO settings (key, value_json, updated_at) VALUES ('backup_activity', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
		string(body), time.Now().UnixMilli(),
	)
	return err
}

func (s *Store) Preview(data []byte) (Preview, error) {
	if len(data) <= 0 || len(data) > MaxBytes {
		return Preview{}, errors.New("backup_size_invalid")
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return Preview{}, errors.New("invalid_backup_zip")
	}
	var manifest *zip.File
	for _, file := range reader.File {
		if file.Name == "backup.json" {
			manifest = file
		}
	}
	uploadFiles, err := validateUploadEntries(reader.File)
	if err != nil {
		return Preview{}, err
	}
	if manifest == nil {
		return Preview{}, errors.New("backup_manifest_missing")
	}
	manifestReader, err := manifest.Open()
	if err != nil {
		return Preview{}, err
	}
	decoder := json.NewDecoder(io.LimitReader(manifestReader, 32<<20))
	decoder.UseNumber()
	var payload Payload
	err = decoder.Decode(&payload)
	_ = manifestReader.Close()
	if err != nil {
		return Preview{}, errors.New("unsupported_backup")
	}
	compatible := validatePayload(payload) == nil
	return Preview{
		Format: payload.Format, Version: payload.Version, ExportedAt: payload.ExportedAt,
		Posts: len(payload.Tables["posts"]), NavigationItems: len(payload.Tables["nav_items"]),
		Media: len(payload.Tables["media"]), Settings: len(payload.Tables["settings"]),
		UploadFiles: uploadFiles, Compatible: compatible,
	}, nil
}

func (s *Store) Restore(ctx context.Context, data []byte) (RestoreResult, error) {
	if len(data) <= 0 || len(data) > MaxBytes {
		return RestoreResult{}, errors.New("backup_size_invalid")
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return RestoreResult{}, errors.New("invalid_backup_zip")
	}

	var manifest *zip.File
	for _, file := range reader.File {
		if file.Name == "backup.json" {
			manifest = file
			break
		}
	}
	if manifest == nil {
		return RestoreResult{}, errors.New("backup_manifest_missing")
	}

	manifestReader, err := manifest.Open()
	if err != nil {
		return RestoreResult{}, err
	}
	decoder := json.NewDecoder(io.LimitReader(manifestReader, 32<<20))
	decoder.UseNumber()
	var payload Payload
	err = decoder.Decode(&payload)
	_ = manifestReader.Close()
	if err != nil {
		return RestoreResult{}, errors.New("unsupported_backup")
	}
	if err := validatePayload(payload); err != nil {
		return RestoreResult{}, err
	}
	if _, err := validateUploadEntries(reader.File); err != nil {
		return RestoreResult{}, err
	}

	parent := filepath.Dir(s.uploadsRoot)
	token, err := randomHex(8)
	if err != nil {
		return RestoreResult{}, err
	}
	tempRoot := filepath.Join(parent, ".uploads-restore-"+token)
	oldRoot := filepath.Join(parent, ".uploads-before-restore-"+token)
	if err := os.MkdirAll(tempRoot, 0o755); err != nil {
		return RestoreResult{}, err
	}

	cleanupTemp := true
	defer func() {
		if cleanupTemp {
			_ = os.RemoveAll(tempRoot)
		}
	}()

	var extractedTotal int64
	for _, entry := range reader.File {
		if entry.FileInfo().IsDir() || !strings.HasPrefix(entry.Name, "uploads/") {
			continue
		}
		relative, err := safeRelative(strings.TrimPrefix(entry.Name, "uploads/"))
		if err != nil {
			return RestoreResult{}, err
		}
		full := filepath.Join(tempRoot, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return RestoreResult{}, err
		}
		source, err := entry.Open()
		if err != nil {
			return RestoreResult{}, err
		}
		target, err := os.OpenFile(full, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			source.Close()
			return RestoreResult{}, err
		}
		written, copyErr := io.Copy(target, io.LimitReader(source, MaxExtractedUploadFile+1))
		closeTarget := target.Close()
		closeSource := source.Close()
		if copyErr != nil {
			return RestoreResult{}, copyErr
		}
		if written > MaxExtractedUploadFile {
			return RestoreResult{}, errors.New("backup_upload_file_too_large")
		}
		if written > MaxExtractedUploadsTotal-extractedTotal {
			return RestoreResult{}, errors.New("backup_expanded_size_invalid")
		}
		extractedTotal += written
		if closeTarget != nil {
			return RestoreResult{}, closeTarget
		}
		if closeSource != nil {
			return RestoreResult{}, closeSource
		}
	}

	oldMoved := false
	if _, err := os.Stat(s.uploadsRoot); err == nil {
		if err := os.Rename(s.uploadsRoot, oldRoot); err != nil {
			return RestoreResult{}, err
		}
		oldMoved = true
	}
	if err := os.Rename(tempRoot, s.uploadsRoot); err != nil {
		if oldMoved {
			_ = os.Rename(oldRoot, s.uploadsRoot)
		}
		return RestoreResult{}, err
	}
	cleanupTemp = false

	if err := s.replaceDatabaseContent(ctx, payload); err != nil {
		_ = os.RemoveAll(s.uploadsRoot)
		if oldMoved {
			_ = os.Rename(oldRoot, s.uploadsRoot)
		}
		return RestoreResult{}, err
	}
	if oldMoved {
		_ = os.RemoveAll(oldRoot)
	}

	return RestoreResult{
		Version:         payload.Version,
		ExportedAt:      payload.ExportedAt,
		Posts:           len(payload.Tables["posts"]),
		NavigationItems: len(payload.Tables["nav_items"]),
		Media:           len(payload.Tables["media"]),
	}, nil
}

func (s *Store) replaceDatabaseContent(ctx context.Context, payload Payload) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "PRAGMA defer_foreign_keys = ON"); err != nil {
		return err
	}

	for _, table := range []string{
		"post_tags", "post_categories", "post_revisions", "posts_fts", "posts",
		"tags", "categories", "nav_items", "nav_groups", "media",
	} {
		if _, err := tx.ExecContext(ctx, "DELETE FROM "+table); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM settings WHERE key <> 'backup_activity'"); err != nil {
		return err
	}

	for _, table := range contentTables {
		rows := payload.Tables[table]
		if table == "settings" {
			rows = withoutBackupActivity(rows)
		}
		if err := insertRows(ctx, tx, table, rows); err != nil {
			return fmt.Errorf("restore %s: %w", table, err)
		}
	}
	if err := rebuildFTS(ctx, tx); err != nil {
		return err
	}
	return tx.Commit()
}

func validateUploadEntries(files []*zip.File) (int, error) {
	seen := map[string]struct{}{}
	var total uint64
	count := 0
	for _, file := range files {
		if file.FileInfo().IsDir() || !strings.HasPrefix(file.Name, "uploads/") {
			continue
		}
		relative, err := safeRelative(strings.TrimPrefix(file.Name, "uploads/"))
		if err != nil {
			return 0, err
		}
		if _, exists := seen[relative]; exists {
			return 0, errors.New("duplicate_backup_path")
		}
		seen[relative] = struct{}{}
		count++
		if count > MaxExtractedUploadFiles {
			return 0, errors.New("backup_too_many_files")
		}
		if file.UncompressedSize64 > MaxExtractedUploadFile {
			return 0, errors.New("backup_upload_file_too_large")
		}
		if file.UncompressedSize64 > MaxExtractedUploadsTotal-total {
			return 0, errors.New("backup_expanded_size_invalid")
		}
		total += file.UncompressedSize64
	}
	return count, nil
}

func withoutBackupActivity(rows []map[string]any) []map[string]any {
	filtered := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		if key, _ := row["key"].(string); key == "backup_activity" {
			continue
		}
		filtered = append(filtered, row)
	}
	return filtered
}

func readTable(ctx context.Context, db *sql.DB, table string) ([]map[string]any, error) {
	rows, err := db.QueryContext(ctx, "SELECT * FROM "+table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		row := make(map[string]any, len(columns))
		for i, column := range columns {
			switch value := values[i].(type) {
			case []byte:
				row[column] = string(value)
			default:
				row[column] = value
			}
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func insertRows(ctx context.Context, tx *sql.Tx, table string, rows []map[string]any) error {
	allowed, err := tableColumns(ctx, tx, table)
	if err != nil {
		return err
	}
	for _, row := range rows {
		columns := make([]string, 0, len(row))
		for column := range row {
			if !allowed[column] {
				return fmt.Errorf("unknown column %s", column)
			}
			columns = append(columns, column)
		}
		sort.Strings(columns)
		if len(columns) == 0 {
			continue
		}
		quoted := make([]string, len(columns))
		placeholders := make([]string, len(columns))
		values := make([]any, len(columns))
		for i, column := range columns {
			quoted[i] = quoteIdentifier(column)
			placeholders[i] = "?"
			values[i] = normalizeJSONValue(row[column])
		}
		query := "INSERT INTO " + table + " (" + strings.Join(quoted, ",") + ") VALUES (" + strings.Join(placeholders, ",") + ")"
		if _, err := tx.ExecContext(ctx, query, values...); err != nil {
			return err
		}
	}
	return nil
}

func tableColumns(ctx context.Context, tx *sql.Tx, table string) (map[string]bool, error) {
	rows, err := tx.QueryContext(ctx, "PRAGMA table_info("+table+")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]bool{}
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, pk int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return nil, err
		}
		result[name] = true
	}
	return result, rows.Err()
}

func rebuildFTS(ctx context.Context, tx *sql.Tx) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM posts_fts"); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, "SELECT id, title, excerpt, content_md FROM posts")
	if err != nil {
		return err
	}
	type postRow struct {
		id                      int64
		title, excerpt, content string
	}
	var posts []postRow
	for rows.Next() {
		var row postRow
		if err := rows.Scan(&row.id, &row.title, &row.excerpt, &row.content); err != nil {
			rows.Close()
			return err
		}
		posts = append(posts, row)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, row := range posts {
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO posts_fts (rowid, title, excerpt, content_text) VALUES (?, ?, ?, ?)",
			row.id, row.title, row.excerpt, blog.MarkdownToText(row.content),
		); err != nil {
			return err
		}
	}
	return nil
}

func validatePayload(payload Payload) error {
	if payload.Format != Format || payload.Version != Version || payload.Tables == nil {
		return errors.New("unsupported_backup")
	}
	for _, table := range contentTables {
		if _, ok := payload.Tables[table]; !ok {
			return errors.New("backup_table_missing_" + table)
		}
	}
	return nil
}

func safeRelative(value string) (string, error) {
	normalized := strings.TrimPrefix(strings.ReplaceAll(value, "\\", "/"), "/")
	if normalized == "" || strings.Contains(normalized, "\x00") {
		return "", errors.New("invalid_backup_path")
	}
	for _, part := range strings.Split(normalized, "/") {
		if part == "" || part == "." || part == ".." {
			return "", errors.New("invalid_backup_path")
		}
	}
	return normalized, nil
}

func quoteIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func normalizeJSONValue(value any) any {
	switch item := value.(type) {
	case json.Number:
		if integer, err := item.Int64(); err == nil {
			return integer
		}
		if number, err := item.Float64(); err == nil {
			return number
		}
		return item.String()
	default:
		return value
	}
}

func randomHex(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}
