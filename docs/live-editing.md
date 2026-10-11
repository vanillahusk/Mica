# 实时编辑与笔记打磨 · 0.7.0

## 参考与选择

2026-10-01 查阅 [Typora Markdown Reference](https://support.typora.io/Markdown-Reference/)、[Milkdown](https://milkdown.dev/docs/guide/why-milkdown)、[Tiptap Markdown](https://tiptap.dev/docs/editor/markdown) 及 [CodeMirror view](https://github.com/codemirror/view)、[Markdown language](https://github.com/codemirror/lang-markdown) 官方资料。CodeMirror 的 GitHub 仓库已迁移至维护者的 code.haverbeke.berlin，不能将旧 GitHub 仓库的 archived 状态理解成组件停止维护。

这次借鉴的是“直接编辑正文，语法按需出现”的交互，不复制 Typora 的实现、素材或品牌。使用 MIT 授权的 CodeMirror 6 文本模型与装饰层：既有扩展语法、脚注、HTML 不需要先转换为受限的富文本文档模型，未知语法也不会在一次编辑后被序列化掉。编辑模块懒加载，长文编辑由组件按可视区域挂载；渲染器仍是既有后台 Markdown 管线。

## 行为

- 标题、粗斜体、引用、列表和行内代码实时排版；当前行保留语法标记以便修改。
- 代码、表格、Mermaid、块公式在非活动状态显示预览；点击编辑进入原位源码，离开后恢复预览。代码高亮和绘图仍按需加载。
- 文本修改通过当前文档 revision 隔离。保存、离开编辑、切换文件和关闭窗口前获取编辑器快照，避免最后一次输入尚未传回桌面端就使用旧源码保存。
- 未编辑的文本原样返回；对统一 CRLF 的文件，编辑后保留 CRLF。混合换行文件修改后按首次检测到的换行方式统一，这是当前文本组件的限制。
- 通过源码行标记在阅读与编辑间尽量保留当前段落。巨型单段、HTML 和重排后的特殊块定位不承诺逐像素一致。
- 正文、笔记仍显式保存。笔记列表使用摘录卡片、内容摘要、时间与标签筛选，单条编辑是独立页面，不再与长列表上下挤占空间。

## 验证和边界

`ReaderWeb/tests/live-editor.mjs` 检查原文往返、标题/强调/代码/表格预览、中文文本插入、鼠标格式操作、撤销重做、CRLF、长文按视口挂载和过期初始化取消。自动化的中文插入不代替真实中文输入法组合态测试。

原生 UiSmoke 检查即时保存最后输入、跨文件草稿、笔记在实时编辑时可用，以及已有阅读/全屏/目录/同步会话渲染路径。另保留原来的浏览器回归测试。

仍不等同于 Typora 完整实现：表格编辑目前修改 Markdown 语法，非活动块预览；不支持任意 HTML 富文本编辑或全部扩展语法的实时外观。全部扩展语法仍保留在文本中，并可切回阅读模式查看。笔记目前是纯文本，不增加新的笔记富文本编辑器或云同步。
