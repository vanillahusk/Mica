# Mica

轻量的 Windows Markdown、PDF、文本与 ChatGPT 会话阅读器。桌面端使用 Go + Wails，不依赖 .NET Desktop Runtime。

## 功能

- 沉浸式阅读和实时编辑 Markdown，支持目录、全局搜索、主题、字号与阅读位置恢复。
- 打开单个/多个文件、文件夹或直接拖放；支持 PDF 连续阅读及常见文本格式。
- Mermaid、公式、代码高亮、表格、图片缩放与 PDF 导出。
- 本地书架、分类、关系图谱、高亮、标签与可导出的阅读笔记。
- 通过 Mica Sync 保存 ChatGPT 会话；兼容常见 GPT 富文本，可切换富文本、简洁和原文阅读，原始同步数据只读且可恢复。

本地文档、会话和笔记不会上传到服务器。

## 下载

从 [GitHub Releases](https://github.com/vanillahusk/Mica/releases) 下载：

- `Mica-*-win-x64.zip`：免安装桌面端，解压后运行 `Mica.exe`。
- `Mica-Sync-*-chrome.zip`：可选的 ChatGPT 同步扩展，解压后在 Chrome/Edge 中“加载已解压的扩展”。

Windows 需要 WebView2；多数 Windows 10/11 设备已自带。

## 使用

点击“打开”选择文件或文件夹。需要关联 Markdown 时，使用 **更多 → 默认打开 Markdown**；需要同步 ChatGPT 时，使用 **更多 → 连接 ChatGPT** 并按提示填写扩展 ID。

数据保存在 `%LOCALAPPDATA%\Mica`。移动 `Mica.exe` 后，需要重新设置默认应用和扩展连接。

## 构建

开发环境需要 Windows、Go 和 Node.js 24。运行用户不需要这些工具。

```powershell
cd ReaderWeb
pnpm install --frozen-lockfile
cd ../BrowserExtension
pnpm install --frozen-lockfile
cd ../Native
node build.mjs
go test ./...
node native-build.mjs
```

生成文件为 `Native/Mica.exe`。桌面端源码在 [`Native`](Native)，渲染器在 [`ReaderWeb`](ReaderWeb)，浏览器扩展在 [`BrowserExtension`](BrowserExtension)。旧 WPF 0.8.1 仅保留在 `legacy/wpf-0.8.1` 分支。
