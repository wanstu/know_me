package auth

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/wanstu/know_me/internal/database"
)

func TestPasswordHashCompatibleShape(t *testing.T) {
	t.Parallel()
	hash, err := HashPassword("0123456789-password")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword("0123456789-password", hash) {
		t.Fatal("password should verify")
	}
	if VerifyPassword("wrong-password", hash) {
		t.Fatal("wrong password verified")
	}
}

func TestInitialAdminCanOnlyBeCreatedOnce(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "initial-admin.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db.SQL)
	ctx := context.Background()
	hasUsers, err := store.HasUsers(ctx)
	if err != nil || hasUsers {
		t.Fatalf("initial users: hasUsers=%v err=%v", hasUsers, err)
	}

	userID, created, err := store.CreateInitialAdmin(ctx, "admin", "0123456789-password", "Administrator")
	if err != nil || !created || userID == 0 {
		t.Fatalf("create initial admin: id=%d created=%v err=%v", userID, created, err)
	}
	hasUsers, err = store.HasUsers(ctx)
	if err != nil || !hasUsers {
		t.Fatalf("users after setup: hasUsers=%v err=%v", hasUsers, err)
	}

	secondID, created, err := store.CreateInitialAdmin(ctx, "other", "another-password-12345", "Other")
	if err != nil || created || secondID != 0 {
		t.Fatalf("second initial admin: id=%d created=%v err=%v", secondID, created, err)
	}
	if _, ok, err := store.CredentialsByUsername(ctx, "other"); err != nil || ok {
		t.Fatalf("second account must not exist: ok=%v err=%v", ok, err)
	}
}

func TestAdminAndSessionLifecycle(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db.SQL)
	ctx := context.Background()
	created, err := store.UpsertAdmin(ctx, "admin", "0123456789-password", "Administrator")
	if err != nil || !created {
		t.Fatalf("create admin: created=%v err=%v", created, err)
	}
	creds, ok, err := store.CredentialsByUsername(ctx, "ADMIN")
	if err != nil || !ok || !VerifyPassword("0123456789-password", creds.PasswordHash) {
		t.Fatalf("credentials: ok=%v err=%v", ok, err)
	}
	session, err := store.CreateSession(ctx, creds.UserID, "test-agent")
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.UserForSession(ctx, session.Token)
	if err != nil || user == nil || user.Username != "admin" {
		t.Fatalf("session user: %#v err=%v", user, err)
	}
	created, err = store.UpsertAdmin(ctx, "admin", "new-password-12345", "Admin 2")
	if err != nil || created {
		t.Fatalf("update admin: created=%v err=%v", created, err)
	}
	user, err = store.UserForSession(ctx, session.Token)
	if err != nil || user != nil {
		t.Fatalf("old session must be invalidated: %#v err=%v", user, err)
	}
}
