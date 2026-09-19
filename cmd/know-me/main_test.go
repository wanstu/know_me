package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/wanstu/know_me/internal/auth"
	"github.com/wanstu/know_me/internal/database"
)

func TestDatabaseMigrateAndAdminInitCommands(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
	dbPath := filepath.Join(root, "native.db")
	dataDir := filepath.Join(root, "data")
	uploadsDir := filepath.Join(root, "uploads")

	if err := run([]string{
		"db", "migrate",
		"--database", dbPath,
		"--data-dir", dataDir,
		"--uploads-dir", uploadsDir,
	}); err != nil {
		t.Fatal(err)
	}

	if err := run([]string{
		"admin", "init",
		"--database", dbPath,
		"--data-dir", dataDir,
		"--uploads-dir", uploadsDir,
		"--username", "admin",
		"--password", "0123456789-password",
		"--display-name", "Administrator",
	}); err != nil {
		t.Fatal(err)
	}

	db, err := database.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	creds, ok, err := auth.NewStore(db.SQL).CredentialsByUsername(context.Background(), "admin")
	if err != nil || !ok {
		_ = db.Close()
		t.Fatalf("credentials: ok=%v err=%v", ok, err)
	}
	if !auth.VerifyPassword("0123456789-password", creds.PasswordHash) {
		_ = db.Close()
		t.Fatal("admin password does not verify")
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	backupPath := filepath.Join(root, "backup.zip")
	if err := run([]string{
		"backup", "export",
		"--database", dbPath,
		"--data-dir", dataDir,
		"--uploads-dir", uploadsDir,
		"--output", backupPath,
	}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(backupPath)
	if err != nil || info.Size() <= 0 {
		t.Fatalf("backup file: info=%v err=%v", info, err)
	}
	if err := run([]string{
		"backup", "restore",
		"--database", dbPath,
		"--data-dir", dataDir,
		"--uploads-dir", uploadsDir,
		"--file", backupPath,
	}); err != nil {
		t.Fatal(err)
	}
}
