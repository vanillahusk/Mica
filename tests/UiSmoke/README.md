# 阅读器回归检查

先构建离线组件与 Windows 应用：

```powershell
cd ReaderWeb
pnpm install --frozen-lockfile
pnpm test
pnpm build
cd ..
dotnet build -c Release
dotnet run --project tests/UiSmoke -c Release
```

桌面测试需要可用的 Windows 桌面和 WebView2 Runtime，会短暂创建测试窗口，结束后关闭；不修改真实文档和会话。它使用真实 MainWindow 与 WebReader，检查中文/空格路径的启动文件直接打开、文件关联命令的引号、四套主题的原生背景与偏好保存、问题目录、字号、定位、Mermaid 中文标签、原生全屏恢复、独立图表窗口、草稿、长文渲染与请求取消。文件关联仅检查注册计划，不写注册表或修改 Windows 默认应用。主题偏好隔离到测试输出目录，测试配置和截图也保存在其中。受限沙箱可能阻止 WebView2 渲染进程，不能把沙箱初始化失败误判为产品失败。

浏览器测试需要 Playwright（默认读取本项目可解析的 `playwright`，也支持环境变量 `MICA_PLAYWRIGHT_MODULE` 指向现有安装的 index.mjs）及 Microsoft Edge：

```powershell
cd ReaderWeb
node tests/browser.mjs
node tests/live-editor.mjs
node tests/isolated-diagrams.mjs
node tests/interaction-regressions.mjs
node tests/performance-baseline.mjs
```

浏览器测试涵盖流程图/时序图/类图、图表错误回退、缩放与全屏按钮、公式、HTML 清理、表格对齐、脚注、长文缓存、过时请求取消和离线加载。拖动检查使用真实 mouse down/move，断言松开鼠标前正文已滚动。截图与分段计时写入 `ReaderWeb/tests/output`。Playwright 的默认隐藏滚动条参数已移除，以验证真实滚动条。

主题回归验证四套代码配色、图表重着色、切换时 DOM 与阅读位置不变；滚动条检查包含 18px 宽度、56px 最小滑块，以及在旧滑块范围之外按住拖动。主题截图保存为 `theme-*.png`。

这些检查不替代多显示器 / DPI、辅助功能、复杂 Mermaid 和用户实际文档的体验验证；首屏计时不包括全部按需图表，也不等于程序冷启动时间。

0.6.0 笔记回归使用独立的 `MICA_NOTES_DIRECTORY`：选区笔记和标签保存、原文不变、文档隔离、切换后的草稿恢复、revision 冲突保护、标签筛选、Markdown 导出、删除 tombstone、编辑时笔记可用和最小窗口的控件可达性。浏览器同时检查文字移位重定位、缺失/歧义摘录、浮条按钮、点击高亮和不修改 Markdown DOM。`notes-shell.png` 只捕获 WPF 外壳，WebView 独立表面不在这张截图中。

0.7.0 实时编辑测试包括默认编辑不再进入源文 TextBox、WebView 编辑消息和快照、保存最后输入、切换文档后的草稿。浏览器新增格式按钮、撤销重做、Unicode 文本、CRLF 保留、代码/表格预览、长文虚拟化与过时编辑请求隔离；`live-editor.png` 展示实际编辑表面。

0.7.1 增加真实鼠标跨块拖选、四主题选区配色、选区变化不触发全文块扫描、输入不发送全文、合成 composition 保护。`isolated-diagrams.mjs` 检查离线 Worker 引擎的标签与主题、超时/取消/恢复、手动兼容回退；忙循环只由测试服务器提供，不进入正式构建。原生回归同时验证 WebView2 WASM 和独立窗口引擎继承。

0.7.2 的 `interaction-regressions.mjs` 从实际文字 Range 获取句号坐标，用鼠标拖选而不是用编辑器自身坐标自证：两个窗口宽度 × 三个字号。四主题引用选区检查原生选区、前景/背景对比度并截图。约 45 万字符文档分别在阅读/编辑模式按住滑块往返拖动，断言滑块与鼠标误差 <2px、文章进度误差 <0.8%；拖动中改变字号，继续检查文档高度变化时的位置。图表回归新增两种引擎的长英文 ER 实体名称不拆行。

0.8.0 将 Merman Worker + ELK + Neo 设为默认现代图表引擎，Mermaid 12 保留为显式兼容路径。Viewer 检查小图不放大、缩放滑杆、缩略导航、选择锁、复制 SVG、导出 SVG/PNG、全屏与独立窗口。`performance-baseline.mjs` 固定测量 10 万、50 万和 100 万字符的首屏、完整挂载与连续滚动帧间隔。
