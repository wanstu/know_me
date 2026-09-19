package database

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type DB struct {
	SQL  *sql.DB
	path string
}

func ResolvePath(dataDir string, configured string) string {
	value := strings.TrimSpace(configured)
	if value == "" {
		return filepath.Join(dataDir, "know-me.db")
	}
	value = strings.TrimPrefix(value, "file:")
	if filepath.IsAbs(value) {
		return filepath.Clean(value)
	}
	clean := filepath.Clean(value)
	prefix := "data" + string(filepath.Separator)
	if clean == "data" {
		return filepath.Join(dataDir, "know-me.db")
	}
	if strings.HasPrefix(strings.ToLower(clean), strings.ToLower(prefix)) {
		return filepath.Join(dataDir, strings.TrimPrefix(clean, prefix))
	}
	return filepath.Clean(value)
}

func Open(path string) (*DB, error) {
	path = filepath.Clean(path)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}

	sqlDB, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)

	db := &DB{SQL: sqlDB, path: path}
	if err := db.configure(); err != nil {
		sqlDB.Close()
		return nil, err
	}
	if err := db.Migrate(); err != nil {
		sqlDB.Close()
		return nil, err
	}
	return db, nil
}

func (db *DB) Path() string { return db.path }

func (db *DB) Close() error {
	if db == nil || db.SQL == nil {
		return nil
	}
	return db.SQL.Close()
}

func (db *DB) Ping() error {
	if db == nil || db.SQL == nil {
		return fmt.Errorf("database is closed")
	}
	return db.SQL.Ping()
}

func (db *DB) configure() error {
	for _, pragma := range []string{
		"PRAGMA foreign_keys = ON",
		"PRAGMA journal_mode = WAL",
		"PRAGMA busy_timeout = 5000",
	} {
		if _, err := db.SQL.Exec(pragma); err != nil {
			return fmt.Errorf("%s: %w", pragma, err)
		}
	}
	return nil
}

func (db *DB) Migrate() error {
	if _, err := db.SQL.Exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)"); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".sql")

		var exists int
		err := db.SQL.QueryRow("SELECT 1 FROM schema_migrations WHERE id = ? LIMIT 1", id).Scan(&exists)
		if err == nil {
			continue
		}
		if err != sql.ErrNoRows {
			return fmt.Errorf("check migration %s: %w", id, err)
		}

		body, err := fs.ReadFile(migrationsFS, "migrations/"+entry.Name())
		if err != nil {
			return fmt.Errorf("read migration %s: %w", id, err)
		}

		tx, err := db.SQL.Begin()
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", id, err)
		}
		if _, err := tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("apply migration %s: %w", id, err)
		}
		if _, err := tx.Exec("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", id, time.Now().UnixMilli()); err != nil {
			tx.Rollback()
			return fmt.Errorf("record migration %s: %w", id, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %s: %w", id, err)
		}
	}
	return nil
}

func (db *DB) MigrationIDs() ([]string, error) {
	rows, err := db.SQL.Query("SELECT id FROM schema_migrations ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
