package main

import (
	"errors"
	"testing"
)

func TestDesktopBridgeExternalURLRequiresBrowserAndSafeScheme(t *testing.T) {
	called := ""
	bridge := &DesktopBridge{url: "http://127.0.0.1:1234", openExternal: func(value string) error { called = value; return nil }}
	for _, value := range []string{"javascript:alert(1)", "file:///C:/Windows", "https://", "https://user:pass@example.com", "/relative", "about:blank"} {
		if err := bridge.OpenExternalURL(value); err == nil {
			t.Errorf("unsafe URL was accepted: %q", value)
		}
	}
	for _, value := range []string{"https://github.com/wanstu/know_me/releases", "http://example.org/path"} {
		if err := bridge.OpenExternalURL(value); err != nil {
			t.Fatal(err)
		}
		if called != value {
			t.Fatalf("opened %q instead of %q", called, value)
		}
	}
	if err := (&DesktopBridge{}).OpenExternalURL("https://example.org"); err == nil {
		t.Fatal("missing browser should fail")
	}
	sentinel := errors.New("browser unavailable")
	bridge.openExternal = func(string) error { return sentinel }
	if err := bridge.OpenExternalURL("https://example.org"); !errors.Is(err, sentinel) {
		t.Fatalf("browser failure was lost: %v", err)
	}
}
