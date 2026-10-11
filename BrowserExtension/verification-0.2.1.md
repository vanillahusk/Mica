# Mica Sync 0.2.1 验证

本次从本地 light-session-fork 迁入独立阅读页。未加载的历史消息使用完整原文快照和消息 ID 在扩展新标签页定位；已加载的消息保持网页原地跳转。

已运行：

- `node build-reader.mjs`：编译无运行时依赖的阅读页。
- `node test.mjs`：网页内容转 Markdown。
- `node test-background.mjs`：本地历史、同步、快照先存后开、特殊字符消息 ID、目标不存在、存储失败不打开空白页。
- `node test-popup.mjs`：历史会话入口与页面跳转。
- `node test-raw-sync.mjs`：Edge 无头浏览器中模拟分页接口，经过网页桥接、扩展后台、真实 Mica.exe、本地保存、桌面渲染链路；验证 Mermaid 10 个节点。未加载历史提问打开完整阅读页，目标位于顶部工具栏下方，目录高亮一致；搜索与返回项目会话原地址正常。接口 401 不会虚报同步成功。

测试使用受控会话数据，不是用户登录中的真实 ChatGPT 会话。真实浏览器升级扩展后需要刷新 ChatGPT 标签页。

独立阅读页支持 Markdown 阅读；Mermaid 在此页保留为代码，图形渲染仍由桌面端提供。没有增加 .NET 或桌面运行时依赖。
