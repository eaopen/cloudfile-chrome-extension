# CloudFile Local Console（Chrome 扩展）

> 用途：说明 `.cloudfile` 会话接收扩展的安装、权限和安全边界
> 适用版本：Seafile CE 14 扩展版；Manifest V3，扩展版本以 `manifest.json` 为准
> 当前状态：验证中；开发者模式加载可用，签名发布和跨平台全链路验收待完成

这是一个 Manifest V3 扩展：仅监听下载完成的 `.cloudfile` 会话文件（含 Hub 生成的 `blob:` 下载），并使用 Native Messaging 将文件路径交给本机 Agent。没有 Cookie、网页注入、localhost、网页数据采集或 Seafile Token 权限；Agent 会独立验证会话中的受信任服务端 origin 与一次性票据。

该扩展只负责会话文件交接，不实现文件预览、编辑或应用检测；这些职责属于本地 Agent
和用户安装的软件。整体能力状态见[扩展能力矩阵](../cloudfile-docker/docs/feature-matrix.md)。

在 Chrome 打开 `chrome://extensions`，启用「开发者模式」，点击「加载已解压的扩展程序」，选择本目录。复制扩展 ID，并使用 Agent 的 `register-windows.ps1` 将该 ID 写入 Native Host 的 `allowed_origins`。

弹窗中的「自动打开会话」默认开启，可随时关闭。关闭后会话文件仍下载，但扩展不会启动任何本地程序；重新开启后仅处理之后完成下载的会话文件。

Agent 状态正常时，弹窗会显示已自动检测到的 Office / 设计软件。软件选择由 Agent 在本机完成：用户规则优先，其次是已检测软件，最后才回退系统默认关联；扩展不读取或保存本机程序路径。
