package runtimeconfig

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
)

const (
	DefaultListen     = "127.0.0.1:3000"
	DefaultDataDir    = "./data"
	DefaultUploadsDir = "./uploads"
)

type Config struct {
	Listen     string
	DataDir    string
	UploadsDir string
	Database   string
	SiteURL    string
}

func Default() Config {
	return Config{
		Listen:     envOr("KNOW_ME_LISTEN", DefaultListen),
		DataDir:    envOr("KNOW_ME_DATA_DIR", DefaultDataDir),
		UploadsDir: envOr("KNOW_ME_UPLOADS_DIR", DefaultUploadsDir),
		Database:   firstNonEmpty(os.Getenv("KNOW_ME_DATABASE"), os.Getenv("DATABASE_URL")),
		SiteURL:    strings.TrimSpace(os.Getenv("SITE_URL")),
	}
}

func (c Config) Validate() error {
	if _, _, err := net.SplitHostPort(c.Listen); err != nil {
		return fmt.Errorf("invalid listen address %q: %w", c.Listen, err)
	}
	if strings.TrimSpace(c.DataDir) == "" {
		return fmt.Errorf("data dir must not be empty")
	}
	if strings.TrimSpace(c.UploadsDir) == "" {
		return fmt.Errorf("uploads dir must not be empty")
	}
	return nil
}

func (c Config) EnsureDirectories() error {
	for _, dir := range []string{c.DataDir, c.UploadsDir} {
		clean := filepath.Clean(dir)
		if err := os.MkdirAll(clean, 0o755); err != nil {
			return fmt.Errorf("create %s: %w", clean, err)
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
