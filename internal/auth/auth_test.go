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
