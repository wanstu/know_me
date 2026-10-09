package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/wanstu/know_me/internal/auth"
	backupstore "github.com/wanstu/know_me/internal/backup"
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
	case "config":
		return configCommand(args[1:])
	case "backup":
		return backupCommand(args[1:])
	case "service":
		return serviceCommand(args[1:])
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
	config, err := runtimeconfig.Load()
	if err != nil {
		return err
	}
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	flags.StringVar(&config.Listen, "listen", config.Listen, "HTTP 监听地址")
	addStorageFlags(flags, &config)
	flags.StringVar(&config.SiteURL, "site-url", config.SiteURL, "站点公开地址")
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
	fmt.Printf("Bind:     %s\n", address)
	fmt.Printf("Local:    http://%s\n", displayAddress(address))
	fmt.Printf("Health:   http://%s/api/health\n", displayAddress(address))
	fmt.Printf("Data:     %s\n", config.DataDir)
	fmt.Printf("Database: %s\n", database.ResolvePath(config.DataDir, config.Database))
	fmt.Printf("Uploads:  %s\n", config.UploadsDir)
	if configPath, pathErr := runtimeconfig.ConfigPath(); pathErr == nil {
		fmt.Printf("Config:   %s\n", configPath)
	}
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
		config, err := runtimeconfig.Load()
		if err != nil {
			return err
		}
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
	config, err := runtimeconfig.Load()
	if err != nil {
		return err
	}
	flags := flag.NewFlagSet("admin init", flag.ContinueOnError)
	addStorageFlags(flags, &config)

	username := envOr("ADMIN_USERNAME", "admin")
	password := strings.TrimSpace(os.Getenv("ADMIN_PASSWORD"))
	displayName := strings.TrimSpace(os.Getenv("ADMIN_DISPLAY_NAME"))
	flags.StringVar(&username, "username", username, "管理员用户名")
	flags.StringVar(&password, "password", password, "管理员密码；省略时随机生成")
	flags.StringVar(&displayName, "display-name", displayName, "管理员显示名称")
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

func configCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("missing config command; expected: path, show, or init")
	}
	switch args[0] {
	case "path":
		path, err := runtimeconfig.ConfigPath()
		if err != nil {
			return err
		}
		fmt.Println(path)
		return nil
	case "show":
		config, err := runtimeconfig.Load()
		if err != nil {
			return err
		}
		path, err := runtimeconfig.ConfigPath()
		if err != nil {
			return err
		}
		payload := struct {
			Path   string               `json:"path"`
			Config runtimeconfig.Config `json:"config"`
		}{Path: path, Config: config}
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(payload)
	case "init":
		path, err := runtimeconfig.ConfigPath()
		if err != nil {
			return err
		}
		if _, err := os.Stat(path); err == nil {
			return fmt.Errorf("config already exists: %s", path)
		} else if !os.IsNotExist(err) {
			return err
		}
		config := runtimeconfig.Default()
		path, err = runtimeconfig.Save(config)
		if err != nil {
			return err
		}
		fmt.Printf("Created config: %s\n", path)
		return nil
	default:
		return fmt.Errorf("unknown config command %q; expected: path, show, or init", args[0])
	}
}

func backupCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("missing backup command; expected: export or restore")
	}
	switch args[0] {
	case "export":
		return backupExport(args[1:])
	case "restore":
		return backupRestore(args[1:])
	default:
		return fmt.Errorf("unknown backup command %q; expected: export or restore", args[0])
	}
}

func backupExport(args []string) error {
	config, err := runtimeconfig.Load()
	if err != nil {
		return err
	}
	flags := flag.NewFlagSet("backup export", flag.ContinueOnError)
	addStorageFlags(flags, &config)
	output := ""
	flags.StringVar(&output, "output", output, "备份 ZIP 输出路径")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if err := config.EnsureDirectories(); err != nil {
		return err
	}

	dbPath := database.ResolvePath(config.DataDir, config.Database)
	db, err := database.Open(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	store, err := backupstore.NewStore(db.SQL, config.UploadsDir)
	if err != nil {
		return err
	}
	body, err := store.Create(context.Background())
	if err != nil {
		return err
	}
	if strings.TrimSpace(output) == "" {
		output = "know_me-backup-" + time.Now().Format("2006-01-02_15-04") + ".zip"
	}
	output = filepath.Clean(output)
	if dir := filepath.Dir(output); dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	if err := os.WriteFile(output, body, 0o600); err != nil {
		return err
	}
	fmt.Printf("Backup written: %s\n", output)
	fmt.Printf("Bytes: %d\n", len(body))
	return nil
}

func backupRestore(args []string) error {
	config, err := runtimeconfig.Load()
	if err != nil {
		return err
	}
	flags := flag.NewFlagSet("backup restore", flag.ContinueOnError)
	addStorageFlags(flags, &config)
	input := ""
	flags.StringVar(&input, "file", input, "需要恢复的备份 ZIP 路径")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(input) == "" {
		return fmt.Errorf("backup file is required")
	}
	if err := config.EnsureDirectories(); err != nil {
		return err
	}

	info, err := os.Stat(input)
	if err != nil {
		return err
	}
	if info.Size() <= 0 || info.Size() > int64(backupstore.MaxBytes) {
		return fmt.Errorf("backup_size_invalid")
	}
	body, err := os.ReadFile(input)
	if err != nil {
		return err
	}

	dbPath := database.ResolvePath(config.DataDir, config.Database)
	db, err := database.Open(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	store, err := backupstore.NewStore(db.SQL, config.UploadsDir)
	if err != nil {
		return err
	}
	result, err := store.Restore(context.Background(), body)
	if err != nil {
		return err
	}
	fmt.Printf("Backup restored: %s\n", input)
	fmt.Printf("Posts: %d, navigation items: %d, media: %d\n", result.Posts, result.NavigationItems, result.Media)
	return nil
}

func addStorageFlags(flags *flag.FlagSet, config *runtimeconfig.Config) {
	flags.StringVar(&config.DataDir, "data-dir", config.DataDir, "持久化数据目录")
	flags.StringVar(&config.UploadsDir, "uploads-dir", config.UploadsDir, "上传文件目录")
	flags.StringVar(&config.Database, "database", config.Database, "SQLite 数据库路径；默认 <data-dir>/know-me.db")
}

func displayAddress(address string) string {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return address
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		return net.JoinHostPort("127.0.0.1", port)
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
	fmt.Print(`Know Me 原生服务端

用法：
  know-me <命令> [选项]

命令：
  serve                 启动 HTTP 服务（无参数时的默认操作）
  db migrate            初始化或升级数据库
  admin init            初始化或更新管理员
  config path|show|init 查看配置文件路径、内容或创建默认配置
  backup export         导出备份（--output 文件.zip）
  backup restore        恢复备份（--file 文件.zip）
  service               管理 .deb 安装的 Linux systemd 服务
  version               查看版本信息
  help                  显示本帮助

服务管理：
  know-me service status    查看运行状态和开机自启状态
  know-me service start     启动服务
  know-me service stop      停止服务
  know-me service restart   重启服务
  know-me service enable    启用开机自启
  know-me service disable   关闭开机自启
  know-me service --help    查看服务管理说明

启动选项：
  --listen       HTTP 监听地址（默认 0.0.0.0:3000）
  --data-dir     持久化数据目录（默认 ./data）
  --uploads-dir  上传文件目录（默认 ./uploads）
  --database     SQLite 数据库路径（默认 <data-dir>/know-me.db）
  --site-url     用于生成链接的站点公开地址

管理员初始化选项：
  --username      管理员用户名（默认 admin）
  --password      管理员密码（省略则随机生成）
  --display-name  管理员显示名称

环境变量：
  KNOW_ME_LISTEN
  KNOW_ME_DATA_DIR
  KNOW_ME_UPLOADS_DIR
  KNOW_ME_DATABASE
  DATABASE_URL
  SITE_URL
  ADMIN_USERNAME
  ADMIN_PASSWORD
  ADMIN_DISPLAY_NAME

提示：可使用 know-me <命令> -h 查看各命令选项。
`)
}
