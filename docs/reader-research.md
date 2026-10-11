# 阅读器优化记录 · 2026-09-30

后续实测与取舍见 [2026-10-01 引擎对照实验](renderer-experiment-results.md)。其中固定高度图表预览已进入 0.4.1，WASM/原生解析器仍仅在实验目录中。

目标是轻量、清晰的本地 Markdown 阅读器，而不是复刻 Obsidian 工作台。保留 WPF 原生外壳，把手写 FlowDocument 排版替换为离线 WebView2 阅读面板。没有引入 React 或 Electron；WebView2 会有独立浏览器进程，不能把安装包小等同于运行内存低。

## 本次查阅与取舍

- [Streamdown 官方更新记录](https://github.com/vercel/streamdown/blob/main/packages/streamdown/CHANGELOG.md)：视口驱动的 Mermaid 渲染，利用 IntersectionObserver、空闲时间调度减少多图表卡顿。借鉴其按需渲染和图表操作，不引入整套流式 React 界面。
- [Inkdrop Markdown parser benchmark](https://github.com/inkdropapp/markdown-parser-benchmark)：这是为 Inkdrop 做的实验，区分解析、结果遍历/对象化，以及 Electron renderer / IPC 成本。借鉴完整链路分段测量，不照搬其速度倍率，也不在尚无瓶颈证据时引入 Rust/WASM。
- [LatentMD](https://arxiv.org/abs/2609.06993)，2026 年 9 月的 Markdown 边界错误研究：关注模型输出中的 CommonMark 代码围栏失效，不是渲染加速论文。用成熟解析器替代正则拼装，并覆盖未闭合、嵌套围栏；本项目没有复现整篇论文的基准。
- [Mermaid 官方配置说明](https://mermaid.js.org/config/usage.html)、[WebView2 本地内容说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/working-with-local-content)：离线打包，固定阅读页面来源，文档 HTML 清理，关闭脚本与任意本地路径访问。

## 已实现

1. markdown-it 在独立 Worker 中解析；切换文档取消过时解析，最多保留四份有尺寸限制的解析结果。
2. 保持列表、表格、引用的完整块结构，分帧插入 HTML。首屏先显示，不等待全部图表完成。
3. `content-visibility: auto` 减少屏幕外排版；滚动不触发整篇重绘。高度估计可能随内容实际排版微调，尤其含大型图片、图表的长文。
4. Mermaid、KaTeX、代码高亮动态加载，进入视口附近才执行；图表串行渲染并缓存 SVG，防止并行 ID 冲突。
5. 浏览器原生实时滚动；原生目录通过消息桥定位标题/提问。图表可缩放、平移、全屏和新开原生窗口。
6. 图表文字检查（不仅检查存在 SVG），异常图表回退、HTML 注入、离线依赖、编辑草稿和快速切换回归。

## 本机实测快照

这些是开发机器上的单次合成测试，不是跨机器承诺或严格统计基准。

| 场景 | 结果 | 范围 |
| --- | --- | --- |
| Headless Edge，169,200 字符 / 1,800 标题 | 解析约 50 ms，首屏约 63 ms，正文插入约 196 ms | 引擎已初始化；不含所有懒加载图表 |
| 同文档缓存切回 | 首屏约 9 ms，正文插入约 128 ms | 复用解析结果，仍重新挂载 DOM |
| 真实 WPF / WebView2，118,380 字符 | 调用至正文完成约 155 ms，内部首屏约 35 ms | 不含文件 I/O；运行时已初始化 |
| WebView2 初始化 | 约 390 ms | 使用已创建的隔离测试配置目录；不是首次安装冷启动 |
| 全新 WebView2 用户配置目录 | 约 401 ms | 运行时已安装，系统缓存未清空；不是整机冷启动 |
| 按住滚动条拖动 | 松开前 scrollY 已变化 | 自动化真实鼠标拖动，不是只调用 scrollTo |

不把 headless 的 rAF 间隔当成真实显示器帧率。仍需在不同 DPI、多显示器和真实大型文档上持续体验验证；复杂 Mermaid 布局仍占用渲染线程。当前功能也不包括 PlantUML、任意 HTML 脚本、Obsidian 插件或完整 wiki 链接体系。
