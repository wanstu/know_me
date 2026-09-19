package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/wanstu/know_me/internal/navigation"
)

func (s *Server) registerNavigationAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/navigation/public", s.handleNavigationPublic)
	mux.HandleFunc("GET /api/navigation", s.handleNavigationGet)
	mux.HandleFunc("POST /api/navigation", s.handleNavigationAction)
	mux.HandleFunc("POST /api/navigation/import/preview", s.handleNavigationImportPreview)
	mux.HandleFunc("POST /api/navigation/import/apply", s.handleNavigationImportApply)
	mux.HandleFunc("GET /api/navigation/export", s.handleNavigationExport)
}

func (s *Server) handleNavigationPublic(w http.ResponseWriter, r *http.Request) {
	tree, err := s.navigation.Tree(r.Context(), false)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "navigation_failed"})
		return
	}
	writeJSON(w, http.StatusOK, tree)
}

func (s *Server) handleNavigationGet(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth_failed"})
		return
	}
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	tree, err := s.navigation.Tree(r.Context(), true)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "navigation_failed"})
		return
	}
	writeJSON(w, http.StatusOK, tree)
}

func (s *Server) handleNavigationAction(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth_failed"})
		return
	}
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.UseNumber()
	var body struct {
		Action string         `json:"action"`
		Data   map[string]any `json:"data"`
	}
	if err := decoder.Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	if body.Data == nil {
		body.Data = map[string]any{}
	}

	var response map[string]any
	switch body.Action {
	case "create_group":
		name := strings.TrimSpace(stringValue(body.Data["name"]))
		if name == "" {
			err = errors.New("group_name_required")
			break
		}
		id, createErr := s.navigation.CreateGroup(r.Context(), navigation.GroupInput{
			Name:       name,
			Icon:       stringValue(body.Data["icon"]),
			Visibility: visibilityValue(body.Data["visibility"]),
		})
		err = createErr
		response = map[string]any{"ok": true, "id": id}
	case "update_group":
		var id int64
		id, err = positiveID(body.Data["id"])
		if err != nil {
			break
		}
		patch := navigation.GroupPatch{}
		if value, ok := body.Data["name"]; ok {
			text := stringValue(value)
			patch.Name = &text
		}
		if value, ok := body.Data["icon"]; ok {
			text := stringValue(value)
			patch.Icon = &text
		}
		if value, ok := body.Data["visibility"]; ok {
			visibility := visibilityValue(value)
			patch.Visibility = &visibility
		}
		_, err = s.navigation.UpdateGroup(r.Context(), id, patch)
		response = map[string]any{"ok": true}
	case "delete_group":
		var id int64
		id, err = positiveID(body.Data["id"])
		if err == nil {
			_, err = s.navigation.DeleteGroup(r.Context(), id)
		}
		response = map[string]any{"ok": true}
	case "create_item":
		var groupID int64
		groupID, err = positiveID(body.Data["groupId"])
		if err != nil {
			break
		}
		name := strings.TrimSpace(stringValue(body.Data["name"]))
		if name == "" {
			err = errors.New("item_name_required")
			break
		}
		parentID, parentErr := optionalPositiveID(body.Data["parentId"])
		if parentErr != nil {
			err = parentErr
			break
		}
		id, createErr := s.navigation.CreateItem(r.Context(), navigation.ItemInput{
			GroupID:         groupID,
			ParentID:        parentID,
			Type:            itemTypeValue(body.Data["type"]),
			Name:            name,
			URL:             stringValue(body.Data["url"]),
			IconURL:         stringValue(body.Data["iconUrl"]),
			IconText:        stringValue(body.Data["iconText"]),
			BackgroundColor: stringValue(body.Data["backgroundColor"]),
			Size:            itemSizeValue(body.Data["size"]),
			Visibility:      visibilityValue(body.Data["visibility"]),
		})
		err = createErr
		response = map[string]any{"ok": true, "id": id}
	case "update_item":
		var id int64
		id, err = positiveID(body.Data["id"])
		if err != nil {
			break
		}
		patch := navigation.ItemPatch{}
		if value, ok := body.Data["groupId"]; ok {
			v, parseErr := positiveID(value)
			if parseErr != nil {
				err = parseErr
				break
			}
			patch.GroupID = &v
		}
		if value, ok := body.Data["parentId"]; ok {
			v, parseErr := optionalPositiveID(value)
			if parseErr != nil {
				err = parseErr
				break
			}
			patch.ParentID = &v
		}
		if value, ok := body.Data["type"]; ok {
			v := itemTypeValue(value)
			patch.Type = &v
		}
		if value, ok := body.Data["name"]; ok {
			v := stringValue(value)
			patch.Name = &v
		}
		if value, ok := body.Data["url"]; ok {
			v := stringValue(value)
			patch.URL = &v
		}
		if value, ok := body.Data["iconUrl"]; ok {
			v := stringValue(value)
			patch.IconURL = &v
		}
		if value, ok := body.Data["iconText"]; ok {
			v := stringValue(value)
			patch.IconText = &v
		}
		if value, ok := body.Data["backgroundColor"]; ok {
			v := stringValue(value)
			patch.BackgroundColor = &v
		}
		if value, ok := body.Data["size"]; ok {
			v := itemSizeValue(value)
			patch.Size = &v
		}
		if value, ok := body.Data["visibility"]; ok {
			v := visibilityValue(value)
			patch.Visibility = &v
		}
		_, err = s.navigation.UpdateItem(r.Context(), id, patch)
		response = map[string]any{"ok": true}
	case "delete_item":
		var id int64
		id, err = positiveID(body.Data["id"])
		if err == nil {
			_, err = s.navigation.DeleteItem(r.Context(), id)
		}
		response = map[string]any{"ok": true}
	case "bulk_delete":
		var ids []int64
		ids, err = idList(body.Data["ids"])
		if err != nil {
			break
		}
		var deleted int
		deleted, err = s.navigation.BulkDelete(r.Context(), ids)
		response = map[string]any{"ok": true, "deleted": deleted}
	case "bulk_move":
		var ids []int64
		ids, err = idList(body.Data["ids"])
		if err != nil {
			break
		}
		var groupID int64
		groupID, err = positiveID(body.Data["groupId"])
		if err != nil {
			break
		}
		parentID, parseErr := optionalPositiveID(body.Data["parentId"])
		if parseErr != nil {
			err = parseErr
			break
		}
		var moved int
		moved, err = s.navigation.BulkMove(r.Context(), ids, groupID, parentID)
		response = map[string]any{"ok": true, "moved": moved}
	case "reorder_groups":
		var ids []int64
		ids, err = idList(body.Data["ids"])
		if err == nil {
			err = s.navigation.ReorderGroups(r.Context(), ids)
		}
		response = map[string]any{"ok": true}
	case "reorder_items":
		var groupID int64
		groupID, err = positiveID(body.Data["groupId"])
		if err != nil {
			break
		}
		parentID, parseErr := optionalPositiveID(body.Data["parentId"])
		if parseErr != nil {
			err = parseErr
			break
		}
		var ids []int64
		ids, err = idList(body.Data["ids"])
		if err == nil {
			err = s.navigation.ReorderItems(r.Context(), groupID, parentID, ids)
		}
		response = map[string]any{"ok": true}
	case "visit":
		var id int64
		id, err = positiveID(body.Data["id"])
		if err == nil {
			err = s.navigation.IncrementVisit(r.Context(), id)
		}
		response = map[string]any{"ok": true}
	default:
		err = errors.New("unknown_action")
	}

	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if body.Action != "visit" {
		tree, treeErr := s.navigation.Tree(r.Context(), true)
		if treeErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "navigation_failed"})
			return
		}
		response["tree"] = tree
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleNavigationImportPreview(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	raw, _, _, ok := readItabRequest(w, r)
	if !ok {
		return
	}
	preview, err := s.navigation.PreviewItabImport(r.Context(), raw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "preview": preview})
}

func (s *Server) handleNavigationImportApply(w http.ResponseWriter, r *http.Request) {
	if !s.requireMutationUser(w, r) {
		return
	}
	raw, strategy, overwrite, ok := readItabRequest(w, r)
	if !ok {
		return
	}
	result, err := s.navigation.ApplyItabImport(r.Context(), raw, strategy, overwrite)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	tree, err := s.navigation.Tree(r.Context(), true)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "navigation_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "result": result, "tree": tree})
}

func (s *Server) handleNavigationExport(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth_failed"})
		return
	}
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	body, err := s.navigation.ExportItab(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "navigation_export_failed"})
		return
	}
	now := time.Now()
	filename := fmt.Sprintf("iTab备份-%04d-%02d-%02d %02d_%02d.itabdata", now.Year(), now.Month(), now.Day(), now.Hour(), now.Minute())
	encoded := strings.ReplaceAll(url.QueryEscape(filename), "+", "%20")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+encoded)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func (s *Server) requireMutationUser(w http.ResponseWriter, r *http.Request) bool {
	user, err := s.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth_failed"})
		return false
	}
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return false
	}
	if !sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return false
	}
	return true
}

func readItabRequest(w http.ResponseWriter, r *http.Request) (raw, strategy string, overwrite bool, ok bool) {
	r.Body = http.MaxBytesReader(w, r.Body, 6<<20)
	var body struct {
		Raw       string `json:"raw"`
		Strategy  string `json:"strategy"`
		Overwrite bool   `json:"overwrite"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_itab"})
		return "", "", false, false
	}
	if body.Raw == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "empty_file"})
		return "", "", false, false
	}
	if len([]byte(body.Raw)) > 5<<20 {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "itab_file_too_large"})
		return "", "", false, false
	}
	if body.Strategy == "replace" {
		strategy = "replace"
	} else {
		strategy = "merge"
	}
	return body.Raw, strategy, body.Overwrite, true
}

func positiveID(value any) (int64, error) {
	switch v := value.(type) {
	case json.Number:
		id, err := v.Int64()
		if err == nil && id > 0 {
			return id, nil
		}
	case float64:
		id := int64(v)
		if float64(id) == v && id > 0 {
			return id, nil
		}
	case int64:
		if v > 0 {
			return v, nil
		}
	case int:
		if v > 0 {
			return int64(v), nil
		}
	case string:
		id, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		if err == nil && id > 0 {
			return id, nil
		}
	}
	return 0, errors.New("invalid_id")
}

func optionalPositiveID(value any) (*int64, error) {
	if value == nil || value == false || value == "" {
		return nil, nil
	}
	switch v := value.(type) {
	case json.Number:
		if v.String() == "0" {
			return nil, nil
		}
	case float64:
		if v == 0 {
			return nil, nil
		}
	case int:
		if v == 0 {
			return nil, nil
		}
	case int64:
		if v == 0 {
			return nil, nil
		}
	}
	id, err := positiveID(value)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func idList(value any) ([]int64, error) {
	values, ok := value.([]any)
	if !ok {
		return []int64{}, nil
	}
	ids := make([]int64, 0, len(values))
	for _, value := range values {
		id, err := positiveID(value)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprint(value)
}

func visibilityValue(value any) navigation.Visibility {
	if stringValue(value) == "public" {
		return navigation.VisibilityPublic
	}
	return navigation.VisibilityPrivate
}

func itemTypeValue(value any) navigation.ItemType {
	if stringValue(value) == "folder" {
		return navigation.ItemFolder
	}
	return navigation.ItemLink
}

func itemSizeValue(value any) navigation.ItemSize {
	switch stringValue(value) {
	case "2x1":
		return navigation.Size2x1
	case "2x2":
		return navigation.Size2x2
	default:
		return navigation.Size1x1
	}
}
