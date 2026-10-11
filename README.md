# CloudFile Local Console（Chrome 扩展）

> 用途：说明 `.cloudfile` 会话接收扩展的安装、权限和安全边界
> 适用版本：Seafile CE 14 扩展版；Manifest V3，扩展版本以 `manifest.json` 为准
> 当前状态：验证中；开发者模式加载可用，Web Store 发布包可打包（见下），上传发布与跨平台全链路验收待完成

这是一个 Manifest V3 扩展：仅监听下载完成的 `.cloudfile` 会话文件（含 Hub 生成的 `blob:` 下载），并使用 Native Messaging 将文件路径交给本机 Agent。没有 Cookie、网页注入、localhost、网页数据采集或 Seafile Token 权限；Agent 会独立验证会话中的受信任服务端 origin 与一次性票据。

v0.3 正式库入口额外使用 `open_uri` 消息，通过独立的 `com.cloudfile.current_agent` Host 启动已配对的 .NET Windows Agent。该入口只接受 HTTPS 网页发来的有界 URI；Host 再核当前用户配对和规范 URI，GUI 仍要求用户确认。旧 `.cloudfile`/Go Host 保持独立；本地保存后的文件只由用户在 Web 手动上传，不由新 Host 监听或回传。

该扩展只负责会话文件交接，不实现文件预览、编辑或应用检测；这些职责属于本地 Agent
和用户安装的软件。整体能力状态见[扩展能力矩阵](../cloudfile-docker/docs/feature-matrix.md)。

在 Chrome 打开 `chrome://extensions`，启用「开发者模式」，点击「加载已解压的扩展程序」，选择本目录。复制扩展 ID，并使用 Agent 的 `register-windows.ps1` 将该 ID 写入 Native Host 的 `allowed_origins`。

弹窗中的「自动打开会话」默认开启，可随时关闭。关闭后会话文件仍下载，但扩展不会启动任何本地程序；重新开启后仅处理之后完成下载的会话文件。

Agent 状态正常时，弹窗会显示已自动检测到的 Office / 设计软件。软件选择由 Agent 在本机完成：用户规则优先，其次是已检测软件，最后才回退系统默认关联；扩展不读取或保存本机程序路径。

## Web Store 发布包

Chrome Web Store 接受未签名的 MV3 目录 zip，签名（打包成 `.crx`）由 Google 在发布时完成，
所以发布不需要购买代码签名证书，只需要一次性 $5 的开发者账号。打包：

```bash
./scripts/package.sh
```

产出 `dist/cloudfile-local-session-receiver-<version>.zip`，只含 manifest、四个资源文件与
`icons/` 图标（不含 README、脚本与 dotfile）。上传：Chrome Web Store Developer Dashboard →
New item → 上传 zip → 提交审核。发布后的扩展 ID 固定，用户侧的 Native Host
`allowed_origins` 改用该 ID（`chrome-extension://<id>/`），不再依赖开发者模式。

## 自动升级（1.0.0 起）

- **检测**：浏览器启动时 + 每 6 小时，向本地 Agent 发 `check_update`（带上本扩展版本），
  Agent 一次回答两侧的版本与 `min_version`。**不依赖跨源 `fetch`，因此不需要 nginx 配 CORS**；
  只有 Agent 不可用时才退回直连 `extension-update.json`。
- **提示**：有待升级项就亮工具条角标（显示待升级项数量）；某个新版本**首次**出现时弹一条系统通知，
  扩展与 Agent 合并成一条，同一版本不重复弹。点开 popup 即视为已读并清角标。
- **一键升级**：popup 的「立即升级 Agent」→ Agent 发 `update` 消息；「立即升级扩展」→
  Agent 发 `update_extension` 消息（下载 zip、校验 SHA256、解压替换 `%LocalAppData%\CloudFileLocal\extension`）。
  两者都由后台子进程完成，扩展随后轮询确认，扩展侧确认落盘版本追平后调用 `chrome.runtime.reload()` 生效。
- **失败可见**：请求返回只代表「已开始」。若 5 分钟内版本仍未追平，会弹「自动升级未完成」并让该版本重新可提醒。
  后台升级日志：`%LocalAppData%\CloudFileLocal\update.log`（detached 进程没有控制台）。
- **更新只是提示**：不设 `min_version` 之类的强制门禁，版本比较永远不会拦下本地功能；
  发布 JSON 里即使带着该字段也会被忽略。

## 自测

```bash
node --test tests/*.cjs
```

`tests/chrome-mock.cjs` 在 VM 里用假的 `chrome` 加载 `background.js`，可直接断言角标、
系统通知、native 调用与 storage 的变化。

## Agent2 优先路由与 Agent1 兼容（扩展 1.0.1，2026-10-11）

扩展保留 1.0.0 已上线方向的**一键升级、6 小时检查、角标/通知**，新增三 Host 能力发现：
- `com.cloudfile.agent2`：Go Agent2 2.0.1，macOS 原生 Go 主程序、Windows .NET Agent1 并行的 Go 能力组件。status 须明确 `agent_family=agent2`、2.x 版本及对应 `capabilities`，才会被用于相关操作。
- `com.cloudfile.current_agent`：Windows .NET Agent1 1.x。由于 Go2 尚未具备同等本地配对 `open_uri` 能力，Windows 的 `open_uri` 仍交此 Host。
- `com.cloudfile.local_agent`：旧 Go 1.x，保留原 `open_session`、缓存查询和打开工作区的兼容回退。

**选择优先级在实际动作发出前决定**；发送成功、错误或响应未知时，均不向另一个 Host 重发同一 session ticket。浏览器不代理未经设备签名和独占服务端授权的 `Commit`，并不把未接线的 Go2 独占上传列为可用。Agent2 的 2.x 升级发布与签名链未来单独实现，当前 1.x 静态更新机制不自动升级到 2.x。

`dev` 同时支持 Windows 与 macOS；Agent1 的 .NET 维护分支在 `eap-cloudfile:agent1`。Mac/Windows Agent2 两个平台各自的非管理员注册脚本在 `cloudfile-local-agent/scripts/`，不会修改现有 Agent1 的注册表或安装目录。新版回归：`node --test tests/*.cjs`，并使用 `./scripts/package.sh` 构建扩展压缩包。此处为构建/模拟回归，**不是已完成发布或 Windows 实机验收**。
