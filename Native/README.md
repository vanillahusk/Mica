# Mica Native 0.9.14 预览版

原生 Go + Wails 外壳，**不依赖、不携带 .NET**。Markdown 阅读器沿用 ReaderWeb，图表使用 Dagre + basis 原生曲线，不对 ELK 的折线路径二次拟合。

本次调整：配套 Mica Sync 0.2.0，迁入旧插件的原始会话读取和分页链路。原文消息保持 Markdown 不变；完整快照替换旧 DOM 提取消息，避免重复和错序。覆盖前一份会话保存在同目录的 .before-sync.bak。部分可见内容同步仍采用合并方式。

## 文档与导出

- 本地文件路径保存在 `native-library.json`；启动无文件参数时恢复上次打开的文档。文档正文不复制到书架。路径失效时保留条目并提示，文件重新移动后需重新打开。
- 阅读位置：Markdown 使用正文锚点；PDF 保存页码、缩放和页内位置；纯文本保存滚动位置。偏好写入合并，正常退出前刷新磁盘。
- PDF：离线 PDF.js 连续纵向滚动，按需渲染页面，支持页码跳转、缩放、适应宽度、可选文字及全文查找。无 OCR 或 PDF 编辑；扫描件按原样显示。
- 文本：TXT、LOG、JSON/JSONL、CSV/TSV、YAML、XML、INI/CFG、TOML、SQL 与常见代码格式；原样只读显示，支持 UTF-8、UTF-16 BOM、GB18030 解码。需要编辑可另存为 Markdown。文本限制 32 MB，PDF 限制 256 MB。
- **更多 → 导出 PDF…**：应用内 WebView2 直接生成 PDF，不打开浏览器或打印机界面，不启动独立 Edge。保存对话框默认原文档目录和同名 `.pdf`，可调整；覆盖现有文件需确认。等待整篇排版、图表与公式完成后导出，校验 PDF 首尾标记再原子写入。原 PDF 导出为同目录副本，保护源文件。
- 书架：分类筛选与“整理”入口分离；文件夹导入后按相对路径显示为可折叠文件树。文档和文件夹均支持右键管理，文件夹可批量分类或整体移出书架；这些操作不会删除电脑里的原文件。“整理”菜单内可新建、管理分类或打开文档图谱。
- 图谱：轻量力导向布局，文档 Markdown 链接及 `[[双链]]` 为实线，所属分类为虚线；支持搜索、拖动节点、平移、滚轮缩放和适应窗口。最多显示 200 篇文档，超过 2 MB 的 Markdown 不解析链接。

## 使用

解压后运行 `Mica.exe`，不需要安装 Go 或 .NET。Windows 系统需要 WebView2；缺少时 Wails 会提示安装。运行时不携带 Chromium。

- 支持单个或多个文件、文件夹、窗口拖放、命令行/双击文件、阅读和实时编辑、保存/另存为、层级目录、查找、四主题、字号、阅读位置、笔记、高亮和标签。
- 更多 → 注册文件打开方式，然后在 Windows 中选择默认打开应用。注册后请保持 Mica.exe 路径稳定；更新时关闭程序并覆盖同一位置的 exe。
- 更多 → 连接 ChatGPT，输入扩展 ID；在网页扩展中点击同步到 Mica。原生程序实现相同的 Native Messaging 协议，会话按 ID 合并，沿用 `%LOCALAPPDATA%/Mica/conversations`。连接操作会让浏览器后续调用此原生程序。
- 阅读笔记沿用旧版 notes 文件格式；新外壳的界面偏好和阅读位置单独存放在 `native-preferences.json`。文档保存前检查磁盘版本，避免覆盖其他程序的修改。

## 预览版边界

本版是可运行的原生迁移预览，不宣称旧 WPF 外壳功能完全等价。高级源码分栏、文件拖放、笔记删除/导出界面、自动发现扩展 ID 尚未迁移；同步协议和实际 Chrome 扩展端到端联调是不同层级的验证，目前测试覆盖协议收发与增量合并，真实扩展连接仍需实机验收。主阅读、实时编辑、目录、图表窗口和笔记已接入。

## 构建

需要 Go、Node.js，运行用户不需要这些工具。

```powershell
node build.mjs
go mod download
go run github.com/akavel/rsrc@v0.10.2 -ico ../Assets/mica.ico -manifest app.manifest -arch amd64 -o mica_windows_amd64.syso
go test ./...
node native-build.mjs
```

Windows 资源使用现有 Mica 图标。`native-build.mjs` 在 build/deps 创建 Wails/WebView2 依赖副本，通过 Go overlay 加入 platform 下两个 PDF 专用桥接，不修改模块缓存，不开放调试端口；调用已有 WebView2 的原生 `CallDevToolsProtocolMethod(Page.printToPDF)`。依赖版本由 go.mod 锁定，升级需重跑原生导出回归。可用 MICA_GO 指定 Go 路径。测试构建用 `node build.mjs --smoke` 和 `node native-build.mjs --smoke`，只修改隔离目录与测试文档。交付构建不包含 SmokeResult/SmokePDF 方法或自动化脚本。

## 开源组件

Wails v2.10.2（MIT）：https://github.com/wailsapp/wails

Merman：`@mermanjs/web-render`（以随包许可证文件为准）

Mermaid：https://github.com/mermaid-js/mermaid

前端依赖许可证位于构建资源的 `THIRD-PARTY-NOTICES.txt`。Go 依赖由 go.mod/go.sum 锁定。
