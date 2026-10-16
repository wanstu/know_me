package mcpaccess

import (
	"context"
	"database/sql"
	"strings"
	"sync/atomic"
	"time"
)

type AuditEvent struct {
	ID                 int64  `json:"id"`
	OccurredAt         int64  `json:"occurredAt"`
	EventType          string `json:"eventType"`
	TokenID            string `json:"tokenId,omitempty"`
	TokenName          string `json:"tokenName,omitempty"`
	TokenScope         string `json:"tokenScope,omitempty"`
	ToolName           string `json:"toolName,omitempty"`
	RequiredPermission string `json:"requiredPermission,omitempty"`
	TargetType         string `json:"targetType,omitempty"`
	TargetID           string `json:"targetId,omitempty"`
	Action             string `json:"action,omitempty"`
	Result             string `json:"result"`
	Reason             string `json:"reason,omitempty"`
	HTTPMethod         string `json:"httpMethod,omitempty"`
	RemotePeer         string `json:"remotePeer,omitempty"`
}
type AuditStore struct {
	db     *sql.DB
	writes atomic.Uint64
}

func NewAuditStore(db *sql.DB) *AuditStore { return &AuditStore{db: db} }

// Record never stores secrets, MCP arguments, user data or tool responses.
func (s *AuditStore) Record(event AuditEvent) error {
	ctx, cancel := context.WithTimeout(context.Background(), 750*time.Millisecond)
	defer cancel()
	now := time.Now().UnixMilli()
	_, err := s.db.ExecContext(ctx, `INSERT INTO mcp_audit_events
  (occurred_at,event_type,token_id,token_name,token_scope,tool_name,required_permission,
   target_type,target_id,action,result,reason,http_method,remote_peer)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		now, event.EventType, nullIfBlank(event.TokenID), nullIfBlank(event.TokenName), nullIfBlank(event.TokenScope),
		nullIfBlank(event.ToolName), nullIfBlank(event.RequiredPermission), nullIfBlank(event.TargetType),
		nullIfBlank(event.TargetID), nullIfBlank(event.Action), event.Result,
		nullIfBlank(event.Reason), nullIfBlank(event.HTTPMethod), nullIfBlank(event.RemotePeer))
	if err != nil {
		return err
	}
	if s.writes.Add(1)%100 == 0 {
		// Keep only the most recent 20k events and at most 30 days of history.
		_, _ = s.db.ExecContext(ctx, `DELETE FROM mcp_audit_events WHERE occurred_at < ? OR
    id <= COALESCE((SELECT id FROM mcp_audit_events ORDER BY id DESC LIMIT 1 OFFSET 19999),0)-1`,
			now-int64(30*24*time.Hour/time.Millisecond))
	}
	return nil
}
func nullIfBlank(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

type AuditFilter struct {
	BeforeID int64
	TokenID  string
	Result   string
	Limit    int
}

func (s *AuditStore) List(ctx context.Context, f AuditFilter) ([]AuditEvent, error) {
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 50
	}
	query := `SELECT id,occurred_at,event_type,token_id,token_name,token_scope,tool_name,
  required_permission,target_type,target_id,action,result,reason,http_method,remote_peer
  FROM mcp_audit_events WHERE 1=1`
	args := []any{}
	if f.BeforeID > 0 {
		query += " AND id < ?"
		args = append(args, f.BeforeID)
	}
	if f.TokenID != "" {
		query += " AND token_id = ?"
		args = append(args, f.TokenID)
	}
	if f.Result != "" {
		query += " AND result = ?"
		args = append(args, f.Result)
	}
	query += " ORDER BY id DESC LIMIT ?"
	args = append(args, f.Limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEvent{}
	for rows.Next() {
		var item AuditEvent
		var tokenID, tokenName, tokenScope, tool, permission, targetType, targetID, action, reason, method, peer sql.NullString
		if err := rows.Scan(&item.ID, &item.OccurredAt, &item.EventType, &tokenID, &tokenName, &tokenScope, &tool,
			&permission, &targetType, &targetID, &action, &item.Result, &reason, &method, &peer); err != nil {
			return nil, err
		}
		item.TokenID = tokenID.String
		item.TokenName = tokenName.String
		item.TokenScope = tokenScope.String
		item.ToolName = tool.String
		item.RequiredPermission = permission.String
		item.TargetType = targetType.String
		item.TargetID = targetID.String
		item.Action = action.String
		item.Reason = reason.String
		item.HTTPMethod = method.String
		item.RemotePeer = peer.String
		out = append(out, item)
	}
	return out, rows.Err()
}
