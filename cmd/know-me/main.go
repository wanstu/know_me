package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"

	"github.com/wanstu/know_me/internal/auth"
	"github.com/wanstu/know_me/internal/database"
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
	case "db":
		return databaseCommand(args[1:])
	case "admin":
		return adminCommand(args[1:])
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
	addStorageFlags(flags, &config)
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
		_ = app.Close()
		return err
	}

	fmt.Printf("Know Me %s\n", version)
	fmt.Printf("Listen:   http://%s\n", displayAddress(address))
	fmt.Printf("Health:   http://%s/api/health\n", displayAddress(address))
	fmt.Printf("Data:     %s\n", config.DataDir)
	fmt.Printf("Database: %s\n", database.ResolvePath(config.DataDir, config.Database))
	fmt.Printf("Uploads:  %s\n", config.UploadsDir)
	if config.SiteURL != "" {
		fmt.Printf("Site:     %s\n", config.SiteURL)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return app.Serve(ctx)
}

func databaseCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("missing db command; expected: migrate")
	}
	switch args[0] {
	case "migrate":
		config := runtimeconfig.Default()
		flags := flag.NewFlagSet("db migrate", flag.ContinueOnError)
		addStorageFlags(flags, &config)
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if err := config.EnsureDirectories(); err != nil {
			return err
		}
		path := database.ResolvePath(config.DataDir, config.Database)
		db, err := database.Open(path)
		if err != nil {
			return err
		}
		defer db.Close()
		ids, err := db.MigrationIDs()
		if err != nil {
			return err
		}
		fmt.Printf("Database ready: %s\n", path)
		fmt.Printf("Migrations: %s\n", strings.Join(ids, ", "))
		return nil
	default:
		return fmt.Errorf("unknown db command %q; expected: migrate", args[0])
	}
}

func adminCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("missing admin command; expected: init")
	}
	switch args[0] {
	case "init":
		return adminInit(args[1:])
	default:
		return fmt.Errorf("unknown admin command %q; expected: init", args[0])
	}
}

func adminInit(args []string) error {
	config := runtimeconfig.Default()
	flags := flag.NewFlagSet("admin init", flag.ContinueOnError)
	addStorageFlags(flags, &config)

	username := envOr("ADMIN_USERNAME", "admin")
	password := strings.TrimSpace(os.Getenv("ADMIN_PASSWORD"))
	displayName := strings.TrimSpace(os.Getenv("ADMIN_DISPLAY_NAME"))
	flags.StringVar(&username, "username", username, "administrator username")
	flags.StringVar(&password, "password", password, "administrator password; generated when omitted")
	flags.StringVar(&displayName, "display-name", displayName, "administrator display name")
	if err := flags.Parse(args); err != nil {
		return err
	}
	username = strings.TrimSpace(username)
	if displayName == "" {
		displayName = username
	}

	generated := false
	if password == "" {
		value, err := auth.GeneratePassword()
		if err != nil {
			return err
		}
		password = value
		generated = true
	}
	if len(password) < 10 {
		return fmt.Errorf("password_must_be_at_least_10_characters")
	}

	if err := config.EnsureDirectories(); err != nil {
		return err
	}
	path := database.ResolvePath(config.DataDir, config.Database)
	db, err := database.Open(path)
	if err != nil {
		return err
	}
	defer db.Close()

	created, err := auth.NewStore(db.SQL).UpsertAdmin(context.Background(), username, password, displayName)
	if err != nil {
		return err
	}
	if created {
		fmt.Printf("Created administrator: %s\n", username)
	} else {
		fmt.Printf("Updated administrator: %s\n", username)
	}
	fmt.Printf("Database: %s\n", path)
	if generated {
		fmt.Printf("Generated password: %s\n", password)
		fmt.Println("Store it now; it is not recoverable from the database.")
	}
	return nil
}

func addStorageFlags(flags *flag.FlagSet, config *runtimeconfig.Config) {
	flags.StringVar(&config.DataDir, "data-dir", config.DataDir, "persistent data directory")
	flags.StringVar(&config.UploadsDir, "uploads-dir", config.UploadsDir, "media uploads directory")
	flags.StringVar(&config.Database, "database", config.Database, "SQLite database path; defaults to <data-dir>/know-me.db")
}

func displayAddress(address string) string {
	if len(address) > 0 && address[0] == ':' {
		return "127.0.0.1" + address
	}
	return address
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func printHelp() {
	fmt.Print("Know Me native runtime\n\n" +
		"Usage:\n" +
		"  know-me serve [options]\n" +
		"  know-me db migrate [options]\n" +
		"  know-me admin init [options]\n" +
		"  know-me version\n\n" +
		"Serve options:\n" +
		"  --listen       HTTP listen address (default 127.0.0.1:3000)\n" +
		"  --data-dir     persistent data directory (default ./data)\n" +
		"  --uploads-dir  media uploads directory (default ./uploads)\n" +
		"  --database     SQLite path (default <data-dir>/know-me.db)\n" +
		"  --site-url     public URL used by generated links\n\n" +
		"Admin init:\n" +
		"  --username      administrator username (default admin)\n" +
		"  --password      password; generated when omitted\n" +
		"  --display-name  display name\n\n" +
		"Environment:\n" +
		"  KNOW_ME_LISTEN\n" +
		"  KNOW_ME_DATA_DIR\n" +
		"  KNOW_ME_UPLOADS_DIR\n" +
		"  KNOW_ME_DATABASE\n" +
		"  DATABASE_URL\n" +
		"  SITE_URL\n" +
		"  ADMIN_USERNAME\n" +
		"  ADMIN_PASSWORD\n" +
		"  ADMIN_DISPLAY_NAME\n")
}
