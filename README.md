# RunServer

> A local services manager for **recorded open-source projects**. One Web UI (port `12345`) lists every project you have installed locally, with start / stop / restart buttons. CLI and registry-extensible.

[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-20%2F20%20passing-brightgreen)](tests)

```sh
$ runserver web
Web UI listening on http://127.0.0.1:12345
Backend: LaunchdManager on darwin
```

![RunServer dashboard](docs/dashboard.png)
*(screenshot — auto-refresh card UI with start/stop/restart per project)*

---

## Why

Most open-source projects ship a one-line launch command and stop there:

| project | one-liner |
|---|---|
| DeepSeek Harness | `npx @deepseek-ai/dsh web` |
| SillyTavern | `node server.js` (after `git clone` + `npm install`) |
| llamactl | `go install ...@latest` → `llamactl serve` |
| zim-mcp-server | `uv run python server.py` |

There's no uniform way to start / stop / restart them; no unified dashboard; no `brew services`-style lifecycle. RunServer is a thin platform that **discovers, unifies, and controls** them:

- **Scans** your machine for registered open-source projects it knows about.
- **Shows only** the ones actually installed — no "not installed" clutter.
- **Starts / stops / restarts** them through the most stable backend the host offers:
  - **macOS** → `launchd` plist (`KeepAlive` + `RunAtLoad`, system-native, survives reboot & crash).
  - **Other platforms** → `child_process` (cross-platform fallback, log + pid file under `~/.runserver`).
- Exposes a **Web UI on `http://127.0.0.1:12345`** and a **CLI** (`runserver web|start|stop|restart|status|list|scan|info`).
- **Registry-extensible** — adding a new upstream is a single-file change.

## What's recorded right now

| id | install form | what it is |
|---|---|---|
| `deepseek-harness` | `npm i -g @deepseek-ai/dsh` | DeepSeek's open-source agent harness (DSH) |
| `sillytavern` | `git clone` + `npm install` | LLM chat frontend, runs from a local checkout |
| `zim-mcp-server` | `git clone` + `uv sync` | MCP server for ZIM offline knowledge bases |
| `llamactl` | `go install ...@latest` | Unified routing for llama.cpp / MLX / vLLM (single Go binary) |

Four very different install forms — npm, git+node, git+python, single Go binary — all controlled from the same UI.

## Install

### From source (recommended for v0.2.0)

```sh
git clone https://github.com/FaberEli/RunServer
cd RunServer
chmod +x bin/runserver
./bin/runserver web
```

### From npm (when a release is published)

```sh
npm install -g runserver
runserver web
```

The wrapper at `bin/runserver` resolves the real entry script relative to itself, so `npm link`, `npm i -g`, and `brew install` all work identically.

## Usage

### Web UI

Open `http://127.0.0.1:12345`. Each card shows:

- Project name + version
- Status badge (`运行中` / `已停止`)
- Backend badge (`launchd` or `child_process`)
- **启动 / 停止 / 重启** buttons
- An **"打开"** button linking to the project's own UI (e.g. `http://127.0.0.1:3080` for DSH)
- A **如何安装** section (if you want to install the project but haven't yet)

If nothing shows up, install one of the registered projects and hit **↻ 刷新**.

### CLI

```sh
runserver web                       # start the dashboard
runserver list                      # show all registered projects
runserver scan                      # rescan local installations
runserver status                    # status of every installed project
runserver start deepseek-harness    # start one
runserver stop  deepseek-harness    # stop
runserver restart deepseek-harness  # restart
runserver info                      # backend + paths
```

## Adding a new project

Drop a `.mjs` file into `src/projects/` that exports a `project` object:

```js
export const project = {
  // id MUST be the upstream's full product name (or reverse-DNS).
  // 'ollama' ✓, 'dsh' ✗, 'io.example.tool' ✓
  id: 'ollama',
  name: 'Ollama',
  description: 'Run LLMs locally.',
  homepage: 'https://ollama.com',
  // Optional: show the user how to install it (read-only — RunServer
  // never auto-installs; you decide when to run the command).
  install: {
    type: 'brew',   // one of: npm | go | pip | git | binary | docker | brew
    command: 'brew install ollama',
    note: 'macOS Homebrew; alternatives exist for Linux/Windows.',
  },
  // detect() decides whether this project shows up in the UI at all.
  detect: async () => {
    if (await which('ollama')) return { installed: true, version: '...' };
    return { installed: false, note: '`ollama` not in PATH' };
  },
  // service() is only called when the user clicks Start. It returns the
  // run spec — command, args, cwd, env — that the manager will hand to
  // launchd (macOS) or spawn directly (other).
  service: async () => ({
    command: 'ollama',
    args: ['serve'],
    env: {},
  }),
  // ui is optional. Omit it for non-HTTP servers (e.g. MCP/stdio).
  ui: { port: 11434, url: 'http://127.0.0.1:11434', label: 'Web UI' },
};
```

The registry auto-loads it on next start (or hot-reload via `reload()`). The `id`, `name`, and `detect` fields are required. `install`, `service`, and `ui` are optional.

### Install-form types

| `install.type` | example command | one-liner install target |
|---|---|---|
| `npm` | `npm i -g foo` | npm global package |
| `go` | `go install github.com/x/y@latest` | Go single binary |
| `pip` | `uv sync` (after git clone) | Python project |
| `git` | `git clone ... && cd ... && npm install` | Source checkout |
| `binary` | `curl -L ... \| tar -xz` | downloaded binary |
| `docker` | `docker run -d ...` | container |
| `brew` | `brew install foo` | Homebrew formula |

RunServer just **shows** the install command in the UI — it never runs it. You stay in control of when and how things get installed.

## Project layout

```
RunServer/
├── bin/
│   └── runserver              # CLI entry, resolves src/cli.mjs
├── src/
│   ├── cli.mjs                # web | start | stop | restart | status | list | scan | info
│   ├── server.mjs             # http on 127.0.0.1:12345, REST API
│   ├── scanner.mjs            # detection runner
│   ├── registry.mjs           # auto-loads src/projects/*.mjs
│   ├── manager.mjs            # ServiceManager abstract + child_process + launchd
│   ├── logger.mjs             # leveled logger (debug/info/warn/error)
│   ├── projects/
│   │   ├── deepseek-harness.mjs
│   │   ├── sillytavern.mjs
│   │   ├── zim-mcp-server.mjs
│   │   └── llamactl.mjs
│   └── web/
│       └── index.html         # single-file dashboard
├── tests/
│   ├── manager.test.mjs       # renderPlist, parseEnvText
│   ├── logger.test.mjs        # level filtering + env override
│   ├── registry.test.mjs      # id validator (full-name + reverse-DNS)
│   ├── scanner.test.mjs       # installed-only filtering
│   └── integration/run.sh     # native Node ESM loader (no vite-node)
├── .github/workflows/ci.yml   # lint + test
├── package.json
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

## Configuration

### `~/.runserver/`

State directory (override with `RUNSERVER_HOME`):

```
~/.runserver/
├── pids/<project-id>.pid      # ChildProcessManager pid files
└── logs/<project-id>.log      # ChildProcessManager combined logs
```

`launchd` plists live at `~/Library/LaunchAgents/com.runserver.<id>.plist`.

### Environment variables

| variable | default | what it does |
|---|---|---|
| `RUNSERVER_HOST` | `127.0.0.1` | Web UI bind address |
| `RUNSERVER_PORT` | `12345` | Web UI port |
| `RUNSERVER_HOME` | `~/.runserver` | state directory |
| `RUNSERVER_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `RUNSERVER_QUIET` | unset | `1` to silence everything except `error` |
| `RUNSERVER_PROJECTS_DIR` | `src/projects` | override projects dir (testing) |

## Why not just `brew services`?

`brew services` is per-formula — it requires a dedicated Homebrew formula per upstream project, plus keeping a launchd plist in lockstep with each upstream release. RunServer delegates the lifecycle to a small **registry**, so adding a new upstream is one new file, not a Homebrew release. The backend selection (launchd vs child_process) is automatic and per-host.

## Development

```sh
git clone https://github.com/FaberEli/RunServer
cd RunServer
npm install
npm test            # vitest, 20 tests
bash tests/integration/run.sh   # real loader + dynamic import
```

To add a new project: `cp src/projects/sillytavern.mjs src/projects/your-tool.mjs` and edit. No need to touch any other file.

## Compatibility

| OS | backend | notes |
|---|---|---|
| macOS 12+ | `launchd` (preferred) | uses `launchctl load -w` / `unload` for compatibility |
| Linux | `child_process` (fallback) | Systemd support is on the roadmap (P3) |
| Windows | `child_process` (fallback) | shebang is bash + node, no `.cmd` shim yet |

## License

MIT. See [LICENSE](LICENSE).
