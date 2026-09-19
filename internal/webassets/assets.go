package webassets

import (
	"embed"
	"io/fs"

	kitui "github.com/wanstu/wails-desktop-kit/ui"
)

//go:embed all:static
var embedded embed.FS

func FS() (fs.FS, error) {
	app, err := fs.Sub(embedded, "static")
	if err != nil {
		return nil, err
	}
	return kitui.Mount(app), nil
}
