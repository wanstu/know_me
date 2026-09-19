package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/wanstu/know_me/internal/blog"
)

type postPayload struct {
	Title          string   `json:"title"`
	Slug           string   `json:"slug"`
	Excerpt        string   `json:"excerpt"`
	ContentMD      string   `json:"contentMd"`
	Status         string   `json:"status"`
	Pinned         bool     `json:"pinned"`
	SEOTitle       string   `json:"seoTitle"`
	SEODescription string   `json:"seoDescription"`
	PublishedAt    *int64   `json:"publishedAt"`
	Tags           []string `json:"tags"`
	Categories     []string `json:"categories"`
}

func (p postPayload) input() blog.SaveInput {
	status := blog.StatusDraft
	if p.Status == string(blog.StatusPublished) {
		status = blog.StatusPublished
	} else if p.Status == string(blog.StatusScheduled) {
		status = blog.StatusScheduled
	}
	return blog.SaveInput{
		Title: p.Title, Slug: p.Slug, Excerpt: p.Excerpt, ContentMD: p.ContentMD, Status: status,
		Pinned: p.Pinned, SEOTitle: p.SEOTitle, SEODescription: p.SEODescription,
		PublishedAt: p.PublishedAt, Tags: p.Tags, Categories: p.Categories,
	}
}

func (s *Server) registerBlogAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/blog/posts", s.handlePublicPosts)
	mux.HandleFunc("GET /api/blog/posts/{slug}", s.handlePublicPost)
	mux.HandleFunc("GET /api/blog/taxonomy", s.handlePublicTaxonomy)

	mux.HandleFunc("GET /api/posts", s.handleAdminPosts)
	mux.HandleFunc("POST /api/posts", s.handleCreatePost)
	mux.HandleFunc("GET /api/posts/{id}", s.handleGetPost)
	mux.HandleFunc("PATCH /api/posts/{id}", s.handleUpdatePost)
	mux.HandleFunc("DELETE /api/posts/{id}", s.handleDeletePost)
	mux.HandleFunc("GET /api/posts/{id}/revisions", s.handleListRevisions)
	mux.HandleFunc("POST /api/posts/{id}/revisions", s.handleRestoreRevision)

	mux.HandleFunc("GET /api/taxonomy", s.handleTaxonomyGet)
	mux.HandleFunc("POST /api/taxonomy", s.handleTaxonomyAction)
}

func (s *Server) handlePublicPosts(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 30, 200)
	posts, err := s.blog.FilterPublished(
		r.Context(),
		r.URL.Query().Get("query"),
		r.URL.Query().Get("tag"),
		r.URL.Query().Get("category"),
		limit,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "blog_failed"})
		return
	}
	archives, _ := s.blog.ArchiveCounts(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"posts": posts, "archives": archives})
}

func (s *Server) handlePublicPost(w http.ResponseWriter, r *http.Request) {
	post, err := s.blog.GetPublishedBySlug(r.Context(), r.PathValue("slug"))
	if err != nil {
		if err.Error() == "post_not_found" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "blog_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"post": post})
}

func (s *Server) handlePublicTaxonomy(w http.ResponseWriter, r *http.Request) {
	value, err := s.blog.ListTaxonomy(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "taxonomy_failed"})
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (s *Server) handleAdminPosts(w http.ResponseWriter, r *http.Request) {
	if !s.requireUser(w, r) {
		return
	}
	posts, err := s.blog.ListAdmin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "blog_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"posts": posts})
}

func (s *Server) handleCreatePost(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	payload, ok := decodePostPayload(w, r)
	if !ok {
		return
	}
	post, err := s.blog.Save(r.Context(), payload.input(), nil)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "post": post})
}

func (s *Server) handleGetPost(w http.ResponseWriter, r *http.Request) {
	if !s.requireUser(w, r) {
		return
	}
	id, err := parsePathID(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_id"})
		return
	}
	post, err := s.blog.GetByID(r.Context(), id)
	if err != nil {
		if err.Error() == "post_not_found" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "blog_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"post": post})
}

func (s *Server) handleUpdatePost(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	id, err := parsePathID(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_id"})
		return
	}
	payload, ok := decodePostPayload(w, r)
	if !ok {
		return
	}
	post, err := s.blog.Save(r.Context(), payload.input(), &id)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "post": post})
}

func (s *Server) handleDeletePost(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	id, err := parsePathID(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_id"})
		return
	}
	if err := s.blog.Delete(r.Context(), id); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "delete_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleListRevisions(w http.ResponseWriter, r *http.Request) {
	if !s.requireUser(w, r) {
		return
	}
	id, err := parsePathID(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_id"})
		return
	}
	revisions, err := s.blog.ListRevisions(r.Context(), id, 50)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "revision_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revisions": revisions})
}

func (s *Server) handleRestoreRevision(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	id, err := parsePathID(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_id"})
		return
	}
	var body struct {
		RevisionID int64 `json:"revisionId"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil || body.RevisionID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_id"})
		return
	}
	post, err := s.blog.RestoreRevision(r.Context(), id, body.RevisionID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	revisions, _ := s.blog.ListRevisions(r.Context(), id, 50)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "post": post, "revisions": revisions})
}

func (s *Server) handleTaxonomyGet(w http.ResponseWriter, r *http.Request) {
	if !s.requireUser(w, r) {
		return
	}
	details, err := s.blog.ListTaxonomyDetails(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "taxonomy_failed"})
		return
	}
	writeJSON(w, http.StatusOK, details)
}

func (s *Server) handleTaxonomyAction(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	var body struct {
		Action string `json:"action"`
		Kind   string `json:"kind"`
		ID     int64  `json:"id"`
		Name   string `json:"name"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "taxonomy_failed"})
		return
	}
	kind := blog.TaxonomyTag
	if body.Kind == "category" {
		kind = blog.TaxonomyCategory
	}

	var err error
	response := map[string]any{"ok": true}
	switch body.Action {
	case "create":
		var id int64
		id, err = s.blog.CreateTaxonomy(r.Context(), kind, body.Name)
		response["id"] = id
	case "rename":
		if body.ID <= 0 {
			err = errors.New("invalid_id")
		} else {
			err = s.blog.RenameTaxonomy(r.Context(), kind, body.ID, body.Name)
		}
	case "delete":
		if body.ID <= 0 {
			err = errors.New("invalid_id")
		} else {
			_, err = s.blog.DeleteTaxonomy(r.Context(), kind, body.ID)
		}
	default:
		err = errors.New("unknown_action")
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	details, err := s.blog.ListTaxonomyDetails(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "taxonomy_failed"})
		return
	}
	response["tags"] = details.Tags
	response["categories"] = details.Categories
	writeJSON(w, http.StatusOK, response)
}

func decodePostPayload(w http.ResponseWriter, r *http.Request) (postPayload, bool) {
	var payload postPayload
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "save_failed"})
		return postPayload{}, false
	}
	return payload, true
}

func parsePathID(value string) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("invalid_id")
	}
	return id, nil
}

func parseLimit(value string, fallback, maxValue int) int {
	if value == "" {
		return fallback
	}
	number, err := strconv.Atoi(value)
	if err != nil || number <= 0 {
		return fallback
	}
	if number > maxValue {
		return maxValue
	}
	return number
}

func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) bool {
	user, err := s.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth_failed"})
		return false
	}
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return false
	}
	return true
}
