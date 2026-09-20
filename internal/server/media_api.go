package server

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/wanstu/know_me/internal/media"
	"github.com/wanstu/know_me/internal/navigation"
)

func (s *Server) registerMediaAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/media", s.handleMediaList)
	mux.HandleFunc("POST /api/media", s.handleMediaUpload)
	mux.HandleFunc("GET /api/media/{id}/references", s.handleMediaReferences)
	mux.HandleFunc("PATCH /api/media/{id}", s.handleMediaUpdate)
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

type mediaReference struct {
	Kind  string `json:"kind"`
	Title string `json:"title"`
	URL   string `json:"url"`
}

func (s *Server) handleMediaReferences(w http.ResponseWriter, r *http.Request) {
	if !s.requireUser(w, r) {
		return
	}
	id, err := parsePathID(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_id"})
		return
	}
	item, err := s.media.GetByID(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media_not_found"})
		return
	}
	refs := []mediaReference{}
	posts, err := s.blog.ListAdmin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "media_reference_failed"})
		return
	}
	for _, post := range posts {
		if strings.Contains(post.ContentMD, item.URL) {
			refs = append(refs, mediaReference{Kind: "post", Title: post.Title, URL: "/admin/posts/" + strconv.FormatInt(post.ID, 10)})
		}
	}
	settings, err := s.settings.GetSite(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "media_reference_failed"})
		return
	}
	for _, candidate := range []struct{ title, value string }{
		{"站点头像", settings.AvatarURL},
		{"主页背景", settings.HomeBackgroundURL},
		{"Start 背景", settings.StartBackgroundURL},
	} {
		if candidate.value == item.URL {
			refs = append(refs, mediaReference{Kind: "setting", Title: candidate.title, URL: "/admin/settings"})
		}
	}
	tree, err := s.navigation.Tree(r.Context(), true)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "media_reference_failed"})
		return
	}
	var visitItems func(items []*navigation.Item)
	visitItems = func(items []*navigation.Item) {
		for _, navItem := range items {
			if navItem.IconURL == item.URL {
				refs = append(refs, mediaReference{Kind: "navigation", Title: "导航图标：" + navItem.Name, URL: "/admin/navigation"})
			}
			visitItems(navItem.Children)
		}
	}
	for _, group := range tree.Groups {
		visitItems(group.Items)
	}
	writeJSON(w, http.StatusOK, map[string]any{"references": refs, "count": len(refs)})
}

func (s *Server) handleMediaUpdate(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	id, err := parsePathID(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_id"})
		return
	}
	var body struct {
		Alt string `json:"alt"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	item, err := s.media.UpdateAlt(r.Context(), id, body.Alt)
	if err != nil {
		if err.Error() == "media_not_found" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "media_not_found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "media_failed"})
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
