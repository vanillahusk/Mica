# Mica Sync 0.2.0 / Mica 0.9.14 验证

迁移来源：light-session-fork/extension/src/page/page-script.ts 中的
readerMessageText、readerRecords、loadReaderConversation；以及
reader-sidebar.ts 的消息候选识别。MIT 声明随扩展发布。

## 本次链路

ChatGPT 页面 MAIN world 捕获同源会话请求头 → 原始消息分页读取 →
字符串事件传递 Markdown → 扩展后台 Native Messaging → Mica 保存 → ReaderWeb 渲染。
请求头仅留在网页内存。完整会话使用真实消息 ID，不经过 DOM 反推和桌面正则修复。
完整快照覆盖前保存 .before-sync.bak；可见内容回退仍为增量合并。

## 已验证

- Go 测试：原文保留、旧消息替换、备份存在、空完整快照拒绝。
- 插件测试：新版 DOM 候选识别、历史保存、弹窗跳转。
- test-raw-sync.mjs：使用受控 ChatGPT HTTP 响应和 Edge，覆盖无消息 DOM、两页历史、422 降级、旧 mapping 当前分支、401 错误及重复游标。
- 上述浏览器脚本调用实际后台代码，经 Native Messaging 帧启动真实 Mica.exe（浏览器 origin 参数），保存到隔离目录。对保存的 Markdown 做严格相等断言。
- 同一份保存内容送入交付 ReaderWeb，成功渲染 10 节点 Mermaid，图后文字存在。
- 提问目录点击已加载消息定位；API 失败时不会发送部分会话或报告同步成功。

## 验证边界

HTTP 响应为测试夹具，不是用户当前登录会话；浏览器扩展 API 在联调中用适配器连接真实原生进程。
尚未在用户登录的 Chrome/Edge 中实际加载扩展点击同步。ChatGPT 私有接口变更仍可能需要适配。
网页尚未装载的历史消息无法直接 scrollIntoView，目录会提示先加载，完整正文可在 Mica 阅读。

升级时需要关闭旧 Mica 窗口，启动 0.9.14 并重新连接，使 Native Messaging 路径指向新版；
重新加载扩展并刷新 ChatGPT，使 document_start 页面桥接运行。固定扩展 ID 沿用 0.1.2。
