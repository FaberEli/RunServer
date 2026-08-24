# RunServer

> 一个**记录型开源项目**的本地服务管理平台。统一 Web UI（端口 `12345`）列出本地已装的开源服务，并提供 start / stop / restart 按钮。CLI + 可扩展注册表。

[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](tests)

**[English](README.md)** | [中文](README.zh.md)

```sh
$ runserver web
Web UI listening on http://127.0.0.1:12345
Backend: LaunchdManager on darwin
```

---

## 为什么需要 RunServer？

大多数开源项目都只给一个"一行启动命令"就完事：

| 项目 | 启动命令 |
|---|---|
| DeepSeek Harness | `npx @deepseek-ai/dsh web` |
| SillyTavern | `node server.js`（先 `git clone` + `npm install`） |
| llamactl | `go install ...@latest` → `llamactl serve` |
| zim-mcp-server | `uv run python server.py` |

没有统一的"启动 / 停止 / 重启" 入口；没有统一面板；没有 `brew services` 风格的进程生命周期。RunServer 是一个**薄平台**，统一解决这层：

- **扫描**本机已装的、已注册的开源项目
- **只显示**已装的（未装的不出现，避免干扰）
- **按本机最稳的方式**自动启停：
  - **macOS** → `launchd` plist（`KeepAlive` + `RunAtLoad`，系统级，重启/崩溃自动拉起）
  - **Linux** → `systemd` user unit（`Type=simple` + `Restart=on-failure`，跨登录会话保活）
  - **其他平台** → `child_process`（跨平台兜底，pid + 日志在 `~/.runserver`）
- **Web UI on `http://127.0.0.1:12345`** + **CLI**（`web|start|stop|restart|status|list|scan|port|info`）
- **注册表可扩展**——加新项目只新增一个 `.mjs` 文件

## 已支持的项目

| id | 安装形式 | 作用 |
|---|---|---|
| `deepseek-harness` | `npm i -g @deepseek-ai/dsh` | DeepSeek 的开源 agent harness（DSH） |
| `sillytavern` | `git clone` + `npm install` | LLM 角色扮演前端，本地跑 |
| `zim-mcp-server` | `git clone` + `uv sync` | ZIM 离线知识库的 MCP server |
| `llamactl` | `go install ...@latest` | llama.cpp / MLX / vLLM 统一路由（单 Go 二进制） |

四种完全不同的安装形式——npm / git+node / git+python / 单 Go 二进制——全部由同一个 UI 控制。

## 安装

### 从 Homebrew（macOS 推荐）

```sh
brew tap FaberEli/runserver
brew install runserver
brew services start runserver
open http://127.0.0.1:12345
```

`brew services` 会注册一个 launchd plist（自启动 + 崩溃重启）。Web UI 在 `http://127.0.0.1:12345`。

### 从源码

```sh
git clone https://github.com/FaberEli/RunServer
cd RunServer
chmod +x bin/runserver
./bin/runserver web
```

### 从 npm（release 后）

```sh
npm install -g runserver
runserver web
```

`bin/runserver` wrapper 解析真实路径，所以 `npm link` / `npm i -g` / `brew install` 三种方式都一致工作。

## 使用

### Web UI

打开 `http://127.0.0.1:12345`。每张卡片显示：

- 项目名 + 版本
- 状态徽章（`运行中` / `已停止`）
- 后端徽章（`launchd` / `systemd` / `child_process`）
- **启动 / 停止 / 重启** 按钮
- "打开"按钮直跳到项目自己的 UI（如 DSH 的 `http://127.0.0.1:3080`）
- **如何安装** 折叠区（如果项目没装，按里面的命令装完点 ↻ 刷新）

如果没显示任何卡片：装一个上面支持的项目，按 **↻ 刷新**。

### CLI

```sh
runserver web [--port N] [--host H]   # 启动面板
runserver list                        # 列出已注册项目
runserver scan                        # 重新扫描本地安装
runserver status                      # 状态总览
runserver start deepseek-harness      # 启动一个
runserver stop  deepseek-harness      # 停止
runserver restart deepseek-harness    # 重启
runserver port deepseek-harness 4080  # 钉端口（写 ~/.runserver/config.json）
runserver port deepseek-harness       # 查当前
runserver port deepseek-harness clear # 还原默认
runserver web-port 15000              # 改 Web UI 端口
runserver info                        # 后端 / 路径
```

### 端口处理

- 每个项目有默认端口（来自 `ui.port`）
- 启动时如果被占 → **auto-pick 下一个空闲端口**（向上 50 个），log warn，CLI / Web UI 显示**实际绑定的端口**
- 钉端口用 `runserver port <id> <n>` 或 Web UI 输入框
- Web UI 自己的端口：`runserver web-port <n>`，也存在 `~/.runserver/config.json`

## 加新项目

在 `src/projects/` 目录下加一个 `.mjs`，导出一个 `project` 对象：

```js
export const project = {
  // id 必须是上游全名（或 reverse-DNS）。短 id (≤3 字符) 除非 reverse-DNS (io.x) 否则拒绝
  id: 'ollama',
  name: 'Ollama',
  description: '本地跑大模型',
  homepage: 'https://ollama.com',
  // install: 只展示给用户看，RunServer 不会自动跑
  install: {
    type: 'brew',   // npm | go | pip | git | binary | docker | brew
    command: 'brew install ollama',
    note: 'macOS Homebrew；Linux/Windows 另有方案',
  },
  // detect() 决定本项目是否在 UI 显示
  detect: async () => {
    if (await which('ollama')) return { installed: true, version: '...' };
    return { installed: false, note: '`ollama` 不在 PATH' };
  },
  // service() 只在用户点 Start 时被调
  service: async () => ({
    command: 'ollama',
    args: ['serve'],
    env: {},
  }),
  // ui 可选。MCP / stdio 之类的非 HTTP 服务可以省略
  ui: { port: 11434, url: 'http://127.0.0.1:11434', label: 'Web UI' },
};
```

注册表自动加载，下次启动 / `reload()` 生效。`id` / `name` / `detect` 必填，`install` / `service` / `ui` 可选。

### install.type 类型表

| type | 示例命令 | 一行说明 |
|---|---|---|
| `npm` | `npm i -g foo` | npm 全局包 |
| `go` | `go install github.com/x/y@latest` | Go 单二进制 |
| `pip` | `uv sync`（git clone 后） | Python 项目 |
| `git` | `git clone ... && cd ... && npm install` | 源码检出 |
| `binary` | `curl -L ... \| tar -xz` | 下载的二进制 |
| `docker` | `docker run -d ...` | 容器 |
| `brew` | `brew install foo` | Homebrew formula |

RunServer **只展示** install 命令——绝不自动跑。你掌控什么时候装、怎么装。

## 跨平台

| 操作系统 | 后端 | 说明 |
|---|---|---|
| macOS 12+ | `launchd`（推荐） | 用 `launchctl load -w` 兼容老 session |
| Linux（systemd） | `systemd` user unit | `~/.config/systemd/user/<id>.service` + `systemctl --user` |
| Linux（非 systemd） | `child_process` | 兜底，pid + 日志在 `~/.runserver` |
| Windows | `child_process` | 服务化是 roadmap（P3） |

## 配置文件

`~/.runserver/`（可用 `RUNSERVER_HOME` 覆盖）：

```
~/.runserver/
├── config.json         # ports / webPort（原子写：.tmp + rename）
├── pids/<id>.pid        # ChildProcessManager 用的 pid 文件
└── logs/<id>.log        # ChildProcessManager 用的日志
```

launchd plist 装在 `~/Library/LaunchAgents/com.runserver.<id>.plist`。
systemd unit 装在 `~/.config/systemd/user/runserver-<id>.service`。

### 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `RUNSERVER_HOST` | `127.0.0.1` | Web UI 绑定地址 |
| `RUNSERVER_PORT` | `12345` | Web UI 端口 |
| `RUNSERVER_HOME` | `~/.runserver` | 状态目录 |
| `RUNSERVER_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `RUNSERVER_QUIET` | unset | `1` 静默一切（除 `error`） |
| `RUNSERVER_PROJECTS_DIR` | `src/projects` | 覆盖项目目录（测试用） |

## 为什么不用 `brew services` 直接管？

`brew services` 是 per-formula 的——每个上游项目要写一个 Homebrew formula，加 plist 还要跟上游 release 节奏同步。RunServer 把生命周期交给一个**小注册表**——加新上游只新增一个文件，不发 Homebrew release。后端选择（launchd / systemd / child_process）按系统自动挑。

## 开发

```sh
git clone https://github.com/FaberEli/RunServer
cd RunServer
npm install
npm test            # vitest, 40 测试
bash tests/integration/run.sh   # 真实 loader + dynamic import
```

加新项目：`cp src/projects/sillytavern.mjs src/projects/your-tool.mjs` 然后改。其他文件不需要动。

## 许可

MIT。
