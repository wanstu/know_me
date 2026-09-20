package server

import (
	"io"
	"net/http"
	"time"

	"github.com/wanstu/know_me/internal/backup"
)

func (s *Server) registerBackupAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/backup/status", s.handleBackupStatus)
	mux.HandleFunc("GET /api/backup/export", s.handleBackupExport)
	mux.HandleFunc("POST /api/backup/preview", s.handleBackupPreview)
	mux.HandleFunc("POST /api/backup/restore", s.handleBackupRestore)
}

func (s *Server) handleBackupStatus(w http.ResponseWriter, r *http.Request) {
	if !s.requireUser(w, r) {
		return
	}
	value, err := s.backup.Activity(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "backup_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"activity": value})
}

func (s *Server) handleBackupExport(w http.ResponseWriter, r *http.Request) {
	if !s.requireUser(w, r) {
		return
	}
	bytes, err := s.backup.Create(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "backup_failed"})
		return
	}
	stamp := time.Now().Format("2006-01-02_15-04")
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=know_me-backup-"+stamp+".zip")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(bytes)
	_ = s.backup.RecordExport(r.Context())
}

func (s *Server) handleBackupPreview(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	bytes, ok := readBackupUpload(w, r)
	if !ok {
		return
	}
	preview, err := s.backup.Preview(bytes)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "preview": preview})
}

func (s *Server) handleBackupRestore(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	bytes, ok := readBackupUpload(w, r)
	if !ok {
		return
	}
	result, err := s.backup.Restore(r.Context(), bytes)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	_ = s.backup.RecordRestore(r.Context(), result)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "result": result})
}

func readBackupUpload(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, backup.MaxBytes+(2<<20))
	if err := r.ParseMultipartForm(backup.MaxBytes + (2 << 20)); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "restore_failed"})
		return nil, false
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file_required"})
		return nil, false
	}
	defer file.Close()
	bytes, err := io.ReadAll(io.LimitReader(file, backup.MaxBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "restore_failed"})
		return nil, false
	}
	if len(bytes) > backup.MaxBytes {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "backup_size_invalid"})
		return nil, false
	}
	return bytes, true
}
