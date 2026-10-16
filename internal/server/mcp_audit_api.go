package server

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/wanstu/know_me/internal/mcpaccess"
)

func (s *Server) handleMCPAuditList(w http.ResponseWriter, r *http.Request) {
	if !s.requireUser(w, r) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	f := mcpaccess.AuditFilter{
		TokenID: strings.TrimSpace(r.URL.Query().Get("tokenId")),
		Result:  strings.TrimSpace(r.URL.Query().Get("result")),
	}
	if len(f.TokenID) > 128 {
		writeJSON(w, 400, map[string]string{"error": "invalid_filter"})
		return
	}
	if f.Result != "" && f.Result != "success" && f.Result != "error" && f.Result != "denied" {
		writeJSON(w, 400, map[string]string{"error": "invalid_filter"})
		return
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 100 {
			writeJSON(w, 400, map[string]string{"error": "invalid_limit"})
			return
		}
		f.Limit = n
	}
	if v := r.URL.Query().Get("beforeId"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 1 {
			writeJSON(w, 400, map[string]string{"error": "invalid_before_id"})
			return
		}
		f.BeforeID = n
	}
	events, err := s.mcpAudit.List(r.Context(), f)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "mcp_audit_failed"})
		return
	}
	writeJSON(w, 200, map[string]any{"events": events})
}
