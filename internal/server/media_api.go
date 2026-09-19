package server

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/wanstu/know_me/internal/media"
)

func (s *Server) registerMediaAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/media", s.handleMediaList)
	mux.HandleFunc("POST /api/media", s.handleMediaUpload)
	mux.HandleFunc("DELETE /api/media/{id}", s.handleMediaDelete)
	mux.HandleFunc("GET /media/{key...}", s.handleMediaFile)
}

func (s *Server) handleMediaList(w http.ResponseWriter, r *http.Request) {
	if !s.requireUser(w, r) {
		return
	}
	items, err := s.media.List(r.Context(), 200)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "media_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"media": items})
}

func (s *Server) handleMediaUpload(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, media.MaxBytes+(2<<20))
	if err := r.ParseMultipartForm(media.MaxBytes + (2 << 20)); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "upload_failed"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file_required"})
		return
	}
	defer file.Close()

	bytes, err := io.ReadAll(io.LimitReader(file, media.MaxBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "upload_failed"})
		return
	}
	if len(bytes) > media.MaxBytes {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "media_size_invalid"})
		return
	}
	mime := strings.TrimSpace(header.Header.Get("Content-Type"))
	item, err := s.media.Save(r.Context(), header.Filename, mime, bytes, r.FormValue("alt"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "media": item})
}

func (s *Server) handleMediaDelete(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	id, err := parsePathID(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_id"})
		return
	}
	ok, err := s.media.Delete(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "delete_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": ok})
}

func (s *Server) handleMediaFile(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(strings.TrimSpace(r.PathValue("key")), "/")
	if key == "" {
		http.NotFound(w, r)
		return
	}
	item, err := s.media.GetByStorageKey(r.Context(), key)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	path, err := s.media.FilePath(item.StorageKey)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	stat, err := os.Stat(path)
	if err != nil || stat.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", item.MIME)
	w.Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, filepath.Clean(path))
}
