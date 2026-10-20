package mcpaccess

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/wanstu/know_me/internal/database"
)

func TestTokenGranularPermissionsAndLegacyCompatibility(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "mcp.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db.SQL)
	ctx := context.Background()

	legacy, legacySecret, err := store.Create(ctx, "legacy write", "write")
	if err != nil {
		t.Fatal(err)
	}
	if legacy.PermissionMode != "legacy" || !legacy.HasPermission(PermissionSiteWrite) || !legacy.HasPermission(PermissionPostsRead) {
		t.Fatalf("legacy permissions changed: %+v %v", legacy, legacy.EffectivePermissions())
	}
	resolvedLegacy, err := store.Resolve(ctx, legacySecret)
	if err != nil || resolvedLegacy.PermissionMode != "legacy" || !resolvedLegacy.HasPermission(PermissionMediaWrite) {
		t.Fatalf("resolved legacy token lost compatibility: %+v err=%v", resolvedLegacy, err)
	}

	custom, customSecret, err := store.CreateWithPermissions(ctx, "start editor", []string{PermissionStartWrite})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{PermissionStartRead, PermissionStartWrite}
	if custom.PermissionMode != "custom" || custom.Scope != "write" || !reflect.DeepEqual(custom.Permissions, want) {
		t.Fatalf("custom token=%+v want permissions=%v", custom, want)
	}
	if custom.HasPermission(PermissionPostsRead) {
		t.Fatal("custom token unexpectedly inherited unrelated read permission")
	}
	resolvedCustom, err := store.Resolve(ctx, customSecret)
	if err != nil || !reflect.DeepEqual(resolvedCustom.Permissions, want) {
		t.Fatalf("resolved custom token=%+v err=%v", resolvedCustom, err)
	}

	updated, ok, err := store.UpdatePermissions(ctx, legacy.ID, []string{PermissionPostsRead})
	if err != nil || !ok {
		t.Fatalf("update legacy token: ok=%v err=%v", ok, err)
	}
	if updated.PermissionMode != "custom" || updated.Scope != "read" || !reflect.DeepEqual(updated.Permissions, []string{PermissionPostsRead}) {
		t.Fatalf("updated token=%+v", updated)
	}
	stillSameSecret, err := store.Resolve(ctx, legacySecret)
	if err != nil || stillSameSecret.PermissionMode != "custom" || stillSameSecret.HasPermission(PermissionSiteRead) {
		t.Fatalf("permission update did not take effect without rotating secret: %+v err=%v", stillSameSecret, err)
	}

	if _, _, err := store.CreateWithPermissions(ctx, "empty", nil); err == nil {
		t.Fatal("empty permission set accepted")
	}
	if _, _, err := store.CreateWithPermissions(ctx, "unknown", []string{"admin.everything"}); err == nil {
		t.Fatal("unknown permission accepted")
	}
}
