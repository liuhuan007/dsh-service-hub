# dsh-service-hub（服务面板）

**DeepSeek Harness 的本地服务管理面板**：在侧栏里一键启动 / 停止 / 重启 / 查看日志，
并监控健康状态与端口，再也不用记每个启动脚本藏在哪。

## 装完有什么

侧栏多出 **服务** 标签页，列出所有登记条目及其状态、健康、端口和快速访问地址，
每个条目都有 **启动 / 停止 / 重启 / 日志 / 刷新**，并给出局域网地址（手机可打开）。
面板内嵌本地控制台（`http://127.0.0.1:3999`）；进程管理由那个守护进程负责并持久化
登记表，所以关掉面板不影响已启动的服务。

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
| `http://127.0.0.1:3999` 上运行的本地控制台守护进程 | 本插件只负责界面；登记表与进程控制都在守护进程里 |

没有守护进程时，标签页照常打开，并明确提示"控制台未运行"和启动路径。

## 权限与外部服务

- 客户端只对 `http://127.0.0.1:3999`（本机回环）发起 `fetch`。
- 无遥测、无外发网络请求，插件本身不读写文件系统。
- Host 侧（`lib/index.js`）不注册任何资源、不改变 Harness 行为。

## 兼容性

- DSH：`>=0.2.1`
- 界面：Web / 桌面版（侧栏标签）；对 TUI、headless 无影响
- 系统：Windows（控制台守护进程基于 PowerShell）

## 已知限制

- 强依赖 `dsh-better-sidebar`，未安装则不会出现侧栏标签。
- 面板文案目前只有中文；`locale/` 里提供了中英文的 `meta.title` / `meta.description` 供插件清单展示。
- 内嵌控制台地址固定为 `127.0.0.1:3999`。

## 许可证

MIT