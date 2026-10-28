# CloudFile Local Console

[English](README.md) | [简体中文](README.zh-CN.md)

[产品中心](https://github.com/eaopen/cloudfile) · [Local Agent](https://github.com/eaopen/cloudfile-local-agent)

Manifest V3 浏览器扩展（当前 1.0.4），将受支持的 CloudFile 会话交给本机 Native Host，并显示本地任务与更新状态。扩展不负责文件授权、桌面编辑或服务端版本发布。

V2 本地查看、本地编辑和独占编辑共用受信 `cloudfile-open://v2/open` 会话信封，
由 CloudFile Server 签名票据区分只读和写入权限。插件不读取票据内容、
不缓存票据，并且仅在 Rust Agent2 确认成功后记录站点 Origin。

## 安装与兼容

开发模式：打开 `chrome://extensions`，启用开发者模式并加载本目录；将扩展 ID 配入对应 Agent 的允许来源。Windows 使用单一 `com.cloudfile.current_agent` Host；macOS 使用其受支持的 Go Host。具体配置、消息边界、版本兼容与升级说明见 [技术参考](docs/technical-reference.md)。

当前包版本以 [manifest.json](manifest.json) 为准。开发者模式与模拟测试通过不代表商店发布或 Windows/macOS 全链已验收；任务定位依赖真正在线且兼容的本机任务中心。

## 打包与测试

```bash
./scripts/package.sh
node --test tests/*.cjs
```

`help/help.html`（连同 `help/img/`）是发布到更新通道的静态安装引导页 `<服务>/cloudfile-updates/help.html`，**不在扩展包内**（由发版脚本同步）；`tests/help-page.cjs` 守着它：脚本碰到的每个元素都必须在页面里存在，`install.cmd` 的下载链接必须带显式文件名。

商店发布、Host 路由、自动更新及权限说明均维护在技术参考，不在这里重复正文。

## 许可

自有代码采用 [Apache 2.0](LICENSE)，第三方依赖保留自身许可，见 [NOTICE](NOTICE)。产品路线在 [CloudFile](https://github.com/eaopen/cloudfile/blob/main/docs/zh-CN/roadmap.md) 维护，本仓维护浏览器实现与技术兼容说明。
