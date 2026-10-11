//go:build smoke

package main

import (
	wr "github.com/wailsapp/wails/v2/pkg/runtime"
	"os"
	"path/filepath"
)

// Only compiled into the isolated test executable.
func (a *App) SmokePDF() (string, error) {
	b, e := a.exportPDFBytes()
	if e != nil {
		return "", e
	}
	p := filepath.Join(dataDir(), "native-export.pdf")
	if e = atomicWrite(p, b); e != nil {
		return "", e
	}
	return a.grant(p)
}
func (a *App) SmokeResult(result string) error {
	e := os.WriteFile(filepath.Join(dataDir(), "smoke-result.json"), []byte(result), 0600)
	wr.Quit(a.ctx)
	return e
}
