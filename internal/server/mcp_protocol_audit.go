package server

import (
	"net/http"
	"strconv"

	"github.com/wanstu/know_me/internal/mcpaccess"
)

// mcpResponseRecorder observes HTTP status without accessing body content.
type mcpResponseRecorder struct {
	http.ResponseWriter
	status int
}

func (w *mcpResponseRecorder) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *mcpResponseRecorder) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}
func (w *mcpResponseRecorder) Write(payload []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(payload)
}
func (w *mcpResponseRecorder) Flush() {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}
func (w *mcpResponseRecorder) Status() int {
	if w.status == 0 {
		return http.StatusOK
	}
	return w.status
}
func (s *Server) recordMCPResponse(token mcpaccess.Token, method, remote string, status int) {
	result := "success"
	if status >= 400 {
		result = "error"
	}
	s.recordMCPEvent(mcpaccess.AuditEvent{
		EventType: "protocol_http", TokenID: token.ID, TokenName: token.Name,
		TokenScope: token.Scope, Result: result, Reason: "HTTP " + strconv.Itoa(status),
		HTTPMethod: method, RemotePeer: remote,
	})
}
