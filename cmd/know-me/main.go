package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"syscall"

	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
	"github.com/wanstu/know_me/internal/server"
)

var (
	version   = "dev"
	commit    = "unknown"
	buildTime = "unknown"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "know-me:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		args = []string{"serve"}
	}

	switch args[0] {
	case "serve":
		return serve(args[1:])
	case "version", "--version", "-v":
		fmt.Printf("know-me %s (%s) %s/%s built %s\n", version, commit, runtime.GOOS, runtime.GOARCH, buildTime)
		return nil
	case "help", "--help", "-h":
		printHelp()
		return nil
	default:
		return fmt.Errorf("unknown command %q; run know-me help", args[0])
	}
}

func serve(args []string) error {
	config := runtimeconfig.Default()
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	flags.StringVar(&config.Listen, "listen", config.Listen, "HTTP listen address")
	flags.StringVar(&config.DataDir, "data-dir", config.DataDir, "persistent data directory")
	flags.StringVar(&config.UploadsDir, "uploads-dir", config.UploadsDir, "media uploads directory")
	flags.StringVar(&config.SiteURL, "site-url", config.SiteURL, "public site URL")
	if err := flags.Parse(args); err != nil {
		return err
	}

	app, err := server.New(config, server.BuildInfo{
		Version: version, Commit: commit, BuildTime: buildTime,
	})
	if err != nil {
		return err
	}
	address, err := app.Listen()
	if err != nil {
		return err
	}

	fmt.Printf("Know Me %s\n", version)
	fmt.Printf("Listen:  http://%s\n", displayAddress(address))
	fmt.Printf("Health:  http://%s/api/health\n", displayAddress(address))
	fmt.Printf("Data:    %s\n", config.DataDir)
	fmt.Printf("Uploads: %s\n", config.UploadsDir)
	if config.SiteURL != "" {
		fmt.Printf("Site:    %s\n", config.SiteURL)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return app.Serve(ctx)
}

func displayAddress(address string) string {
	if len(address) > 0 && address[0] == ':' {
		return "127.0.0.1" + address
	}
	return address
}

func printHelp() {
	fmt.Print(`Know Me native runtime

Usage:
  know-me serve [options]
  know-me version

Serve options:
  --listen       HTTP listen address (default 127.0.0.1:3000)
  --data-dir     persistent data directory (default ./data)
  --uploads-dir  media uploads directory (default ./uploads)
  --site-url     public URL used by generated links

Environment:
  KNOW_ME_LISTEN
  KNOW_ME_DATA_DIR
  KNOW_ME_UPLOADS_DIR
  SITE_URL
`)
}
