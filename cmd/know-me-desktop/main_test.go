package main

import (
	"path/filepath"
	"testing"

	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

func TestApplyDesktopStorageDefaultsForFreshInstall(t *testing.T) {
	config := runtimeconfig.Default()
	configDir := t.TempDir()

	got := applyDesktopStorageDefaults(config, configDir, true, false, func(string) string { return "" })

	if want := filepath.Join(configDir, "data"); got.DataDir != want {
		t.Fatalf("DataDir = %q want %q", got.DataDir, want)
	}
	if want := filepath.Join(configDir, "uploads"); got.UploadsDir != want {
		t.Fatalf("UploadsDir = %q want %q", got.UploadsDir, want)
	}
}

func TestApplyDesktopStorageDefaultsKeepsPortableBehavior(t *testing.T) {
	config := runtimeconfig.Default()
	got := applyDesktopStorageDefaults(config, t.TempDir(), false, false, func(string) string { return "" })

	if got.DataDir != runtimeconfig.DefaultDataDir {
		t.Fatalf("portable DataDir = %q want %q", got.DataDir, runtimeconfig.DefaultDataDir)
	}
	if got.UploadsDir != runtimeconfig.DefaultUploadsDir {
		t.Fatalf("portable UploadsDir = %q want %q", got.UploadsDir, runtimeconfig.DefaultUploadsDir)
	}
}

func TestApplyDesktopStorageDefaultsRespectsExistingConfig(t *testing.T) {
	config := runtimeconfig.Default()
	config.DataDir = "D:\\existing\\data"
	config.UploadsDir = "D:\\existing\\uploads"

	got := applyDesktopStorageDefaults(config, t.TempDir(), true, true, func(string) string { return "" })

	if got.DataDir != config.DataDir || got.UploadsDir != config.UploadsDir {
		t.Fatalf("existing config changed: got=%+v want=%+v", got, config)
	}
}

func TestApplyDesktopStorageDefaultsRespectsEnvironmentOverrides(t *testing.T) {
	config := runtimeconfig.Default()
	config.DataDir = "D:\\env\\data"
	config.UploadsDir = "D:\\env\\uploads"
	env := map[string]string{
		"KNOW_ME_DATA_DIR":    config.DataDir,
		"KNOW_ME_UPLOADS_DIR": config.UploadsDir,
	}

	got := applyDesktopStorageDefaults(config, t.TempDir(), true, false, func(key string) string { return env[key] })

	if got.DataDir != config.DataDir || got.UploadsDir != config.UploadsDir {
		t.Fatalf("environment overrides changed: got=%+v want=%+v", got, config)
	}
}
