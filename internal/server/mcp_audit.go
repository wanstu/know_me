package server

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"reflect"
	"strconv"
	"strings"

	"github.com/wanstu/know_me/internal/mcpaccess"
)

type mcpAuditContextKey struct{}
type mcpAuditContext struct {
	store      *mcpaccess.AuditStore
	remotePeer string
}

func mcpRemotePeer(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if len(host) > 80 {
		return ""
	}
	return host
}
func (s *Server) recordMCPEvent(event mcpaccess.AuditEvent) {
	if s.mcpAudit == nil {
		return
	}
	if err := s.mcpAudit.Record(event); err != nil {
		slog.Warn("Know Me MCP audit write failed", "error", err)
	}
}
func mcpRecordTool(ctx context.Context, token mcpaccess.Token, name string, input any, output any, callErr error, readOnly bool, denied bool) {
	audit, ok := ctx.Value(mcpAuditContextKey{}).(mcpAuditContext)
	if !ok || audit.store == nil {
		return
	}
	result, reason := "success", ""
	if denied {
		result = "denied"
		reason = "permission_denied"
	} else if callErr != nil {
		result = "error"
		reason = mcpAuditErrorReason(callErr)
	}
	kind, target, action := mcpToolTarget(name, input, output)
	permission := "read"
	if !readOnly {
		permission = "write"
	}
	domain := "mcp"
	switch {
	case strings.HasPrefix(name, "posts_"):
		domain = "posts"
	case strings.HasPrefix(name, "taxonomy_"):
		domain = "taxonomy"
	case strings.HasPrefix(name, "site_"):
		domain = "site"
	case strings.HasPrefix(name, "start_"):
		domain = "start"
	case strings.HasPrefix(name, "navigation_"):
		domain = "navigation"
	}
	event := mcpaccess.AuditEvent{
		EventType: "tool", TokenID: token.ID, TokenName: token.Name, TokenScope: token.Scope,
		ToolName: name, RequiredPermission: domain + "." + permission, TargetType: kind, TargetID: target,
		Action: action, Result: result, Reason: reason, RemotePeer: audit.remotePeer,
	}
	if err := audit.store.Record(event); err != nil {
		slog.Warn("Know Me MCP audit write failed", "error", err)
	}
}
func mcpAuditErrorReason(err error) string {
	if err == nil {
		return ""
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "not_found"), strings.Contains(msg, "no rows"):
		return "not_found"
	case strings.Contains(msg, "permission"), strings.Contains(msg, "unauthorized"):
		return "permission_denied"
	case strings.Contains(msg, "confirmation"):
		return "confirmation_required"
	case strings.Contains(msg, "modified_since"), strings.Contains(msg, "conflict"):
		return "conflict"
	case strings.Contains(msg, "invalid"), strings.Contains(msg, "required"), strings.Contains(msg, "must_be"):
		return "validation_failed"
	default:
		return "operation_failed"
	}
}
func mcpToolTarget(name string, input any, output any) (kind, id, action string) {
	switch {
	case strings.HasPrefix(name, "posts_"):
		kind = "post"
	case strings.HasPrefix(name, "taxonomy_"):
		kind = "taxonomy"
	case strings.HasPrefix(name, "navigation_"):
		kind = "navigation"
	case strings.HasPrefix(name, "site_"):
		kind = "site"
	case strings.HasPrefix(name, "start_"):
		kind = "start"
	default:
		kind = "mcp"
	}
	v := reflect.ValueOf(input)
	for v.IsValid() && (v.Kind() == reflect.Pointer || v.Kind() == reflect.Interface) {
		if v.IsNil() {
			break
		}
		v = v.Elem()
	}
	if v.IsValid() && v.Kind() == reflect.Struct {
		if f := v.FieldByName("ID"); f.IsValid() && f.CanInt() && f.Int() > 0 {
			id = intToString(f.Int())
		}
		if f := v.FieldByName("IDs"); f.IsValid() && f.Kind() == reflect.Slice {
			values := []string{}
			for i := 0; i < f.Len() && i < 50; i++ {
				if f.Index(i).CanInt() {
					values = append(values, intToString(f.Index(i).Int()))
				}
			}
			if len(values) > 0 {
				id = strings.Join(values, ",")
			}
		}
		if f := v.FieldByName("Action"); f.IsValid() && f.Kind() == reflect.String {
			v := f.String()
			if len(v) > 32 {
				v = v[:32]
			}
			valid := true
			for _, r := range v {
				if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-') {
					valid = false
					break
				}
			}
			if valid {
				action = v
			}
		}
	}
	if id == "" {
		if out, ok := output.(map[string]any); ok {
			if p, ok := out["post"]; ok {
				v := reflect.ValueOf(p)
				for v.IsValid() && v.Kind() == reflect.Pointer && !v.IsNil() {
					v = v.Elem()
				}
				if v.IsValid() && v.Kind() == reflect.Struct {
					if f := v.FieldByName("ID"); f.IsValid() && f.CanInt() && f.Int() > 0 {
						id = intToString(f.Int())
					}
				}
			}
		}
	}
	return
}
func intToString(i int64) string { return strconv.FormatInt(i, 10) }
