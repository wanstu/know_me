package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/wanstu/know_me/internal/desktopupdate"
	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
	"github.com/wanstu/know_me/internal/server"
	desktopkit "github.com/wanstu/wails-desktop-kit"
	"github.com/wanstu/wails-desktop-kit/autostart"
)

const (
	appID    = "know-me"
	appTitle = "Know Me"
	autoArg  = "--autostart"
	coreHost = "127.0.0.1:0"
)

var (
	version   = "dev"
	commit    = "unknown"
	buildTime = "unknown"
)

//go:embed all:frontend
var frontend embed.FS

//go:embed assets/appicon.png
var appIcon []byte

type DesktopBridge struct {
	url          string
	openExternal func(string) error
}

func (b *DesktopBridge) URL() string {
	return b.url
}

func (b *DesktopBridge) OpenExternalURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return errors.New("invalid external browser URL")
	}
	if b.openExternal == nil {
		return errors.New("desktop browser is not ready")
	}
	return b.openExternal(raw)
}

type coreRuntime struct {
	server *server.Server
	cancel context.CancelFunc
	done   chan error
	once   sync.Once
}

func startCore(config runtimeconfig.Config, updateService server.DesktopUpdateService) (*coreRuntime, string, error) {
	// The desktop wrapper always binds the embedded HTTP Core to a private
	// ephemeral loopback port. Server deployments continue to use know-me serve.
	config.Listen = coreHost
	// Desktop uses a loopback HTTP origin even when the same data/config is also
	// used by an HTTPS server deployment. Do not inherit public SiteURL cookie policy.
	config.SiteURL = ""

	core, err := server.NewWithOptions(config, server.BuildInfo{
		Version:   version,
		Commit:    commit,
		BuildTime: buildTime,
	}, server.ServerOptions{DesktopUpdate: updateService})
	if err != nil {
		return nil, "", err
	}
	address, err := core.Listen()
	if err != nil {
		_ = core.Close()
		return nil, "", err
	}

	ctx, cancel := context.WithCancel(context.Background())
	runtime := &coreRuntime{
		server: core,
		cancel: cancel,
		done:   make(chan error, 1),
	}
	go func() {
		runtime.done <- core.Serve(ctx)
	}()

	return runtime, "http://" + normalizeLoopbackAddress(address), nil
}

func normalizeLoopbackAddress(address string) string {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return address
	}
	if host == "" || host == "::" || host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, port)
}

func (c *coreRuntime) stop() error {
	var result error
	c.once.Do(func() {
		c.cancel()
		select {
		case err := <-c.done:
			result = err
		case <-time.After(12 * time.Second):
			result = errors.New("native core shutdown timed out")
		}
	})
	return result
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "know-me-desktop:", err)
		os.Exit(1)
	}
}

func loadDesktopConfig() (runtimeconfig.Config, error) {
	configPath, err := runtimeconfig.ConfigPath()
	if err != nil {
		return runtimeconfig.Config{}, err
	}
	_, statErr := os.Stat(configPath)
	hasConfig := statErr == nil
	if statErr != nil && !os.IsNotExist(statErr) {
		return runtimeconfig.Config{}, fmt.Errorf("stat desktop config: %w", statErr)
	}

	config, err := runtimeconfig.Load()
	if err != nil {
		return runtimeconfig.Config{}, err
	}
	return applyDesktopStorageDefaults(
		config,
		filepath.Dir(configPath),
		installedDesktopExecutable(),
		hasConfig,
		os.Getenv,
	), nil
}

func applyDesktopStorageDefaults(config runtimeconfig.Config, configDir string, installed, hasConfig bool, getenv func(string) string) runtimeconfig.Config {
	if !installed || hasConfig {
		return config
	}
	if strings.TrimSpace(getenv("KNOW_ME_DATA_DIR")) == "" {
		config.DataDir = filepath.Join(configDir, "data")
	}
	if strings.TrimSpace(getenv("KNOW_ME_UPLOADS_DIR")) == "" {
		config.UploadsDir = filepath.Join(configDir, "uploads")
	}
	return config
}

func installedDesktopExecutable() bool {
	executable, err := os.Executable()
	if err != nil {
		return false
	}
	info, err := os.Stat(filepath.Join(filepath.Dir(executable), "Uninstall.exe"))
	return err == nil && !info.IsDir()
}

func run() error {
	launch, err := desktopkit.ParseLaunchOptions(os.Args[1:])
	if err != nil {
		return err
	}
	config, err := loadDesktopConfig()
	if err != nil {
		return err
	}

	var controllerMu sync.RWMutex
	var controller *desktopkit.Controller
	canQuit := func() bool {
		controllerMu.RLock()
		defer controllerMu.RUnlock()
		return controller != nil
	}
	quit := func() error {
		controllerMu.RLock()
		current := controller
		controllerMu.RUnlock()
		if current == nil {
			return errors.New("desktop controller is not ready")
		}
		current.Quit()
		return nil
	}
	updateService, err := desktopupdate.New(desktopupdate.Config{
		AppID:             appID,
		CurrentVersion:    version,
		Owner:             "wanstu",
		Repository:        "know_me",
		IncludePrerelease: strings.Contains(version, "-") || strings.EqualFold(strings.TrimSpace(os.Getenv("KNOW_ME_UPDATE_CHANNEL")), "prerelease"),
		CanQuit:           canQuit,
		Quit:              quit,
	})
	if err != nil {
		return fmt.Errorf("configure desktop updater: %w", err)
	}

	core, coreURL, err := startCore(config, updateService)
	if err != nil {
		return fmt.Errorf("start native core: %w", err)
	}
	defer core.stop()

	assets, err := fs.Sub(frontend, "frontend")
	if err != nil {
		return err
	}
	login, err := autostart.New(autostart.Config{
		ID:          appID,
		DisplayName: appTitle,
		Arguments:   []string{autoArg},
	})
	if err != nil {
		return err
	}

	window := desktopkit.DefaultWindowConfig()
	window.Width = 1280
	window.Height = 820
	window.MinWidth = 820
	window.MinHeight = 600

	bridge := &DesktopBridge{url: coreURL, openExternal: func(target string) error {
		controllerMu.RLock()
		current := controller
		controllerMu.RUnlock()
		if current == nil {
			return errors.New("desktop controller is not ready")
		}
		return current.OpenURL(target)
	}}

	var shutdownErr error
	err = desktopkit.Run(desktopkit.Config{
		ID:                   appID,
		Title:                appTitle,
		Assets:               assets,
		Bind:                 []interface{}{bridge},
		Launch:               launch,
		Window:               window,
		SingleInstance:       true,
		SecondInstancePolicy: desktopkit.SecondInstanceWakeManual,
		Tray: desktopkit.TrayConfig{
			Enabled:            true,
			Icon:               appIcon,
			Tooltip:            appTitle,
			ShowLabel:          "显示 Know Me",
			HideLabel:          "隐藏 Know Me",
			LaunchAtLoginLabel: "登录时启动",
			QuitLabel:          "退出",
			AutoStart:          login,
			Items: []desktopkit.TrayItem{
				desktopkit.Action("在系统浏览器打开", func(controller *desktopkit.Controller) error {
					if controller == nil {
						return errors.New("desktop controller is not ready")
					}
					return controller.OpenURL(coreURL)
				}),
			},
		},
		Hooks: desktopkit.Hooks{
			Ready: func(current *desktopkit.Controller) {
				controllerMu.Lock()
				controller = current
				controllerMu.Unlock()
			},
			Shutdown: func(context.Context) {
				controllerMu.Lock()
				controller = nil
				controllerMu.Unlock()
				updateService.Close()
				shutdownErr = core.stop()
			},
			TrayError: func(ctx context.Context, trayErr error) {
				if trayErr != nil {
					wailsruntime.LogErrorf(ctx, "tray unavailable: %v", trayErr)
				}
			},
		},
	})
	if err != nil {
		return err
	}
	return shutdownErr
}
