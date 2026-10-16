package mcpaccess

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/wanstu/know_me/internal/database"
)

func TestAuditStoreRetentionFilteringAndPagination(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := NewAuditStore(db.SQL)
	if _, err := db.SQL.Exec(`INSERT INTO mcp_audit_events (occurred_at,event_type,result,reason)
    VALUES(?,?,?,?)`, time.Now().Add(-40*24*time.Hour).UnixMilli(), "authentication", "denied", "old"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 100; i++ {
		result := "success"
		if i%2 == 0 {
			result = "denied"
		}
		if err := s.Record(AuditEvent{EventType: "authentication", TokenID: "t1", TokenName: "safe-name", Result: result}); err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	all, err := s.List(ctx, AuditFilter{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 100 {
		t.Fatalf("expected 100 recent events, found %d", len(all))
	}
	for _, event := range all {
		if event.Reason == "old" {
			t.Fatal("expired event not removed")
		}
	}
	filtered, err := s.List(ctx, AuditFilter{Limit: 10, TokenID: "t1", Result: "denied"})
	if err != nil || len(filtered) != 10 {
		t.Fatalf("filter: %d events %v", len(filtered), err)
	}
	for _, item := range filtered {
		if item.Result != "denied" || item.TokenID != "t1" {
			t.Fatalf("filter ignored: %+v", item)
		}
	}
	older, err := s.List(ctx, AuditFilter{Limit: 10, BeforeID: filtered[len(filtered)-1].ID, Result: "denied"})
	if err != nil || len(older) != 10 || older[0].ID >= filtered[len(filtered)-1].ID {
		t.Fatalf("cursor ignored: %v %+v", err, older)
	}
}
