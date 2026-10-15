# CloudFile Local Console

[English](README.md) | [简体中文](README.zh-CN.md)

[Product home](https://github.com/eaopen/cloudfile) · [Local Agent](https://github.com/eaopen/cloudfile-local-agent)

A Manifest V3 browser extension that hands supported CloudFile sessions to a local Native Host and displays local task and update status. File authorization, desktop editing and server version publication are handled by their respective components.

## Installation And Compatibility

For development, open `chrome://extensions`, enable developer mode and load this directory. Add the extension ID to the Agent's allowed origins. Windows uses the single `com.cloudfile.current_agent` Host; macOS uses its supported Go Host. Configuration, message boundaries, version compatibility and upgrades are covered in the [technical reference (Chinese; English translation pending)](docs/technical-reference.md).

The package version is defined in [manifest.json](manifest.json). Developer-mode and mock test results do not establish store publication or full Windows/macOS acceptance. Task navigation requires a running, compatible local task center.

## Packaging And Tests

```bash
./scripts/package.sh
node --test tests/*.cjs
```

Store publication, Host routing, automatic updates and permissions are maintained in the technical reference.

## License

CloudFile-owned code uses [Apache 2.0](LICENSE); third-party dependencies retain their licenses, listed in [NOTICE](NOTICE). The product [roadmap](https://github.com/eaopen/cloudfile/blob/main/docs/en/roadmap.md) lives in CloudFile; this repository maintains the browser implementation and compatibility notes.
