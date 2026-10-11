export const diagrams=[
  {name:'中文流程',source:'flowchart LR\n A[打开本地文档] --> B{是否包含图表}\n B -->|是| C[按需绘图]\n B -->|否| D[继续阅读]',labels:['打开本地文档','是否包含图表','按需绘图','继续阅读']},
  {name:'时序图',source:'sequenceDiagram\n participant A as 读者\n participant B as 阅读器\n A->>B: 打开文档\n B-->>A: 正文就绪',labels:['读者','阅读器','打开文档','正文就绪']},
  {name:'类图',source:'classDiagram\n Animal <|-- Duck\n Animal : +int age\n Duck : +swim()',labels:['Animal','Duck','age','swim']},
  {name:'关系图',source:'erDiagram\n USER ||--o{ NOTE : owns\n NOTE { string title }',labels:['USER','NOTE','title']},
  {name:'状态图',source:'stateDiagram-v2\n [*] --> Reading\n Reading --> Paused\n Paused --> Reading',labels:['Reading','Paused']},
  {name:'思维导图',source:'mindmap\n root((阅读器))\n  文档\n  图表\n  公式',labels:['阅读器','文档','图表','公式']},
  {name:'嵌套分组',source:'flowchart TB\n subgraph Local[本地内容]\n A[文档] --> B[解析]\n end\n subgraph View[阅读区域]\n C[正文] --> D[图表]\n end\n B --> C',labels:['本地内容','阅读区域','文档','图表']},
  {name:'长中文标签',source:'flowchart TD\n A[这是一段需要自动换行的中文说明文字用于验证文字布局不会被节点边界裁剪] --> B[完成]',labels:['中文说明','完成']},
  {name:'错误语法',source:'flowchart TD\n A[broken',invalid:true},
];
export const heavy='flowchart TB\n'+Array.from({length:120},(_,i)=>` N${i}[步骤 ${i}] --> N${(i+1)%120}\n N${i} --> N${(i+7)%120}`).join('\n');
export const medium='flowchart TB\n'+Array.from({length:24},(_,i)=>` N${i}[步骤 ${i}] --> N${i+1}`+(i<22?`\n N${i} --> N${i+3}`:'')).join('\n');
export const markdown=('# 长文阅读\n\n这里包含 **加粗文字**、[引用链接](https://example.com)、`code`。\n\n- 第一项\n- 第二项\n\n```java\nint value = 42;\n```\n\n').repeat(1500);
