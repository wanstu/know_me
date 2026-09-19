package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"path/filepath"
	"testing"
	"time"

	runtimeconfig "github.com/wanstu/know_me/internal/runtimeconfig"
)

func TestNativeNavigationAPI(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	s, err := New(runtimeconfig.Config{
		Listen:     "127.0.0.1:0",
		DataDir:    filepath.Join(root, "data"),
		UploadsDir: filepath.Join(root, "uploads"),
	}, BuildInfo{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.auth.UpsertAdmin(context.Background(), "admin", "0123456789-password", "Admin"); err != nil {
		t.Fatal(err)
	}
	addr, err := s.Listen()
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Serve(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("server shutdown: %v", err)
			}
		case <-time.After(3 * time.Second):
			t.Error("server did not stop")
		}
	})

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	base := "http://" + addr
	login := bytes.NewBufferString(`{"username":"admin","password":"0123456789-password"}`)
	req, _ := http.NewRequest(http.MethodPost, base+"/api/auth/login", login)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", base)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login = %d", resp.StatusCode)
	}

	groupPayload := bytes.NewBufferString(`{"action":"create_group","data":{"name":"Public","icon":"home","visibility":"public"}}`)
	req, _ = http.NewRequest(http.MethodPost, base+"/api/navigation", groupPayload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", base)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create group = %d", resp.StatusCode)
	}
	var groupResponse struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&groupResponse); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if groupResponse.ID <= 0 {
		t.Fatalf("group id = %d", groupResponse.ID)
	}

	itemPayload := bytes.NewBufferString(
		`{"action":"create_item","data":{"groupId":` +
			jsonInt(groupResponse.ID) +
			`,"name":"Example","url":"https://example.com/","visibility":"public"}}`,
	)
	req, _ = http.NewRequest(http.MethodPost, base+"/api/navigation", itemPayload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", base)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create item = %d", resp.StatusCode)
	}

	resp, err = http.Get(base + "/api/navigation/public")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("public navigation = %d", resp.StatusCode)
	}
	var publicTree struct {
		Groups []struct {
			Name  string `json:"name"`
			Items []struct {
				Name string `json:"name"`
			} `json:"items"`
		} `json:"groups"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&publicTree); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(publicTree.Groups) != 1 || publicTree.Groups[0].Name != "Public" || len(publicTree.Groups[0].Items) != 1 {
		t.Fatalf("public tree = %#v", publicTree)
	}

	resp, err = client.Get(base + "/api/navigation/export")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("export = %d", resp.StatusCode)
	}
	if resp.Header.Get("Content-Disposition") == "" {
		t.Fatal("export missing filename")
	}
}

func jsonInt(value int64) string {
	body, _ := json.Marshal(value)
	return string(body)
}
