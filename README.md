# CloudFile Local Console（Chrome 扩展）

这是一个 Manifest V3 扩展：仅监听下载完成的 `.cloudfile` 会话文件，并使用 Native Messaging 将文件路径交给本机 Agent。没有 Cookie、网页注入、localhost、网页数据采集或 Seafile Token 权限。

在 Chrome 打开 `chrome://extensions`，启用「开发者模式」，点击「加载已解压的扩展程序」，选择本目录。复制扩展 ID，并使用 Agent 的 `register-windows.ps1` 将该 ID 写入 Native Host 的 `allowed_origins`。
