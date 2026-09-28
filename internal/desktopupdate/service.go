package desktopupdate

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wanstu/know_me/internal/server"
	"github.com/wanstu/wails-desktop-kit/updater"
)

type Config struct {
	AppID             string
	CurrentVersion    string
	Owner             string
	Repository        string
	IncludePrerelease bool
	DownloadDir       string
	CanQuit           func() bool
	Quit              func() error
}

type Service struct {
	mu          sync.RWMutex
	appID       string
	client      updater.Client
	downloadDir string
	canQuit     func() bool
	quit        func() error

	status      server.DesktopUpdateStatus
	check       updater.CheckResult
	download    updater.DownloadResult
	downloading bool
	cancel      context.CancelFunc
}

func New(config Config) (*Service, error) {
	appID := strings.TrimSpace(config.AppID)
	if appID == "" {
		return nil, errors.New("desktop updater app id is required")
	}
	currentVersion := strings.TrimSpace(config.CurrentVersion)
	if currentVersion == "" {
		currentVersion = "dev"
	}
	owner := strings.TrimSpace(config.Owner)
	repository := strings.TrimSpace(config.Repository)
	if owner == "" || repository == "" {
		return nil, errors.New("desktop updater GitHub repository is required")
	}

	suffix, err := platformAssetSuffix()
	if err != nil {
		return &Service{
			appID: appID,
			status: server.DesktopUpdateStatus{
				Available:        false,
				State:            "unsupported",
				Channel:          updateChannel(config.IncludePrerelease),
				CurrentVersion:   currentVersion,
				Message:          err.Error(),
				CanAutoInstall:   false,
				InstallationMode: "portable",
			},
		}, nil
	}

	installation, err := updater.CurrentInstallation(appID)
	if err != nil {
		return nil, fmt.Errorf("detect desktop installation: %w", err)
	}

	downloadDir := strings.TrimSpace(config.DownloadDir)
	if downloadDir == "" {
		cacheDir, cacheErr := os.UserCacheDir()
		if cacheErr != nil {
			return nil, fmt.Errorf("resolve update cache directory: %w", cacheErr)
		}
		downloadDir = filepath.Join(cacheDir, "know-me", "updates")
	}

	canAutoInstall := runtime.GOOS == "windows" && installation.Mode == updater.InstallationUser
	_, versionErr := updater.CompareVersions(currentVersion, currentVersion)
	available := versionErr == nil
	state := "idle"
	message := installationMessage(installation.Mode, canAutoInstall)
	if !available {
		state = "disabled"
		message = "当前构建未注入有效 SemVer 版本号，不执行在线更新检查"
	}

	service := &Service{
		appID:       appID,
		downloadDir: downloadDir,
		canQuit:     config.CanQuit,
		quit:        config.Quit,
		client: updater.Client{
			CurrentVersion: currentVersion,
			Provider: updater.GitHubProvider{
				Owner:             owner,
				Repository:        repository,
				IncludePrerelease: config.IncludePrerelease,
			},
			SelectAsset: updater.AssetBySuffix(suffix),
		},
		status: server.DesktopUpdateStatus{
			Available:        available,
			State:            state,
			Channel:          updateChannel(config.IncludePrerelease),
			CurrentVersion:   currentVersion,
			InstallationMode: string(installation.Mode),
			CanAutoInstall:   canAutoInstall,
			Message:          message,
		},
	}
	return service, nil
}

func updateChannel(includePrerelease bool) string {
	if includePrerelease {
		return "prerelease"
	}
	return "stable"
}

func platformAssetSuffix() (string, error) {
	switch runtime.GOOS {
	case "windows":
		return "-windows-" + runtime.GOARCH + "-setup.exe", nil
	case "linux":
		return "-linux-" + runtime.GOARCH + ".tar.gz", nil
	case "darwin":
		return "-macos-universal.app.zip", nil
	default:
		return "", fmt.Errorf("当前平台 %s/%s 暂不支持应用内更新", runtime.GOOS, runtime.GOARCH)
	}
}

func installationMessage(mode updater.InstallationMode, canAutoInstall bool) string {
	if canAutoInstall {
		return "已安装版本支持下载后自动安装并重启"
	}
	switch {
	case runtime.GOOS != "windows":
		return "当前平台支持检查和下载，自动安装暂未启用"
	case mode == updater.InstallationPortable:
		return "Portable 模式可检查和下载更新，下载完成后请手动运行 Setup"
	case mode == updater.InstallationMachine:
		return "machine-scope 安装暂不自动提权，下载完成后请手动安装"
	default:
		return "当前安装方式需要手动安装更新"
	}
}

func (s *Service) Status() server.DesktopUpdateStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

func (s *Service) Close() {
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (s *Service) Check(ctx context.Context) (server.DesktopUpdateStatus, error) {
	s.mu.Lock()
	if !s.status.Available {
		status := s.status
		s.mu.Unlock()
		return status, errors.New(status.Message)
	}
	if s.downloading || s.status.State == "checking" || s.status.State == "installing" {
		status := s.status
		s.mu.Unlock()
		return status, errors.New("another update operation is already in progress")
	}
	s.status.State = "checking"
	s.status.Error = ""
	s.status.Message = "正在检查 GitHub Release…"
	s.mu.Unlock()

	result, err := s.client.Check(ctx)
	if err != nil {
		s.mu.Lock()
		s.status.State = "error"
		s.status.Error = err.Error()
		s.status.Message = "检查更新失败"
		status := s.status
		s.mu.Unlock()
		return status, err
	}

	s.mu.Lock()
	s.check = result
	s.download = updater.DownloadResult{}
	s.status.LatestVersion = result.LatestVersion
	s.status.UpdateAvailable = result.UpdateAvailable
	s.status.ReleaseName = result.Release.Name
	s.status.ReleaseURL = result.Release.PageURL
	s.status.PublishedAt = ""
	if !result.Release.PublishedAt.IsZero() {
		s.status.PublishedAt = result.Release.PublishedAt.UTC().Format(time.RFC3339)
	}
	s.status.Prerelease = result.Release.Prerelease
	s.status.AssetName = result.Asset.Name
	s.status.AssetSize = result.Asset.Size
	s.status.Downloaded = 0
	s.status.Total = result.Asset.Size
	s.status.Verified = false
	s.status.SHA256 = ""
	s.status.DownloadPath = ""
	s.status.Error = ""
	if result.UpdateAvailable {
		s.status.State = "available"
		s.status.Message = "发现新版本 " + result.LatestVersion
	} else {
		s.status.State = "up-to-date"
		s.status.Message = "当前已是最新版本"
	}
	status := s.status
	s.mu.Unlock()
	return status, nil
}

func (s *Service) StartDownload() (server.DesktopUpdateStatus, error) {
	s.mu.Lock()
	if !s.status.Available {
		status := s.status
		s.mu.Unlock()
		return status, errors.New(status.Message)
	}
	if s.downloading || s.status.State == "checking" || s.status.State == "installing" {
		status := s.status
		s.mu.Unlock()
		return status, errors.New("another update operation is already in progress")
	}
	if !s.check.UpdateAvailable || strings.TrimSpace(s.check.Asset.Name) == "" {
		status := s.status
		s.mu.Unlock()
		return status, errors.New("check for an available update before downloading")
	}

	versionDir := filepath.Join(s.downloadDir, safeSegment(s.check.LatestVersion))
	if err := os.MkdirAll(versionDir, 0o755); err != nil {
		s.status.State = "error"
		s.status.Error = err.Error()
		status := s.status
		s.mu.Unlock()
		return status, fmt.Errorf("prepare update download directory: %w", err)
	}
	assetName := s.check.Asset.Name
	if filepath.Base(assetName) != assetName || assetName == "." || assetName == ".." {
		s.status.State = "error"
		s.status.Error = "unsafe update asset name"
		status := s.status
		s.mu.Unlock()
		return status, errors.New("unsafe update asset name")
	}
	finalPath := filepath.Join(versionDir, assetName)
	if err := os.Remove(finalPath); err != nil && !os.IsNotExist(err) {
		s.status.State = "error"
		s.status.Error = err.Error()
		status := s.status
		s.mu.Unlock()
		return status, fmt.Errorf("remove previous update download: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	s.downloading = true
	s.download = updater.DownloadResult{}
	s.status.State = "downloading"
	s.status.Downloaded = 0
	s.status.Total = s.check.Asset.Size
	s.status.Verified = false
	s.status.SHA256 = ""
	s.status.DownloadPath = ""
	s.status.Error = ""
	s.status.Message = "正在下载并校验更新…"
	check := s.check
	status := s.status
	s.mu.Unlock()

	go s.downloadUpdate(ctx, check, versionDir)
	return status, nil
}

func (s *Service) downloadUpdate(ctx context.Context, check updater.CheckResult, directory string) {
	result, err := s.client.Download(ctx, check, directory, func(progress updater.Progress) {
		s.mu.Lock()
		s.status.Downloaded = progress.Downloaded
		if progress.Total > 0 {
			s.status.Total = progress.Total
		}
		s.mu.Unlock()
	})

	s.mu.Lock()
	defer s.mu.Unlock()
	s.downloading = false
	s.cancel = nil
	if err != nil {
		s.status.State = "error"
		s.status.Error = err.Error()
		s.status.Message = "更新下载或 SHA256 校验失败"
		return
	}
	s.download = result
	s.status.State = "downloaded"
	s.status.Downloaded = result.Bytes
	if s.status.Total <= 0 {
		s.status.Total = result.Bytes
	}
	s.status.Verified = true
	s.status.SHA256 = result.SHA256
	s.status.DownloadPath = result.Path
	s.status.Error = ""
	s.status.Message = "下载完成，SHA256 校验通过"
}

func (s *Service) InstallAndRestart() (server.DesktopUpdateStatus, error) {
	s.mu.Lock()
	if s.status.State == "checking" || s.status.State == "installing" {
		status := s.status
		s.mu.Unlock()
		return status, errors.New("another update operation is already in progress")
	}
	if s.downloading {
		status := s.status
		s.mu.Unlock()
		return status, errors.New("wait for the update download to finish")
	}
	if !s.status.Verified || strings.TrimSpace(s.download.Path) == "" {
		status := s.status
		s.mu.Unlock()
		return status, errors.New("download and verify the update before installation")
	}
	if !s.status.CanAutoInstall {
		status := s.status
		s.mu.Unlock()
		switch updater.InstallationMode(status.InstallationMode) {
		case updater.InstallationPortable:
			return status, updater.ErrPortableInstall
		case updater.InstallationMachine:
			return status, updater.ErrMachineInstall
		default:
			return status, updater.ErrInstallUnsupported
		}
	}
	if s.quit == nil || (s.canQuit != nil && !s.canQuit()) {
		status := s.status
		s.mu.Unlock()
		return status, errors.New("desktop controller is not ready to restart")
	}
	download := s.download
	s.status.State = "installing"
	s.status.Error = ""
	s.status.Message = "安装程序即将启动，Know Me 会正常退出并在升级后重新启动"
	s.mu.Unlock()

	if _, err := updater.InstallAndRestart(s.appID, download); err != nil {
		s.mu.Lock()
		s.status.State = "error"
		s.status.Error = err.Error()
		s.status.Message = "启动更新安装程序失败"
		status := s.status
		s.mu.Unlock()
		return status, err
	}

	s.mu.Lock()
	status := s.status
	s.mu.Unlock()
	go func() {
		time.Sleep(250 * time.Millisecond)
		if err := s.quit(); err != nil {
			s.mu.Lock()
			s.status.State = "error"
			s.status.Error = err.Error()
			s.status.Message = "安装程序已启动，但应用自动退出失败；请手动退出 Know Me"
			s.mu.Unlock()
		}
	}()
	return status, nil
}

func safeSegment(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "unknown"
	}
	var builder strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			builder.WriteRune(r)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		case r == '.', r == '-', r == '_':
			builder.WriteRune(r)
		default:
			builder.WriteByte('_')
		}
	}
	result := strings.Trim(builder.String(), "._")
	if result == "" {
		return "unknown"
	}
	return result
}
