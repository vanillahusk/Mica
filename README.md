# Mica

一个轻量的 Windows Markdown 与 ChatGPT 对话阅读器，也是 LightSession 浏览器扩展的本地阅读端。

## 第一版能力

- Obsidian 风格的深色双栏界面，但不包含知识图谱、插件系统等重型功能。
- 打开、编辑和保存 `.md`、`.markdown`、`.txt` 文件。
- 打开本地文件夹，在侧边栏快速切换文档。
- 阅读、编辑、分栏预览三种模式，支持拖入本地文件。
- 从浏览器扩展一键同步 ChatGPT 会话；数据只保存到本机。
- 会话按消息 ID 增量合并，仅在点击“同步到 Mica”时落盘，避免后台频繁写入。

## 构建

需要 Windows 10/11 和 .NET 8 SDK：

```powershell
dotnet publish -c Release -r win-x64 --self-contained false -o publish
```

## 连接浏览器扩展

最简单的方法是在 Mica 首页点击 **连接 ChatGPT**：

1. 打开 `chrome://extensions` 并开启开发者模式。
2. 找到 LightSession，复制其扩展 ID。
3. 粘贴到 Mica 的连接窗口，点击 **完成连接**。
4. 重新加载扩展，进入任意 ChatGPT 对话。
5. 点击对话右侧目录中的 **同步到 Mica**。

开发阶段也可以用脚本注册。先执行发布命令，然后运行：

```powershell
.\scripts\install-native-host.ps1 -ExtensionId 你的扩展ID
```

同步文件位于 `%LOCALAPPDATA%\Mica\conversations`。卸载注册：

```powershell
.\scripts\uninstall-native-host.ps1
```

## 数据与安全

Native Messaging 主机只接受已注册扩展的消息，协议只包含会话标题、来源地址和消息内容；不会启动网络服务，也不会上传本地文档。会话文件采用临时文件替换写入，避免异常退出产生半写入文件。
