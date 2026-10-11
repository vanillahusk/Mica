# 0.8.0 阅读体验与 Mermaid 12

本版围绕阅读位置、查找定位、编辑衔接、宽内容和界面克制五项打磨。

- 阅读位置保存源码行和段内像素距离，像素总偏移只作兼容回退；切换文档/关闭时写一次，最多 200 篇。字号、宽度、侧栏变化使用同一锚点重新落位。
- 文内查找基于原始文本节点和 CSS Custom Highlight，不包裹、不重写 Markdown DOM；当前命中与其他命中分色。目录筛选只改变显示集合，不改变原目录和当前阅读章节。
- 目录/脚注等跳转将标题停在阅读栏下方并短暂强调。编辑表格时点击预览单元格，会切回对应 Markdown 单元格并选中文字，仍以原文为唯一数据源。
- 表格与图表共用查看器，补充适应宽度、实际大小；阅读页的块工具条默认弱化，悬停或聚焦时显现。
- Mermaid 标准模式使用 12.0.0 的 `look: neo`、`layout: elk`、默认平衡 preset 和 `lineHops: gap`，再用四主题覆盖高饱和渐变边框。隔离模式继续作为可终止的实验渲染路径。

调研依据：Mermaid 12 官方将 ELK 内置并作为 Flowchart、State、Class、ER、Requirement、Use Case、Agentflow 的默认布局；`look` 支持 classic/handDrawn/neo，默认 neo；ELK preset 的 default 使用 balanced Brandes–Köpf 放置与 depth-first cycle breaking，line hops 可用 gap/arc。由于 12.0.0 仍有公开的 ELK 标签位置和嵌套 subgraph 边界问题，Mica 保留手动缩放/适应宽度、源码查看和隔离/标准模式切换，不把一种布局宣称为所有图的最优解。

未引入云服务，查找、位置、图表和表格处理均在本机离线完成。远程仓库未修改。
