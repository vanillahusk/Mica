# 渲染引擎实验室（不随 Mica 发布）

固定版本：Mermaid 12.0.0（父项目）、Merman Web Render 0.8.0-alpha.7、Sätteri 0.10.5。

## 复现

需要 Node.js、pnpm、Microsoft Edge 和 Playwright。先在 ReaderWeb 目录安装依赖并构建当前阅读器，再进入本目录：

```powershell
pnpm --ignore-workspace install --frozen-lockfile --ignore-scripts
node build.mjs
# 如已有独立 Playwright 安装，可设置 MICA_PLAYWRIGHT_MODULE 为其 index.mjs 的 file:/// 绝对地址。
node benchmark.mjs
node parser-benchmark.mjs
```

测试脚本从 `MICA_PLAYWRIGHT_MODULE` 或当前 Node 模块路径读取 Playwright。它仅启动本机临时 HTTP 服务器和独立测试浏览器，不读取用户文档。Windows 进程树内存统计需要 WMI 读取权限；不可用时返回 null，不把缺失的子进程当成低内存。渲染测试退出后关闭服务器和浏览器。

## 测试边界

- 四条图表路径：Mermaid 主线程、Merman 主线程、Merman Worker 默认 SVG 管线、Merman Worker 的 `resvg-safe` 管线。
- 默认管线通过与当前阅读器相同的 SVG 清理规则：禁止脚本与 foreignObject。这会暴露部分图表 HTML 标签与清理策略的兼容性问题；不能误称引擎完全不支持该图形。`resvg-safe` 在引擎侧生成 SVG 文字后再清理。
- 八种正常图表及一条故意无效的语法；检查标签，并保存截图做视觉核验。这不是完整 Mermaid 兼容性套件。
- 25 节点的中等流程图与 120 节点 / 240 边的循环压力图，各五次。每条路径都重新启动浏览器；冷调用只有一次，不能代表真实系统冷启动分布。
- 主线程 10 ms 心跳计时器用来观察事件循环阻塞。maxTimerGapMs 是每轮最大间隔，不是显示器帧率；随后对五轮最大间隔取中位数。
- 进程树 Working Set 是粗略内存指标，共享页面可能重复计入；只比较 `workingSetAfterMedium` 的相同成功工作量。复杂图表被拒绝后的内存不能与成功绘制后的内存直接比较。
- Worker 故障注入：用五秒忙循环模拟无法处理取消消息的引擎。父线程在 100 ms 后 terminate；随后验证重建 Worker 后可绘图，以及切换文档时取消。它验证硬终止机制，不声称发现真实引擎死循环。
- 151,500 字符的阅读器测试对比屏幕外跳过排版与整篇排版；图表延迟加载测试对比旧式自适应高度和固定预览高度。
- Sätteri 测试为 Node 原生绑定到 HTML，不是 WASM，也不含 .NET/WebView IPC。基础 markdown-it 与 Mica 完整解析分别计时；后者还输出目录、工具栏和自定义块，工作量不同。

## 输出

`output/results.json` 保存机器环境、每次图表和长文测量、资源上限错误、内存和取消测试。`output/parser-results.json` 保存解析结果及 HTML 差异。PNG 为对应图表的真实浏览器截图。

结论见仓库 `docs/renderer-experiment-results.md`。不要直接将本目录 dist 或 node_modules 打入正式应用。实验依赖的许可证随 `dist/merman` 保留。

## 原始资料

- https://github.com/Latias94/merman/blob/main/platforms/web/README.md
- https://github.com/inkdropapp/markdown-parser-benchmark
- https://github.com/bruits/satteri
- https://github.com/vercel/streamdown/blob/main/packages/streamdown/CHANGELOG.md
