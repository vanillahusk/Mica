# PDF 与书架实现记录

## 调研与选择

- WebView2 官方提供原生直接 PDF 输出和 CallDevToolsProtocolMethod；不必调用系统打印机，也无需启动独立 Edge。
  https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/print
  https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2
- MD Reader 等轻量阅读器采用系统 Edge headless 导出作为实现选择。本项目根据用户要求不采用这条路径。
  https://github.com/Neilooo/md-reader
- PDF.js 的 PDFViewer 包含连续页布局、可见页面优先渲染、缓存回收、文字层及查找，替代自行维护单页 canvas。
  https://github.com/mozilla/pdf.js/tree/master/examples/components
- Obsidian 的图谱基于链接，而不是自动推断语义。本项目区分链接边与分类边，不引入向量库、模型或网络服务。
  https://obsidian.md/help/plugins/graph

## 当前实现

Native/platform 是锁定 Wails 2.10.2 / go-webview2 1.0.19 的小范围 PDF 桥接。构建脚本复制依赖到构建目录后应用 Go overlay，原始模块缓存不变。通过 UI 线程调用已有 WebView2 COM 的 Page.printToPDF，接收 PDF 字节；没有启动 Edge、调试端口或打印对话框。

导出准备等待完整正文挂载、图表、公式、字体及图片；将文档复制到顶层独立打印树，避免 iframe 视口裁剪。默认保存到源目录同名 PDF，允许修改路径；覆盖确认后，校验首尾标记再原子写入。测试再次用 PDF.js 解析输出，核对多页、中文与最后一段。

连续阅读以页码和页内偏移恢复位置。元数据可建立完整连续滚动范围，位图仍按需渲染；不一次栅格化全部页面。

书架分类仅改变本机元数据，移除不会删除原文件。首版图谱解析已登记的 Markdown 内联链接和双链，跳过 fenced code；最多 200 篇，单篇超过 2 MB 不解析。图谱为有界原型，不是语义知识抽取。

## 回归入口

- `go test ./...`：文件授权、持久化、分类、移除保护、图谱链接。
- `node documents-ui-test.mjs`：连续滚动、恢复、文字层、分类管理、图谱导航、打印树。
- `node native-build.mjs --smoke`：真实 WebView2 原生多页导出、中文、末段校验。
- `node pdf-visual-test.mjs <native-export.pdf>`：用交付的连续阅读器展示原生输出首尾页。
