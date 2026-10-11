# 0.8.1 图表渲染与分发

## 选择

- https://github.com/lukilabs/beautiful-mermaid ：MIT，采用其 1.1.3 流程图解析、ELK 布局和 SVG 绘制。节点尺寸、分支和标签由同一流水线计算，移除 Mica 对最终路径的 Catmull-Rom 改写。
- https://github.com/cgroadlabs/mermaid-plus ：参考复杂图的正交布线思路；未复制代码或引入整套查看器。
- https://github.com/SmolBlackHole/mermaid-elk-renderer ：参考保留 Mermaid 兼容路径的做法。

## 实现边界

流程图在原有可终止 Worker 中调用 beautiful-mermaid，其余图种保留 Merman。Merman 预先验证流程图语法；200 条以上连线提示拆分或显式兼容绘图。ELK 的 bundled 初始化需要 document sentinel 和可写 self，适配局限在绘图 Worker，主页面不变。

移除第三方输出中的 Google Fonts CSS import，采用本机 Segoe UI / 微软雅黑。使用实际主题颜色输出；依赖许可证收集进入 THIRD-PARTY-NOTICES.txt。复杂 Mermaid 的全部语法不保证由新引擎覆盖，兼容入口保留。

## 验证

以用户截图中的 eventId / 原子抢占 / PROCESSING / COMPLETED 分支重建样例，保存暖灰和纸白实际浏览器截图。运行现有图表、离线请求、缩放、取消、资源限制及长文滚动回归。

## 分发

0.8.1 只推荐 Windows x64 自包含包，用户不需要安装 .NET；保留系统 WebView2 依赖。此包并非包含固定版本 WebView2 的全离线运行环境。没有对 WPF 使用不受支持的 trimming，也没有为了体积去掉现有渲染能力。
