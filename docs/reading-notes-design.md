# 阅读、编辑与笔记 · 0.6.0

## 参考产品

查阅日期：2026-10-01。只参考交互原则，没有复制产品代码或素材。

- [Readwise Reader：Highlights, Tags, and Notes](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes)：摘录笔记、全文笔记、标签和返回原文。Mica 使用鼠标选区浮条，不引入新的键盘操作；也不强制自动高亮普通选区。
- [Obsidian：Views and editing mode](https://obsidian.md/help/edit-and-read)：清楚区分阅读和编辑。Mica 保留顶部直接切换，编辑以 Markdown 源文为准，不引入知识图谱和插件工作区。
- [Typora：Focus Mode and Typewriter Mode](https://support.typora.io/Focus-and-Typewriter-Mode/)：减少无关界面干扰。本版只借鉴阅读优先的取舍，不实现打字机模式。
- [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API)：通过 DOM Range 叠加高亮，不向原文插入 mark 标签，不破坏原有语法高亮和链接。

## 落地范围

阅读、源文编辑、可选分栏共用一份文档；笔记与目录共用右栏。笔记支持独立全文想法、摘录、标签、正文筛选、定位、删除和 Markdown 导出。同步会话保持只读，允许另存为可编辑副本。

高亮是即时写入操作；填写笔记和标签是显式保存操作。切换文档保留内存草稿，关闭时确认，避免用户误以为未保存的草稿已经落盘。不新增云服务和依赖包。

## 持久化与定位

按稳定文档标识（规范化的本地路径 / 会话 ID）分目录，单条笔记使用 GUID 文件名。临时文件原子替换，跨进程命名互斥锁及 revision 检查防止旧窗口覆盖新笔记；删除使用 tombstone 留存恢复内容。

摘录保存原始可读文字、前后各最多 64 个字符的上下文和初始偏移。重新渲染时：唯一文字匹配可重定位；出现多处相同文字时必须有唯一上下文匹配。缺失或歧义时保留笔记，不猜测位置。高亮列表在无笔记时不建立全文索引；选区操作和已有摘录才按需建立索引，延迟代码高亮造成节点变化后合并刷新。

## 验证与限制

浏览器测试验证选区浮条、点击高亮、Markdown DOM 不变、内容前插后的重定位、已删除/歧义摘录、过期消息隔离。原生测试验证笔记保存、不改原文、跨文档草稿、标签筛选、冲突、导出、阅读/编辑共用笔记栏及最小窗口布局。

暂不包括跨文件全局笔记库、自动迁移重命名文件、富文本编辑器、笔记自动保存、图表/公式内部选区和云同步。长文现有后台解析、缓存与分帧渲染继续保留。
