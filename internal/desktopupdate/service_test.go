package desktopupdate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/wanstu/know_me/internal/server"
	"github.com/wanstu/wails-desktop-kit/updater"
)

type staticProvider struct {
	release updater.Release
}

func (p staticProvider) Latest(context.Context) (updater.Release, error) {
	return p.release, nil
}

type blockingProvider struct {
	started chan struct{}
	release chan struct{}
	result  updater.Release
}

func (p blockingProvider) Latest(ctx context.Context) (updater.Release, error) {
	select {
	case p.started <- struct{}{}:
	default:
	}
	select {
	case <-p.release:
		return p.result, nil
	case <-ctx.Done():
		return updater.Release{}, ctx.Err()
	}
}

func TestServiceCheckDownloadVerifyAndRejectPortableInstall(t *testing.T) {
	t.Parallel()

	payload := []byte("verified Know Me update payload")
	sum := sha256.Sum256(payload)
	expectedSHA := hex.EncodeToString(sum[:])
	downloadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "31")
		_, _ = w.Write(payload)
	}))
	defer downloadServer.Close()

	asset := updater.Asset{
		Name:   "know-me-desktop-v0.1.7-windows-amd64-setup.exe",
		URL:    downloadServer.URL,
		Size:   int64(len(payload)),
		SHA256: expectedSHA,
	}
	service := &Service{
		appID:       "know-me",
		downloadDir: t.TempDir(),
		client: updater.Client{
			CurrentVersion: "v0.1.6",
			Provider: staticProvider{release: updater.Release{
				Version: "v0.1.7",
				Name:    "Know Me v0.1.7",
				Assets:  []updater.Asset{asset},
			}},
			SelectAsset: updater.ExactAsset(asset.Name),
		},
		status: server.DesktopUpdateStatus{
			Available:        true,
			State:            "idle",
			CurrentVersion:   "v0.1.6",
			InstallationMode: string(updater.InstallationPortable),
		},
	}

	status, err := service.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !status.UpdateAvailable || status.LatestVersion != "v0.1.7" {
		t.Fatalf("unexpected check status: %+v", status)
	}

	status, err = service.StartDownload()
	if err != nil {
		t.Fatal(err)
	}
	if status.State != "downloading" {
		t.Fatalf("download start state = %q", status.State)
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		status = service.Status()
		if status.State == "downloaded" || status.State == "error" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for updater download")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if status.State != "downloaded" || !status.Verified {
		t.Fatalf("download status = %+v", status)
	}
	if status.SHA256 != expectedSHA {
		t.Fatalf("download SHA256 = %q want %q", status.SHA256, expectedSHA)
	}
	data, err := os.ReadFile(status.DownloadPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != string(payload) {
		t.Fatalf("downloaded payload = %q", string(data))
	}

	_, err = service.InstallAndRestart()
	if !errors.Is(err, updater.ErrPortableInstall) {
		t.Fatalf("portable install error = %v want %v", err, updater.ErrPortableInstall)
	}
}

func TestServiceRejectsConcurrentUpdateOperations(t *testing.T) {
	t.Parallel()

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	provider := blockingProvider{
		started: started,
		release: release,
		result: updater.Release{
			Version: "v0.1.7",
			Assets: []updater.Asset{{
				Name:   "update.exe",
				URL:    "https://example.invalid/update.exe",
				SHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			}},
		},
	}
	service := &Service{
		client: updater.Client{
			CurrentVersion: "v0.1.6",
			Provider:       provider,
			SelectAsset:    updater.ExactAsset("update.exe"),
		},
		status: server.DesktopUpdateStatus{
			Available: true,
			State:     "idle",
		},
	}

	done := make(chan error, 1)
	go func() {
		_, err := service.Check(context.Background())
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("first check did not start")
	}

	if _, err := service.Check(context.Background()); err == nil {
		t.Fatal("second check should be rejected while check is in progress")
	}
	if _, err := service.StartDownload(); err == nil {
		t.Fatal("download should be rejected while check is in progress")
	}
	if _, err := service.InstallAndRestart(); err == nil {
		t.Fatal("install should be rejected while check is in progress")
	}

	close(release)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("first check failed: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("first check did not finish")
	}
}
