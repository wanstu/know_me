package main

import (
	"context"
	"fmt"
	"os"

	"github.com/wanstu/wails-desktop-kit/servicecontrol"
)

const knowMeServiceUnit = "know-me-cli.service"

// serviceCommand controls the named service installed by the Know Me Linux
// CLI Debian package. It does not manage unrelated/manual know-me.service
// installations, and on Windows or macOS reports that systemd is unavailable.
func serviceCommand(args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: know-me service %s", servicecontrol.Actions)
	}
	return servicecontrol.Run(context.Background(), knowMeServiceUnit, args[0], os.Stdout, os.Stderr)
}
