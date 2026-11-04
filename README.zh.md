# dsh-service-hub（服务面板）

**DeepSeek Harness 的本地服务管理面板**：在侧栏里一键启动 / 停止 / 重启 / 查看日志，
并监控健康状态与端口，再也不用记每个启动脚本藏在哪。

## 0.3.0 起自带控制台

包里内置了**零依赖的控制台守护进程**（`console/`，只用 Node 标准库）。装好插件就够了：
插件激活时 Host 侧会在 `127.0.0.1:3999` 把它拉起来，插件卸载时结束它。
不需要外部工具、不需要改路径、不需要额外下载。

登记表与日志放在 `~/.dsh-service-hub/`，升级或重装插件不会丢你的服务列表。

## 装完有什么

侧栏多出 **服务** 标签页，列出所有登记条目及其状态、健康、端口和快速访问地址，
每个条目都有 **启动 / 停止 / 重启 / 日志 / 刷新**，并给出局域网地址（手机可打开）。
已启动的服务在关掉面板后继续运行，因为进程控制由守护进程负责。

## 安装

```bash
dsh plugin --profile desktop add dsh-service-hub
```

装完重启 DeepSeek Harness（或刷新窗口），在侧栏打开 **服务**。

源码安装（npm 包发布前可用）：

```bash
dsh plugin --profile desktop add github:liuhuan007/dsh-service-hub
```

## 依赖要求

| 要求 | 原因 |
|---|---|
| DeepSeek Harness 0.2.1+ 的 Web / 桌面版 | 客户端产物面向 `platform: web` |
| [`dsh-better-sidebar`](https://www.npmjs.com/package/dsh-better-sidebar) | 侧栏标签通过它的 service 注册 |
| Node 18+ | 运行内置控制台（桌面版自带） |
| Windows | 进程管理依赖 PowerShell 与 `tasklist`/`netstat` |

端口 `3999` 需空闲；若已有控制台占用，插件会复用它而不再起第二个。

## 权限与外部服务

- 客户端只对 `http://127.0.0.1:3999`（本机回环）发起 `fetch`。
- 内置守护进程只绑定 `127.0.0.1`，不监听外网。
- 无遥测、无外发网络请求。
- 守护进程只启停**你自己登记**的条目，不会擅自执行任何命令；每条命令都能在面板里看到，
  保存在 `~/.dsh-service-hub/data/registry.json`。

## 兼容性

- DSH：`>=0.2.1`
- 界面：Web / 桌面版（侧栏标签）；对 TUI、headless 无影响
- 系统：Windows

## 已知限制

- 面板从会话头部（⚙ 服务）打开；若另外安装了 `dsh-better-sidebar`，会额外在左侧栏加一个同样的标签（可选，非必需）。
- 面板文案目前只有中文；`locale/` 提供中英文 `meta.title` / `meta.description`。
- 控制台地址固定为 `127.0.0.1:3999`。

## 许可证

MIT