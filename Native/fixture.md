# 原生阅读测试

这份文件只用于原生外壳测试。

> 这是一段用于验证 PDF 导出的长引用。导出后的正文必须完整展开，不应出现阅读界面的滚动条，也不能把引用后半段截断。
> 重复内容用于让引用高度超过旧版的限制：架构说明、核心代码、设计原因、故障边界、验证结果和面试口径都应完整保留。
> 即使引用内容跨越多行或接近分页边界，PDF 也应按照纸张分页，而不是生成一个可滚动的小窗口。

```mermaid
sequenceDiagram
  participant Client
  participant Gateway
  participant Service as 主站
  Client->>Gateway: GET /notice/api/list + Token
  Gateway->>Service: 转发请求并携带身份 Header
  Service-->>Gateway: ResVo
  Gateway-->>Client: 响应 + X-Trace-Id
```

```mermaid
flowchart TD
 A[收到 eventId] --> B{原子抢占}
 B -->|不存在| C[写 PROCESSING 并执行业务]
 B -->|COMPLETED| D[直接跳过]
 B -->|PROCESSING| E[抛出可重试异常]
 C --> F{业务成功?}
 F -->|是| G[标记 COMPLETED]
 F -->|否| H[释放占用并抛异常]
```

## 阅读和编辑

支持 **Markdown**、`代码` 和笔记。
