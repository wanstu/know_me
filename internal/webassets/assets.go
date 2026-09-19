package webassets

import (
	"embed"
	"io/fs"

	theme "github.com/wanstu/wails-desktop-kit-theme"
)

//go:embed all:static
var embedded embed.FS

func FS() (fs.FS, error) {
	app, err := fs.Sub(embedded, "static")
	if err != nil {
		return nil, err
	}
	return theme.MountWithKit(app), nil
}
