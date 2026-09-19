package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/wanstu/know_me/internal/auth"
	"github.com/wanstu/know_me/internal/backup"
	"github.com/wanstu/know_me/internal/blog"
	"github.com/wanstu/know_me/internal/database"
	"github.com/wanstu/know_me/internal/media"
	"github.com/wanstu/know_me/internal/navigation"
	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
	"github.com/wanstu/know_me/internal/settings"
	"github.com/wanstu/know_me/internal/webassets"
	kittheme "github.com/wanstu/wails-desktop-kit/theme"
)

type BuildInfo struct {
	Version   string
	Commit    string
	BuildTime string
}

type Server struct {
	config       runtimeconfig.Config
	build        BuildInfo
	startedAt    time.Time
	http         *http.Server
	listener     net.Listener
	database     *database.DB
	auth         *auth.Store
	settings     *settings.Store
	navigation   *navigation.Store
	blog         *blog.Store
	media        *media.Store
	backup       *backup.Store
	theme        *kittheme.Manager
	loginLimiter *loginLimiter
}

func New(config runtimeconfig.Config, build BuildInfo) (*Server, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	if err := config.EnsureDirectories(); err != nil {
		return nil, err
	}

	dbPath := database.ResolvePath(config.DataDir, config.Database)
	db, err := database.Open(dbPath)
	if err != nil {
		return nil, fmt.Errorf("database: %w", err)
	}

	assets, err := webassets.FS()
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("mount web assets: %w", err)
	}

	mediaStore, err := media.NewStore(db.SQL, config.UploadsDir)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("media: %w", err)
	}
	backupStore, err := backup.NewStore(db.SQL, config.UploadsDir)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("backup: %w", err)
	}
	themeManager, err := kittheme.New(kittheme.DefaultConfig())
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("theme runtime: %w", err)
	}

	s := &Server{
		config:       config,
		build:        build,
		startedAt:    time.Now(),
		database:     db,
		auth:         auth.NewStore(db.SQL),
		settings:     settings.NewStore(db.SQL),
		navigation:   navigation.NewStore(db.SQL),
		blog:         blog.NewStore(db.SQL),
		media:        mediaStore,
		backup:       backupStore,
		theme:        themeManager,
		loginLimiter: newLoginLimiter(),
	}
	mux := http.NewServeMux()
	s.registerAPI(mux)
	s.registerNavigationAPI(mux)
	s.registerBlogAPI(mux)
	s.registerMediaAPI(mux)
	s.registerBackupAPI(mux)
	mux.Handle("/desktopkit-theme/", themeManager.Handler())
	mux.Handle("/", spaHandler(assets))

	s.http = &http.Server{
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       90 * time.Second,
	}
	return s, nil
}

func (s *Server) Listen() (string, error) {
	if s.listener != nil {
		return s.listener.Addr().String(), nil
	}
	listener, err := net.Listen("tcp", s.config.Listen)
	if err != nil {
		return "", err
	}
	s.listener = listener
	return listener.Addr().String(), nil
}

func (s *Server) Serve(ctx context.Context) error {
	defer s.Close()
	if _, err := s.Listen(); err != nil {
		return err
	}

	errCh := make(chan error, 1)
	go func() {
		err := s.http.Serve(s.listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := s.http.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("shutdown: %w", err)
		}
		return nil
	case err := <-errCh:
		return err
	}
}

func (s *Server) Close() error {
	if s.database == nil {
		return nil
	}
	err := s.database.Close()
	s.database = nil
	return err
}

func (s *Server) Address() string {
	if s.listener == nil {
		return s.config.Listen
	}
	return s.listener.Addr().String()
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	status := "ok"
	databaseStatus := "ok"
	if s.database == nil || s.database.Ping() != nil {
		status = "degraded"
		databaseStatus = "error"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":     status,
		"database":   databaseStatus,
		"version":    s.build.Version,
		"commit":     s.build.Commit,
		"uptime_sec": int64(time.Since(s.startedAt).Seconds()),
		"time":       time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.build)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("write json response", "error", err)
	}
}

func spaHandler(root fs.FS) http.Handler {
	files := http.FileServer(http.FS(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if _, err := fs.Stat(root, path); err == nil {
			files.ServeHTTP(w, r)
			return
		}
		if strings.Contains(path, ".") {
			http.NotFound(w, r)
			return
		}
		clone := r.Clone(r.Context())
		urlCopy := *r.URL
		urlCopy.Path = "/"
		clone.URL = &urlCopy
		files.ServeHTTP(w, clone)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}
