# CloudFile Chrome Extension → Generic Browser Extension：兼容规划 V1

状态：**协议兼容约束，不修改当前扩展的消息路由、Host 选择或文件授权**。目标合同：[ApplicationProfile V1](https://github.com/eaopen/local-bridge/blob/dev/docs/APPLICATION_PROFILE_V1.md)、[CloudFile nonbreaking migration](https://github.com/eaopen/local-bridge/blob/dev/docs/CLOUDFILE_TO_BRIDGE_MIGRATION.md)。

## 三方关系

企业应用自行提供通用 ApplicationProfile 与业务上下文；Generic Extension / Bridge 不包含具体企业应用代码或固定 API。CloudFile 与 Bridge 可以相互适配，但 CloudFile 的文件模式及服务端授权仍由 CloudFile 控制。**不能从 Profile 里的 native module 字段直接拼 Host、EXE 或本地命令**。

## 必须保持的当前功能

- 现有 `.cloudfile` 文件接收、`open_uri` / V2 `cloudfile-open://v2/open` 转发、`status`、`task_summary` / `focus_task`、本地文件/目录查询、更新提示和设备配对保留。
- V2 网页发放的短期受限票据包含文件范围/模式；Extension 不解码未验证 JWT，也不读取 Cookie、不保存票据/工作副本路径、不判断 CloudFile 是否具有写权限。
- 现有 Windows 正式 Host `com.cloudfile.current_agent`、macOS `com.cloudfile.agent2` 及 Dev `com.cloudfile.agent22.dev` 的真实使用遵循 Agent2 安装契约。不得因为本地安装 Bridge 或读取了 Profile 而静默重定向到另一个 Host。
- Chrome `externally_connectable` 允许页面调用**不表示**该来源已获信任；Origin、已注册的 Profile 和实际受控文件票据都需验证，且不能由页面声明自授能力。

## 演进分期

1. **现阶段不动路由**：CloudFile 网页、旧 Chrome Extension 和 Agent2 继续当前模式工作；Generic Profile 的离线解析仅存在 Bridge DEV。
2. **增量发现**：扩展在用户批准、验证应用来源之后才识别该站点 Profile；新能力不可用时仍使用旧文件路径，不将未知写入重试到另一 Host。
3. **明确 opt-in**：受信 DEV Profile 可以试验 Generic Extension ↔ Bridge 的 status/task/read-only 能力；开发/正式扩展独立身份、本地 Host 和工作区。
4. **真正切换**：三种文件模式 E2E、未知回执防重复、Guard、退出保护、升级回退通过后，才可在一个明确启用的入口切到新路由，并保留旧 Host 兼容期。

AI/Pi/MCP 由 Bridge 承担；Chrome 只负责网页与本机能力的受信桥接，不实现 AI Runtime、不打开 localhost 不受限服务，也不向 Pi 交企业 Cookie。

## 验收与禁止项

- 无 Bridge / Pi 时现有 CloudFile 扩展行为完全不变。
- 安装 Bridge Dev 不改变正式浏览器插件、原 Host 注册、EAP 等任意企业 Web 业务流程。
- Dev/Prod 两套扩展只能分别连接各自受信 Host，不互相探测、fallback 或共享票据。
- 新网页能力只有实际安装并已授权的模块可调用，失败展示明确。

**本轮只增加设计文档，不改 `background.js`、Manifest、popup 或用户现有安装。**
