package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
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
	url string
}

func (b *DesktopBridge) URL() string {
	return b.url
}

type coreRuntime struct {
	server *server.Server
	cancel context.CancelFunc
	done   chan error
	once   sync.Once
}

func startCore(config runtimeconfig.Config) (*coreRuntime, string, error) {
	// The desktop wrapper always binds the embedded HTTP Core to a private
	// ephemeral loopback port. Server deployments continue to use know-me serve.
	config.Listen = coreHost
	// Desktop uses a loopback HTTP origin even when the same data/config is also
	// used by an HTTPS server deployment. Do not inherit public SiteURL cookie policy.
	config.SiteURL = ""

	core, err := server.New(config, server.BuildInfo{
		Version:   version,
		Commit:    commit,
		BuildTime: buildTime,
	})
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

func run() error {
	launch, err := desktopkit.ParseLaunchOptions(os.Args[1:])
	if err != nil {
		return err
	}
	config, err := runtimeconfig.Load()
	if err != nil {
		return err
	}
	core, coreURL, err := startCore(config)
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

	bridge := &DesktopBridge{url: coreURL}

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
			Shutdown: func(context.Context) {
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
