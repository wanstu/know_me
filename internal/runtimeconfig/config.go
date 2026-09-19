package runtimeconfig

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"

	"github.com/wanstu/wails-desktop-kit/jsonstore"
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

func baseDefault() Config {
	return Config{
		Listen:     DefaultListen,
		DataDir:    DefaultDataDir,
		UploadsDir: DefaultUploadsDir,
	}
}

// Default returns the built-in defaults with environment overrides.
// It intentionally does not access the filesystem.
func Default() Config {
	config := baseDefault()
	applyEnvironment(&config)
	return config
}

func configStore(path string, validate bool) *jsonstore.Store[Config] {
	options := jsonstore.Options[Config]{
		Default: baseDefault,
		Normalize: func(config *Config) {
			normalizeDefaults(config)
		},
	}
	if validate {
		options.Validate = func(config Config) error { return config.Validate() }
	}
	return jsonstore.New(path, options)
}

// Load reads ~/.config/know-me/settings.json (or $XDG_CONFIG_HOME/know-me/settings.json)
// and then applies environment overrides. CLI flags are applied by callers last.
func Load() (Config, error) {
	path, err := ConfigPath()
	if err != nil {
		return Config{}, err
	}
	config, err := configStore(path, false).Load()
	if err != nil {
		return Config{}, fmt.Errorf("read config %s: %w", path, err)
	}
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
	path, err := ConfigPath()
	if err != nil {
		return "", err
	}
	if err := configStore(path, true).Save(config); err != nil {
		return "", fmt.Errorf("save config: %w", err)
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
