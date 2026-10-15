package server

import (
	"encoding/json"
	"net/http"
	"strings"
)

func (s *Server) registerMCPManagement(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/mcp/tokens", s.handleMCPTokensList)
	mux.HandleFunc("POST /api/mcp/tokens", s.handleMCPTokensCreate)
	mux.HandleFunc("DELETE /api/mcp/tokens/{id}", s.handleMCPTokensRevoke)
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
	writeJSON(w, 200, map[string]any{"tokens": tokens, "endpoint": "/mcp"})
}
func (s *Server) handleMCPTokensCreate(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	var input struct {
		Name  string `json:"name"`
		Scope string `json:"scope"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	token, secret, err := s.mcpTokens.Create(r.Context(), input.Name, input.Scope)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 201, map[string]any{"token": token, "secret": secret})
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
	writeJSON(w, 200, map[string]bool{"ok": true})
}
