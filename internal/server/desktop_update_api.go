package server

import (
	"context"
	"net/http"
)

type DesktopUpdateStatus struct {
	Available        bool   `json:"available"`
	State            string `json:"state"`
	Channel          string `json:"channel"`
	CurrentVersion   string `json:"currentVersion"`
	LatestVersion    string `json:"latestVersion,omitempty"`
	UpdateAvailable  bool   `json:"updateAvailable"`
	ReleaseName      string `json:"releaseName,omitempty"`
	ReleaseURL       string `json:"releaseUrl,omitempty"`
	PublishedAt      string `json:"publishedAt,omitempty"`
	Prerelease       bool   `json:"prerelease"`
	AssetName        string `json:"assetName,omitempty"`
	AssetSize        int64  `json:"assetSize,omitempty"`
	Downloaded       int64  `json:"downloaded,omitempty"`
	Total            int64  `json:"total,omitempty"`
	Verified         bool   `json:"verified"`
	SHA256           string `json:"sha256,omitempty"`
	DownloadPath     string `json:"downloadPath,omitempty"`
	InstallationMode string `json:"installationMode"`
	CanAutoInstall   bool   `json:"canAutoInstall"`
	Message          string `json:"message,omitempty"`
	Error            string `json:"error,omitempty"`
}

type DesktopUpdateService interface {
	Status() DesktopUpdateStatus
	Check(context.Context) (DesktopUpdateStatus, error)
	StartDownload() (DesktopUpdateStatus, error)
	InstallAndRestart() (DesktopUpdateStatus, error)
}

func (s *Server) registerDesktopUpdateAPI(mux *http.ServeMux) {
	if s.desktopUpdate == nil {
		return
	}
	mux.HandleFunc("GET /api/desktop/update", s.handleDesktopUpdateStatus)
	mux.HandleFunc("POST /api/desktop/update/check", s.handleDesktopUpdateCheck)
	mux.HandleFunc("POST /api/desktop/update/download", s.handleDesktopUpdateDownload)
	mux.HandleFunc("POST /api/desktop/update/install", s.handleDesktopUpdateInstall)
}

func (s *Server) desktopUpdateAuthorized(w http.ResponseWriter, r *http.Request, mutate bool) bool {
	user, err := s.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth_failed"})
		return false
	}
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return false
	}
	if mutate && !sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return false
	}
	return true
}

func (s *Server) handleDesktopUpdateStatus(w http.ResponseWriter, r *http.Request) {
	if !s.desktopUpdateAuthorized(w, r, false) {
		return
	}
	writeJSON(w, http.StatusOK, s.desktopUpdate.Status())
}

func (s *Server) handleDesktopUpdateCheck(w http.ResponseWriter, r *http.Request) {
	if !s.desktopUpdateAuthorized(w, r, true) {
		return
	}
	status, err := s.desktopUpdate.Check(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "update_check_failed", "detail": err.Error(), "status": status})
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleDesktopUpdateDownload(w http.ResponseWriter, r *http.Request) {
	if !s.desktopUpdateAuthorized(w, r, true) {
		return
	}
	status, err := s.desktopUpdate.StartDownload()
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "update_download_failed", "detail": err.Error(), "status": status})
		return
	}
	writeJSON(w, http.StatusAccepted, status)
}

func (s *Server) handleDesktopUpdateInstall(w http.ResponseWriter, r *http.Request) {
	if !s.desktopUpdateAuthorized(w, r, true) {
		return
	}
	status, err := s.desktopUpdate.InstallAndRestart()
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "update_install_failed", "detail": err.Error(), "status": status})
		return
	}
	writeJSON(w, http.StatusAccepted, status)
}
