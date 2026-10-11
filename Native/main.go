package main

import (
	"context"
	"embed"
	"fmt"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wr "github.com/wailsapp/wails/v2/pkg/runtime"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

//go:embed all:dist
var assets embed.FS

func main() {
	for _, arg := range os.Args[1:] {
		if arg == "--native-messaging" || strings.HasPrefix(arg, "chrome-extension://") {
			runNativeHost()
			return
		}
	}
	app := newApp()
	app.grantArgs(os.Args[1:], "")
	frontend, _ := fs.Sub(assets, "dist")
	err := wails.Run(&options.App{
		Title: "Mica", Width: 1200, Height: 850, MinWidth: 760, MinHeight: 520,
		Frameless:        true,
		BackgroundColour: options.NewRGB(36, 35, 33),
		AssetServer:      &assetserver.Options{Assets: frontend, Handler: app},
		OnStartup: func(ctx context.Context) {
			app.ctx = ctx
			wr.OnFileDrop(ctx, func(_, _ int, paths []string) {
				docs, e := app.importPaths(paths)
				message := ""
				if e != nil {
					message = e.Error()
				}
				wr.EventsEmit(ctx, "files-dropped", docs, message)
			})
		},
		OnBeforeClose: app.beforeClose,
		Bind:          []interface{}{app},
		DragAndDrop:   &options.DragAndDrop{EnableFileDrop: true, DisableWebViewDrop: true},
		Windows:       &windows.Options{Theme: windows.Dark, WebviewUserDataPath: filepath.Join(dataDir(), "webview-native")},
		SingleInstanceLock: &options.SingleInstanceLock{UniqueId: instanceID(), OnSecondInstanceLaunch: func(d options.SecondInstanceData) {
			app.grantArgs(d.Args, d.WorkingDirectory)
			if app.ctx != nil {
				wr.WindowUnminimise(app.ctx)
				wr.WindowShow(app.ctx)
				wr.EventsEmit(app.ctx, "open-args", d.Args)
			}
		}},
	})
	if err != nil {
		panic(err)
	}
}
func instanceID() string {
	for _, arg := range os.Args[1:] {
		if arg == "--diagram" {
			return "mica-diagram-" + fmt.Sprint(os.Getpid())
		}
	}
	return "mica-native-reader-1"
}
