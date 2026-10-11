package main

import (
	"bytes"
	"errors"
	wr "github.com/wailsapp/wails/v2/pkg/runtime"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (a *App) exportPDFBytes() ([]byte, error) {
	bridge, ok := a.ctx.Value("frontend").(interface{ MicaPrintPDF(func([]byte, error)) })
	if !ok {
		return nil, errors.New("此构建缺少原生 PDF 接口")
	}
	type result struct {
		b []byte
		e error
	}
	ch := make(chan result, 1)
	bridge.MicaPrintPDF(func(b []byte, e error) {
		select {
		case ch <- result{b, e}:
		default:
		}
	})
	select {
	case r := <-ch:
		if r.e != nil {
			return nil, r.e
		}
		if !bytes.HasPrefix(r.b, []byte("%PDF-")) || !bytes.Contains(r.b, []byte("%%EOF")) {
			return nil, errors.New("导出未生成有效 PDF，未写入文件")
		}
		return r.b, nil
	case <-time.After(60 * time.Second):
		return nil, errors.New("PDF 导出超时，未写入文件")
	}
}
func (a *App) ExportPDF(source, title string) (string, error) {
	dir := ""
	name := title
	if a.permitted(source) {
		dir = filepath.Dir(source)
		name = strings.TrimSuffix(filepath.Base(source), filepath.Ext(source))
	} else if !strings.HasPrefix(source, "conversation:") {
		return "", errors.New("文档未授权")
	}
	name = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`<>:"/\|?*`, r) || r < 32 {
			return '_'
		}
		return r
	}, name)
	if name == "" {
		name = "文档"
	}
	target, e := wr.SaveFileDialog(a.ctx, wr.SaveDialogOptions{Title: "导出 PDF", DefaultDirectory: dir, DefaultFilename: name + ".pdf", Filters: []wr.FileFilter{{DisplayName: "PDF", Pattern: "*.pdf"}}})
	if e != nil || target == "" {
		return "", e
	}
	if !strings.EqualFold(filepath.Ext(target), ".pdf") {
		target += ".pdf"
	}
	if strings.EqualFold(source, target) {
		return "", errors.New("不能覆盖正在阅读的原 PDF")
	}
	if _, e = os.Stat(target); e == nil {
		answer, _ := wr.MessageDialog(a.ctx, wr.MessageDialogOptions{Title: "覆盖已有 PDF？", Message: target, Buttons: []string{"取消", "覆盖"}, DefaultButton: "取消", CancelButton: "取消"})
		if answer != "覆盖" {
			return "", nil
		}
	}
	b, e := a.exportPDFBytes()
	if e != nil {
		return "", e
	}
	if e = atomicWrite(target, b); e != nil {
		return "", e
	}
	return target, nil
}
