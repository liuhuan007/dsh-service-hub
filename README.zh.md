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

### 扫描会先推断类型

点「重新扫描」时，每个候选都会带上一个建议类型：安装目录里的程序和快捷方式算 `应用`，
监听端口的算 `服务`，npm / 用户 bin 目录里的命令包装算 `终端`，其余批处理算 `脚本`；
发现列表每行都有下拉框可以在添加前改。`C:\Windows\...` 这类系统目录直接跳过。
## 安全

内置控制台只监听 `127.0.0.1`，并且防住了"网页顺手调用本地 API"这类攻击：

- **不再返回任何 CORS 头**：其它站点发起的浏览器请求在预检阶段就失败，读不到 `/api/state`，也调不了写操作
- **Origin / Sec-Fetch / Host 三重校验**：脚本发起的跨站请求一律 `403`；顶层与 iframe 导航放行，面板才能内嵌页面
- **id 白名单**：条目 id 仅允许 `[A-Za-z0-9._-]{1,64}`，所有日志路径都做 `path.resolve` 断言，`/api/items/<id>/logs` 无法穿越读其它文件
- **`/healthz`** 只暴露 `{ ok, version, pid }` 与 `X-LC-Daemon` 头；Host 侧据此确认连的是本插件的守护进程，而不是恰好占用 3999 的其它服务

守护进程只启停**你自己登记**的命令，不会擅自执行任何东西。执行 `npm test` 可跑这些保证的回归测试。

## 目录结构

控制台就是插件本身，不再有"另一个要安装/同步的项目"：

```
lib/            Host 插件（自动拉起控制台）+ 侧栏客户端
console/        控制台守护进程与单页 UI，随包发布
scripts/        开发辅助（start-console.cmd 可手动起控制台调试）
locale/、icon.svg、cordis.patch.yml
```

数据与日志都在 `~/.dsh-service-hub/`，所以侧栏面板、自动拉起、手动启动三者读同一份登记表。
## 开发

```bash
npm test              # 安全 + API 回归测试（node:test）
npm pack --dry-run    # 检查发布文件清单
```
## 许可证

MIT