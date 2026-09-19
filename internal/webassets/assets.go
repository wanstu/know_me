package webassets

import (
	"embed"
	"io/fs"

	kitui "github.com/wanstu/wails-desktop-kit/ui"
)

//go:embed all:dist
var embedded embed.FS

func FS() (fs.FS, error) {
	app, err := fs.Sub(embedded, "dist")
	if err != nil {
		return nil, err
	}
	return kitui.Mount(app), nil
}
