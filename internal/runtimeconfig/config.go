package runtimeconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"

	kitpaths "github.com/wanstu/wails-desktop-kit/paths"
)

const (
	AppID             = "know-me"
	ConfigFileName    = "settings.json"
	DefaultListen     = "127.0.0.1:3000"
	DefaultDataDir    = "./data"
	DefaultUploadsDir = "./uploads"
)

type Config struct {
	Listen     string `json:"listen"`
	DataDir    string `json:"dataDir"`
	UploadsDir string `json:"uploadsDir"`
	Database   string `json:"database,omitempty"`
	SiteURL    string `json:"siteUrl,omitempty"`
}

// Default returns the built-in defaults with environment overrides.
// It intentionally does not access the filesystem.
func Default() Config {
	config := Config{
		Listen:     DefaultListen,
		DataDir:    DefaultDataDir,
		UploadsDir: DefaultUploadsDir,
	}
	applyEnvironment(&config)
	return config
}

// Load reads ~/.config/know-me/settings.json (or $XDG_CONFIG_HOME/know-me/settings.json)
// and then applies environment overrides. CLI flags are applied by callers last.
func Load() (Config, error) {
	config := Config{
		Listen:     DefaultListen,
		DataDir:    DefaultDataDir,
		UploadsDir: DefaultUploadsDir,
	}
	path, err := ConfigPath()
	if err != nil {
		return Config{}, err
	}
	body, err := os.ReadFile(path)
	switch {
	case err == nil:
		if err := json.Unmarshal(body, &config); err != nil {
			return Config{}, fmt.Errorf("decode config %s: %w", path, err)
		}
	case errors.Is(err, os.ErrNotExist):
		// First run: defaults remain in effect until a config file is created.
	default:
		return Config{}, fmt.Errorf("read config %s: %w", path, err)
	}
	normalizeDefaults(&config)
	applyEnvironment(&config)
	return config, nil
}

func ConfigPath() (string, error) {
	dir, err := kitpaths.ConfigDir(AppID)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, ConfigFileName), nil
}

func EnsureConfigDir() (string, error) {
	return kitpaths.EnsureConfigDir(AppID)
}

// Save writes only ordinary runtime settings. Passwords, tokens, session secrets,
// and other sensitive values must not be added to this file.
func Save(config Config) (string, error) {
	normalizeDefaults(&config)
	if err := config.Validate(); err != nil {
		return "", err
	}
	dir, err := EnsureConfigDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, ConfigFileName)
	body, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return "", fmt.Errorf("encode config: %w", err)
	}
	body = append(body, '\n')
	temp, err := os.CreateTemp(dir, ".settings-*.tmp")
	if err != nil {
		return "", fmt.Errorf("create config temp file: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return "", fmt.Errorf("protect config temp file: %w", err)
	}
	if _, err := temp.Write(body); err != nil {
		_ = temp.Close()
		return "", fmt.Errorf("write config temp file: %w", err)
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return "", fmt.Errorf("sync config temp file: %w", err)
	}
	if err := temp.Close(); err != nil {
		return "", fmt.Errorf("close config temp file: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return "", fmt.Errorf("replace config file: %w", err)
	}
	return path, nil
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

func normalizeDefaults(config *Config) {
	if strings.TrimSpace(config.Listen) == "" {
		config.Listen = DefaultListen
	}
	if strings.TrimSpace(config.DataDir) == "" {
		config.DataDir = DefaultDataDir
	}
	if strings.TrimSpace(config.UploadsDir) == "" {
		config.UploadsDir = DefaultUploadsDir
	}
	config.Listen = strings.TrimSpace(config.Listen)
	config.DataDir = strings.TrimSpace(config.DataDir)
	config.UploadsDir = strings.TrimSpace(config.UploadsDir)
	config.Database = strings.TrimSpace(config.Database)
	config.SiteURL = strings.TrimSpace(config.SiteURL)
}

func applyEnvironment(config *Config) {
	if value := strings.TrimSpace(os.Getenv("KNOW_ME_LISTEN")); value != "" {
		config.Listen = value
	}
	if value := strings.TrimSpace(os.Getenv("KNOW_ME_DATA_DIR")); value != "" {
		config.DataDir = value
	}
	if value := strings.TrimSpace(os.Getenv("KNOW_ME_UPLOADS_DIR")); value != "" {
		config.UploadsDir = value
	}
	if value := firstNonEmpty(os.Getenv("KNOW_ME_DATABASE"), os.Getenv("DATABASE_URL")); value != "" {
		config.Database = value
	}
	if value := strings.TrimSpace(os.Getenv("SITE_URL")); value != "" {
		config.SiteURL = value
	}
	normalizeDefaults(config)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
