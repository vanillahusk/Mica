# Mica Desktop 0.11.0

Mica 的 Go + Wails Windows 桌面端，不依赖 .NET Desktop Runtime。界面资源和离线渲染器嵌入 `Mica.exe`，运行时使用系统 WebView2。

ChatGPT 会话支持安全的富文本、简洁和原文三种阅读方式；同步原始 JSON 不会被显示转换覆盖。

数据保存在 `%LOCALAPPDATA%\Mica`。文件关联和 Mica Sync 连接均可在应用的 **更多** 菜单中设置。

## 构建

```powershell
node build.mjs
go mod download
go test ./...
node native-build.mjs
```

输出为 `Mica.exe`。可用 `MICA_GO` 指定 Go 可执行文件。第三方许可证见构建生成的 `build/THIRD-PARTY-NOTICES.txt`。
