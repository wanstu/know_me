package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/wanstu/know_me/internal/mcpaccess"
)

func (s *Server) registerMCPManagement(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/mcp/tokens", s.handleMCPTokensList)
	mux.HandleFunc("POST /api/mcp/tokens", s.handleMCPTokensCreate)
	mux.HandleFunc("PATCH /api/mcp/tokens/{id}", s.handleMCPTokensPermissionsUpdate)
	mux.HandleFunc("DELETE /api/mcp/tokens/{id}", s.handleMCPTokensRevoke)
	mux.HandleFunc("GET /api/mcp/audit", s.handleMCPAuditList)
}

func (s *Server) handleMCPTokensList(w http.ResponseWriter, r *http.Request) {
	if !s.requireUser(w, r) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	tokens, err := s.mcpTokens.List(r.Context())
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "mcp_tokens_failed"})
		return
	}
	writeJSON(w, 200, map[string]any{
		"tokens": tokens, "endpoint": "/mcp", "permissions": mcpaccess.PermissionCatalog,
	})
}

func (s *Server) handleMCPTokensCreate(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	var input struct {
		Name        string    `json:"name"`
		Scope       string    `json:"scope"`
		Permissions *[]string `json:"permissions"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	var (
		token  mcpaccess.Token
		secret string
		err    error
	)
	if input.Permissions != nil {
		token, secret, err = s.mcpTokens.CreateWithPermissions(r.Context(), input.Name, *input.Permissions)
	} else {
		token, secret, err = s.mcpTokens.Create(r.Context(), input.Name, input.Scope)
	}
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	s.recordMCPEvent(mcpaccess.AuditEvent{
		EventType: "token_management", Action: "create", Result: "success",
		TokenID: token.ID, TokenName: token.Name, TokenScope: token.Scope,
		TargetType: "token", TargetID: token.ID,
	})
	writeJSON(w, 201, map[string]any{"token": token, "secret": secret})
}

func (s *Server) handleMCPTokensPermissionsUpdate(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	id := strings.TrimSpace(r.PathValue("id"))
	var input struct {
		Permissions *[]string `json:"permissions"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input); err != nil || input.Permissions == nil {
		writeJSON(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	token, updated, err := s.mcpTokens.UpdatePermissions(r.Context(), id, *input.Permissions)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	if !updated {
		writeJSON(w, 404, map[string]string{"error": "not_found"})
		return
	}
	s.recordMCPEvent(mcpaccess.AuditEvent{
		EventType: "token_management", Action: "permissions_update", Result: "success",
		TokenID: token.ID, TokenName: token.Name, TokenScope: token.Scope,
		TargetType: "token", TargetID: token.ID,
	})
	writeJSON(w, 200, map[string]any{"token": token})
}

func (s *Server) handleMCPTokensRevoke(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	revoked, err := s.mcpTokens.Revoke(r.Context(), id)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "mcp_tokens_failed"})
		return
	}
	if !revoked {
		writeJSON(w, 404, map[string]string{"error": "not_found"})
		return
	}
	s.recordMCPEvent(mcpaccess.AuditEvent{
		EventType: "token_management", Action: "revoke", Result: "success",
		TokenID: id, TargetType: "token", TargetID: id,
	})
	writeJSON(w, 200, map[string]bool{"ok": true})
}
