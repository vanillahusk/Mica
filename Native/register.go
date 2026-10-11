package main

import (
	"golang.org/x/sys/windows/registry"
	"os"
)

// Register an Open With candidate. Windows UserChoice is deliberately untouched.
func (a *App) RegisterOpenWith() error {
	ex, e := os.Executable()
	if e != nil {
		return e
	}
	command := `"` + ex + `" "%1"`
	values := map[string]map[string]string{
		`Software\Classes\Mica.Native.Markdown`:                     {"": "Mica 文档"},
		`Software\Classes\Mica.Native.Markdown\shell\open\command`:  {"": command},
		`Software\Classes\Mica.Native.Markdown\DefaultIcon`:         {"": `"` + ex + `",0`},
		`Software\Classes\Applications\Mica.exe`:                    {"FriendlyAppName": "Mica"},
		`Software\Classes\Applications\Mica.exe\shell\open\command`: {"": command},
	}
	for path, v := range values {
		k, _, e := registry.CreateKey(registry.CURRENT_USER, path, registry.SET_VALUE)
		if e != nil {
			return e
		}
		for name, value := range v {
			e = k.SetStringValue(name, value)
			if e != nil {
				k.Close()
				return e
			}
		}
		k.Close()
	}
	for _, ext := range []string{".md", ".markdown", ".pdf", ".txt", ".log", ".json", ".csv", ".yaml", ".yml", ".xml", ".toml"} {
		k, _, e := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+ext+`\OpenWithProgids`, registry.SET_VALUE)
		if e != nil {
			return e
		}
		e = k.SetStringValue("Mica.Native.Markdown", "")
		k.Close()
		if e != nil {
			return e
		}
	}
	return nil
}
