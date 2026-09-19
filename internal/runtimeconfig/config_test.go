package runtimeconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadUsesKitConfigDirAndEnvironmentPrecedence(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("KNOW_ME_LISTEN", "")
	t.Setenv("KNOW_ME_DATA_DIR", "")
	t.Setenv("KNOW_ME_UPLOADS_DIR", "")
	t.Setenv("KNOW_ME_DATABASE", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("SITE_URL", "")

	dir := filepath.Join(root, AppID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(Config{
		Listen:     "127.0.0.1:3456",
		DataDir:    "site-data",
		UploadsDir: "site-uploads",
		Database:   "site-data/site.db",
		SiteURL:    "https://example.test",
	})
	if err := os.WriteFile(filepath.Join(dir, ConfigFileName), body, 0o600); err != nil {
		t.Fatal(err)
	}

	config, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if config.Listen != "127.0.0.1:3456" || config.DataDir != "site-data" || config.SiteURL != "https://example.test" {
		t.Fatalf("file config not loaded: %#v", config)
	}

	t.Setenv("KNOW_ME_LISTEN", "127.0.0.1:4567")
	t.Setenv("SITE_URL", "https://env.example.test")
	config, err = Load()
	if err != nil {
		t.Fatal(err)
	}
	if config.Listen != "127.0.0.1:4567" || config.SiteURL != "https://env.example.test" {
		t.Fatalf("environment did not override file: %#v", config)
	}
}

func TestSaveWritesOrdinaryConfig(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", root)

	path, err := Save(Config{
		Listen:     "127.0.0.1:3000",
		DataDir:    "./data",
		UploadsDir: "./uploads",
		SiteURL:    "https://example.test",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, AppID, ConfigFileName)
	if path != want {
		t.Fatalf("path = %q, want %q", path, want)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.IsDir() {
		t.Fatal("config path is a directory")
	}
}
