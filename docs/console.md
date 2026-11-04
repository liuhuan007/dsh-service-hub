# 本地控制台 (local-console)

把散落在本机各处的 **进程 / 命令 / 脚本 / GUI 应用** 登记成一份清单，用一个网页界面点一下就启动；
控制台关掉、电脑重启之后，清单还在，不用再满硬盘找"当初那条命令是什么"。

## 快速开始

双击 **`start.cmd`**，浏览器打开 **http://127.0.0.1:3999**

命令行方式：`node server.mjs`（Node 18+，无任何第三方依赖）。

## 三种条目类型

| 类型 | 用途 | 卡片按钮 |
|---|---|---|
| `service` | 常驻后台服务（repowise / agentsview / multica daemon） | 启动 · 停止 · 重启 · 日志 · 打开地址 |
| `app` | GUI 桌面程序（Multica 桌面版） | 启动 · 日志 · 打开目录 |
| `script` | **一次性任务**（清理脚本、批处理） | **运行** · 终止 · 历史 · 日志 |

### 脚本类怎么工作

- 点「运行」→ 跑一次 → 退出码进历史，卡片显示`上次：成功 · 耗时 1.7s · 23:23`或`上次：失败(exit 3) · …`
- 点「历史」→ 列出最近 **30 次**运行（时间 / 成功失败 / 耗时），点任意一条「查看输出」看**那一次**的完整输出（每次运行的输出单独存文件，不互相覆盖）
- 「全部启动」**会跳过脚本**，避免误批量执行一次性任务
- 运行中的脚本可以「终止」

### ⚠️ 写 `.ps1` 脚本的两个坑（PowerShell 自身行为，不是本工具的）

1. **脚本文件要存成「UTF-8 带 BOM」** —— Windows PowerShell 5.1 读无 BOM 的 UTF-8 会把中文读成乱码，导致语法错误。
   本工具发出的输出编码已经强制成 UTF-8，所以只要文件存对，中文输出就是正常的。
2. 别在脚本里等 stdin，会卡住。

`.cmd` / `.bat` 也一样能跑（内部统一用 PowerShell 当启动器，中文输出正常）。

## 加新条目

- **界面**：右上角 `+ 添加`
- **手动**：编辑 `data/registry.json`，刷新页面
- **自动**：点 `重新扫描`，扫 PATH 常见目录 + 正在监听端口的进程，列出候选供勾选

### 字段

```jsonc
{
  "id": "唯一英文 id",
  "name": "显示名",
  "kind": "service",              // service | app | script
  "group": "分组名",
  "exe": "绝对路径（.exe / .ps1 / .cmd / .bat）",
  "args": ["参数"],
  "cwd": "工作目录",               // 很重要：很多工具靠 cwd 区分项目
  "env": { "KEY": "VALUE" },
  "url": null,                     // 固定访问地址（可选）
  "port": null,                    // 固定端口（可选）
  "shell": "pwsh",                 // 可选：强制解释器 pwsh|cmd
  "healthCmd": ["serve","status"], // 可选：健康检查子命令，退出码 0 = 健康
  "stopArgs": ["daemon","stop"],   // 可选：优雅停止子命令，没有就杀进程树
  "note": "备注"
}
```

## 文件

    F:\agent\local-console\
      server.mjs            守护进程（HTTP API + 静态页）
      public\index.html     界面（单文件，离线）
      examples\清理扫描演示.ps1   只读的清理扫描示例（不删任何东西）
      data\registry.json    ← 唯一真源：条目都在这里
      data\history.json     脚本运行历史（每个 id 最多 30 条）
      data\runtime.json     上次启动的进程记录（重启后接管用）
      logs\<id>.log         服务的输出
      logs\<id>\<runId>.log 脚本每次运行的输出

## 行为

- **不自动启动任何服务**：只有点「启动」才起。控制台本身也不自启。
  想让控制台随登录自启（服务仍按需）：`schtasks /Create /TN "本地控制台" /TR "\"<node.exe路径>\" \"F:\agent\local-console\server.mjs\"" /SC ONLOGON /F`
- **关掉控制台不会停掉已启动的服务**。
- **重启后能接管**：读 `data\runtime.json` + pid 校验，只认还活着的，不误报绿灯。
- **端口自动识别**：抓子进程 stdout 里的 `http://127.0.0.1:PORT`，识别到就点亮「打开地址」。
- **主动停止显示「已停止」**，不显示「错误」。

## HTTP API

    GET    /api/state                        全部条目 + 实时状态（含 lastRun）
    POST   /api/items                        新增/更新条目
    DELETE /api/items/{id}                   删除（先停进程）
    POST   /api/items/{id}/start|stop|restart|check
    GET    /api/items/{id}/logs?lines=300    日志（脚本=最近一次）
    GET    /api/items/{id}/runs              脚本运行历史
    GET    /api/items/{id}/runs/{runId}/log  某一次的完整输出
    POST   /api/discover                     自动发现候选

## 已知限制

- 端口识别依赖工具把地址打印到 stdout；不打印的用 `port` 字段手填。
- 健康检查只对配了 `healthCmd` 的条目生效，15 秒缓存。
- 自动发现扫：PATH 常见目录、npm 全局 bin、`.agentsview\bin`、`.workbuddy\binaries\*`、监听端口的进程。不做全盘搜索。
- GUI 应用只能启动，无法可靠判定运行状态（可能有实例已在跑）。
- `C:\`/`D:\` 根目录遍历会因 `swapfile.sys`/`pagefile.sys` 报 `EINVAL` 中断，扫描器逐条容错跳过。

## 停止 / 退出

- **全部停止**：一次停掉所有运行中的服务与应用（脚本不在内），弹确认框先列出目标。
- **退出控制台**：只关控制台守护进程，**已启动的服务继续运行**。下次双击 `start.cmd` 再打开。
- 单个条目仍可「停止」（走 `stopArgs` 优雅停止，没有配置才强杀进程树）。

## 版本与升级

每条可配：

```jsonc
"versionCmd": ["--version"],                              // 读当前版本，卡片显示 v0.47.0
"upgradeExe": "C:\\...\\python.exe",                       // 可选：换一个程序执行升级
"upgradeArgs": ["-m","pip","install","-U","repowise"]      // 升级命令
```

- 卡片出现版本号；没探测到的显示「查版本」（`GET /api/items/{id}/version`，60 秒缓存）。
- 配了 `upgradeArgs` 才会出现「升级」按钮：先弹确认，再执行；**升级前会自动停掉该服务**，输出记入历史（带「升级」标记，可回看）。
- 已预置：repowise → `pip install -U repowise`；agentsview → `agentsview update`；multica → `multica update`。

### 新增接口

    POST /api/stop-all                       停止所有运行中的服务
    POST /api/shutdown                       退出控制台（不影响已启动服务）
    GET  /api/items/{id}/version             探测版本
    POST /api/items/{id}/upgrade             执行升级（记为一次 kind=upgrade 的运行）

## 高级字段：分离式服务（start 命令会 detach）

`multica daemon start` 这类命令会**启动后台进程后立即退出**，用"子进程是否存活"判状态会永远显示已停止。为此提供：

```jsonc
"detached": true,                    // 状态改由健康检查判定
"healthCmd": ["daemon","status"],
"healthExpect": "running (pid",       // 输出里必须出现的字样（区分退出码恒为 0 的命令）
"stopArgs": ["daemon","stop"]
```

- 配了 `detached` 的条目，状态 = 健康检查结果，所以**外部启动的进程也能被识别**。
- 启动崩溃时（退出码非 0 且健康检查不通过）显示「错误」，不会假装已停止。
- 启动后会分别在 2.5 / 8 / 20 秒复探一次，兼容启动慢的服务。

同理，`healthExpect` 也用于普通服务：`agentsview serve status` 无论起没起都返回 0，必须靠输出内容判断。

## 本机地址（LAN IP）

界面头部显示 **本机IP 10.x.x.x**（点击复制控制台地址）。每个服务除了 `127.0.0.1` 还会给出 **LAN 地址**
（卡片上的第二个绿色 chip + 复制LAN；快速入口里带 `LAN` 标记的条目），因为有些服务只绑了网卡地址、用 127 打不开。

排序规则：`192.168.*` → `10.*` → 其他 → Hyper-V/Docker(`172.16-31`) → Tailscale(`100.64/10`)；
第一个作为主 LAN 地址，`+N` 表示还有 N 个（悬停可看全部）。

## 探活方式（三选一，按需配）

```jsonc
"healthUrl":  "http://127.0.0.1:3082/",   // HTTP 探活：任何 <500 的响应都算活着（401 也算在跑）
"healthPort": 7123,                        // TCP 端口探活：连上就算活着（适合 GUI 程序的内部端口）
"healthProc": "chfsgui.exe",               // 按进程名判活（适合没有端口/不返回 HTTP 的 GUI 程序）
```

配了任意一种，**外部启动的进程也能被识别**（不必由控制台启动）。目前用法：

| 条目 | 探活 |
|---|---|
| dsh-superagent | `healthUrl` :3082 |
| oss-browser | `healthPort` 7123 |
| cc-switch | `healthPort` 15721 |
| chfsgui | `healthProc` chfsgui.exe |

## 终端工具（kind: terminal）

交互式 CLI（claude / codex / codebuddy / gemini / qwen …）没有"常驻状态"，也不监听端口，
用启动/停止模型管不了。它们用 **terminal** 类型：

> 点「打开终端」= 在 **cwd 指定的目录** 打开一个新的控制台窗口并运行该命令。

```jsonc
{
  "id": "term-claude", "name": "Claude Code", "kind": "terminal",
  "group": "终端工具",
  "exe": "claude",           // 可以是 PATH 上的命令名，也可以是绝对路径
  "args": [],
  "cwd": "F:\\agent",         // 关键：在哪个项目目录里打开
  "note": "npm 全局 · 使用 75 次"
}
```

- 卡片显示 **命令 + 目录**，状态固定显示「终端」，没有停止/重启（窗口关闭即可）。
- 「全部启动」会跳过终端类型，不会批量弹一堆窗口。
- 已预置 10 个：Claude Code、OpenClaw、Code Review Graph、Codex CLI、CodeBuddy、
  MiMo、TCB CLI、Lark CLI、OCR、Gemini CLI（按 PowerShell 历史使用频次排序挑选）。

## 启动方式的三条路径（重要）

不同程序必须用不同的启动方式，否则会"起了但没窗口"：

| 类型 | 启动方式 | 原因 |
|---|---|---|
| `service` | 直接 spawn（脱离父进程，日志写文件句柄） | 后台服务不需要窗口 |
| `app` | **经 `explorer.exe` 转发** | 守护进程不在交互式桌面会话里，直接 spawn GUI 出不来窗口 |
| `terminal` | `cmd /c start "" cmd /k <命令>` | 需要新的控制台窗口 |
| `script` | 管道捕获输出 | 一次性任务，要拿输出 |

## 已知环境冲突：repowise 与 mcp 2.x

本机共享 Python 环境里的 `mcp` 被升到了 2.x，而 repowise 0.47.0 要求 `mcp<2`
（`from mcp.server.fastmcp import FastMCP` 在 2.x 里已被改成抛错的墓碑模块）。
同时 `fastmcp 4.x` 又要求 `mcp>=2`，两者在同一个环境里**不可调和**：

    $ pip check
    repowise 0.47.0           requires mcp<2,>=1.0     but you have mcp 2.2.0
    agentscope 2.0.4.post1    requires mcp<2.0.0       but you have mcp 2.2.0
    code-review-graph 2.3.2   requires mcp<2,>=1.0.0   but you have mcp 2.2.0
    fastmcp 4.0.10            requires mcp>=2.0.0      (冲突方)

**本机的解法（隔离，不动共享环境）**：建一个 `--system-site-packages` 的薄 venv，
只往里装 `mcp==1.30.0`，然后用该 venv 的 python 跑共享环境里的 repowise：

    # 一次性准备（已完成）
    python -m venv --system-site-packages C:\Users\Administrator\.repowise-venv2
    C:\...\.repowise-venv2\Scripts\python.exe -m pip install "mcp==1.30.0" -i https://pypi.tuna.tsinghua.edu.cn/simple

注册表条目因此指向 venv 的 python：

```jsonc
"exe": "C:\\Users\\Administrator\\.repowise-venv2\\Scripts\\python.exe",
"args": ["-c", "import sys; from repowise.cli.main import cli; sys.exit(cli())", "serve"],
"upgradeExe": "C:\\Users\\Administrator\\.repowise-venv2\\Scripts\\python.exe",
"upgradeArgs": ["-m","pip","install","-U","repowise","-i","https://pypi.tuna.tsinghua.edu.cn/simple"]
```

> **网络提示**：这台机器访问 pypi.org 原件会卡（元数据能通、包体下不动），
> 必须加 `-i https://pypi.tuna.tsinghua.edu.cn/simple` 才能下载。所有 pip 相关操作都要带这个参数。

### repowise 升级注意：Web UI 缓存必须同步

repowise 的 Web UI 是**按版本从 GitHub 下载**并缓存在 `~/.repowise/web`（含 `.version` 标记）。
升级 CLI 后，缓存版本对不上，它就会去 GitHub 重新下载——**本机直连 GitHub 会超时**，于是卡在
`Downloading web UI (...)` 永不启动。

正确升级姿势：

```powershell
# 1) 升级 CLI（走清华源）
C:\Users\Administrator\.repowise-venv2\Scripts\python.exe -m pip install -U `
  -i https://pypi.tuna.tsinghua.edu.cn/simple repowise

# 2) 用 GitHub 加速镜像下对应版本的 UI（把 <VER> 换成新版本号）
$u = "https://github.com/repowise-dev/repowise/releases/download/v<VER>/repowise-web.tar.gz"
Invoke-WebRequest "https://ghfast.top/$u" -OutFile "$env:TEMP/web.tgz"

# 3) 替换缓存
Rename-Item "$env:USERPROFILE\.repowise\web" "$env:USERPROFILE\.repowise\web.old" -ErrorAction SilentlyContinue
New-Item -ItemType Directory "$env:USERPROFILE\.repowise\web" | Out-Null
tar -xzf "$env:TEMP/web.tgz" -C "$env:USERPROFILE\.repowise\web"
Set-Content "$env:USERPROFILE\.repowise\web\.version" "<VER>" -NoNewline
```

> 可用的 GitHub 加速镜像（实测）：`https://ghfast.top/`、`https://ghproxy.net/`（直连 github.com 超时）。

当前状态：CLI **0.60.1**，UI 缓存 **0.60.1**（Next.js 15.5.28），旧版缓存备份在
`~/.repowise/web.0.47.0.bak`（确认稳定后可删，省 136 MB）。