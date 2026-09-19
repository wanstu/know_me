package main

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/wanstu/know_me/internal/auth"
	"github.com/wanstu/know_me/internal/database"
)

func TestDatabaseMigrateAndAdminInitCommands(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
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
	defer db.Close()
	creds, ok, err := auth.NewStore(db.SQL).CredentialsByUsername(context.Background(), "admin")
	if err != nil || !ok {
		t.Fatalf("credentials: ok=%v err=%v", ok, err)
	}
	if !auth.VerifyPassword("0123456789-password", creds.PasswordHash) {
		t.Fatal("admin password does not verify")
	}
}
