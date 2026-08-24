# RunServer

Local services manager for **recorded open-source projects** — a single Web UI (port `12345`) that lists every project you have installed locally, with start / stop / restart buttons. CLI too. Homebrew friendly.

The first registered project is **DeepSeek Harness (`dsh`)**. Adding more is a single-file change.

## Why

Most open-source projects ship a one-line launch command (`npx @deepseek-ai/dsh web`, `docker run ...`, `ollama serve`, etc.) and stop there. There is no uniform way to start/stop/restart them; no unified dashboard; no `brew services`-style lifecycle.

RunServer is a thin platform that:

- **Scans** your machine for registered open-source projects it knows about.
- **Shows** only the ones that are actually installed — no "not installed" clutter (per project requirement: don't be locked to any single upstream).
- **Starts / stops / restarts** them through the most stable backend available on the host:
  - macOS → **`launchd` plist** (system-native, `KeepAlive` + `RunAtLoad`, survives reboot & crash)
  - Other → **child process** under `~/.runserver/pids/`, log to `~/.runserver/logs/`
- Exposes a **Web UI on `http://127.0.0.1:12345`** and a **CLI** (`runserver web|start|stop|restart|status|list|scan`).
- Installs cleanly via **Homebrew**, **npm**, or **source**.

## Install

### Homebrew (recommended on macOS)

```sh
brew tap FaberEli/dsh
brew install runserver
brew services start runserver
open http://127.0.0.1:12345
```

`brew services` will register a launchd plist for RunServer itself (auto-start on boot + restart on crash). The Web UI will come up at `http://127.0.0.1:12345`.

### From source

```sh
git clone https://github.com/FaberEli/RunServer
cd RunServer
chmod +x bin/runserver
./bin/runserver web
```

The wrapper resolves the real entry script relative to itself, so `npm link`, `npm i -g`, and `brew install` all work.

### npm

```sh
npm install -g .
runserver web
```

## Usage

### Web UI

Open `http://127.0.0.1:12345`. Each card shows:

- Project name + version
- Status badge (`running` / `stopped`)
- Backend badge (`launchd` or `child_process`)
- **Start / Stop / Restart** buttons
- An **"Open"** button linking to the project's own Web UI (e.g. `http://127.0.0.1:3080` for dsh)

If nothing is shown, install a project (e.g. `npm i -g @deepseek-ai/dsh`) and hit **↻ Refresh**.

### CLI

```sh
runserver web                       # start the dashboard
runserver list                      # show all registered projects
runserver scan                      # rescan local installations
runserver status                    # status of every installed project
runserver start deepseek-harness    # start one
runserver stop deepseek-harness     # stop
runserver restart deepseek-harness  # restart
runserver info                      # backend + paths
```

## Adding a new project

Drop a `.mjs` file into `src/projects/` that exports a `project` object with this shape:

```js
export const project = {
  id: 'your-project',
  name: 'Your Project',
  description: '...',
  homepage: 'https://...',
  detect: async () => {
    // Return { installed: false } if not present on this machine.
    // The UI hides projects that return installed: false — no clutter.
    if (await which('your-cli')) return { installed: true, version: '...' };
    return { installed: false, note: '`your-cli` not in PATH' };
  },
  service: async () => {
    // Only called when the user clicks "Start". Return the spec the manager
    // should execute, or null if not startable right now.
    return { command: 'your-cli', args: ['serve', '--no-open'], env: {} };
  },
  ui: { port: 9000, url: 'http://127.0.0.1:9000', label: 'Open' },
};
```

The registry auto-loads it. No other code changes required.

## Files

```
RunServer/
├── bin/runserver                  # CLI entry (resolves src/cli.mjs)
├── src/
│   ├── cli.mjs                    # web | start | stop | restart | status | list | scan | info
│   ├── server.mjs                 # http on 127.0.0.1:12345, REST API
│   ├── scanner.mjs                # detection runner
│   ├── registry.mjs               # auto-loads src/projects/*.mjs
│   ├── manager.mjs                # ServiceManager abstract + child_process + launchd impls
│   ├── projects/
│   │   └── deepseek-harness.mjs   # first project
│   ├── web/index.html             # the dashboard
│   └── logger.mjs
├── package.json
├── README.md
└── LICENSE
```

## Why not just `brew services`?

`brew services` is per-formula — it requires a dedicated Homebrew formula per upstream project, plus keeping a launchd plist in lockstep with each upstream release. RunServer delegates the lifecycle to a small registry, so adding a new upstream is **one new file**, not a Homebrew release. The Homebrew formula in this repo (`homebrew-dsh/Formula/runserver.rb`) is for **RunServer itself** — its child projects use whichever backend RunServer picks (`launchd` on macOS, `child_process` elsewhere).

## Companion tap

`FaberEli/homebrew-dsh` (the Homebrew tap) ships `Formula/runserver.rb`. `brew tap FaberEli/dsh && brew install runserver` is the canonical install path.

## License

MIT.
