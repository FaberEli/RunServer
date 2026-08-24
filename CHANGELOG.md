# Changelog

All notable changes to RunServer are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.1] - 2026-08-24

### Fixed
- **`bin/runserver` now resolves symlinks before computing the entry path.** When installed via Homebrew, `bin/runserver` is a symlink into `/opt/homebrew/Cellar/runserver/<ver>/bin/runserver`. The wrapper used `BASH_SOURCE[0]` directly, so the relative `..` landed on `/opt/homebrew` — and `node /opt/homebrew/src/cli.mjs` failed with `Cannot find module`. The wrapper now chases the symlink (via `realpath` when available, or a portable `readlink` loop on macOS) so it finds the real `src/cli.mjs` regardless of how the binary is invoked. This affects Homebrew installs and any other install path that uses a symlinked `bin/`.

## [0.3.0] - 2026-08-24

### Added
- **Port configuration** — every project's bind port can be overridden, and ports in use are auto-picked. New `src/config.mjs` reads/writes `~/.runserver/config.json` (atomic write, `.tmp` + rename). New `src/ports.mjs` parses `ServiceSpec` for the desired port (`--port N`, `-p N`, `*_PORT` env, generic `PORT`) and finds the next free port at startup.
- **`runserver port <id> [<n>]`** subcommand — read a project's port override, set it (writes to `config.json`), or `runserver port <id> clear` to drop back to the plugin default.
- **`runserver web-port [<n>]`** subcommand — read or set the Web UI port (default 12345). Persists in `config.json` as `webPort`.
- **`runserver web --port N`** and **`runserver web --host H`** — one-shot CLI flags (don't persist).
- **`POST /api/projects/:id/port`** and **`GET /api/projects/:id/port`** REST endpoints for the Web UI.
- **Web UI** — every card with a `ui.port` now has a "端口" number input. Editing it and blurring the field saves to `config.json`; the new port takes effect on next start.
- **Auto-pick behaviour** — when starting a project whose desired port is in use, RunServer logs `port :X in use — auto-picked :Y instead (override with: runserver port <id> <n>)` and binds the next free port. `spec._resolvedPort` is set on the returned spec so the CLI / Web UI can display the actual bound port.
- **CHANGELOG entry** kept; new tests in `tests/ports.test.mjs` (14 tests) and `tests/config.test.mjs` (5 tests).

### Changed
- `manager.start(spec)` now **returns the spec** (with `_resolvedPort` set) instead of `void`. Callers that need the resolved port should use the return value.

## [0.2.1] - 2026-08-24

### Fixed
- **launchd plist now sets `WorkingDirectory` when `spec.cwd` is provided.** Without it, any git-cloned Node project (e.g. SillyTavern) was launched with `node server.js` resolving to `/server.js` (Node's CWD-relative module resolver misinterpreted it as an absolute path). `renderPlist` now emits a `<key>WorkingDirectory</key>` block when `cwd` is set.
- **`sillytavern` and `zim-mcp-server` detect now require a populated dependency tree** (`node_modules` / `.venv`) before reporting `installed: true`. Previously a bare `git clone` was enough to make the project appear in the UI, but `node server.js` would crash on the first missing import. The detect now returns a clear `installed: false` with a `note` like "found source at <dir> but `node_modules` is missing — run `npm install` in that directory first" so the user knows what to do.

## [0.2.0] - 2026-08-24

### Added
- **Multi-install-form registry** — each project now declares how it installs (`install.type`: `npm | go | pip | git | binary | docker | brew`). The Web UI shows the install command in a collapsible "如何安装" section, but never auto-installs. Previously only npm-style projects were supported.
- **`sillytavern` project plugin** — `git clone` + `npm install` form, detects checkout in `$HOME/SillyTavern` or `$HOME/GitHub/SillyTavern`, runs `node server.js` from the discovered dir.
- **`zim-mcp-server` project plugin** — `git clone` + `uv sync` form, Python project. Demonstrates how to wrap an MCP/stdio server (no `ui` field → no "Open" button).
- **`llamactl` project plugin** — Go single binary (`go install ...@latest`). First `install.type: 'go'` example.
- **Vitest test suite** — 20 unit + integration tests covering `parseEnvText`, `renderPlist`, `level filtering`, `id validator`, `scanner filtering`. Plus a native-Node `tests/integration/run.sh` that exercises the real dynamic-import path (vite-node has a known bug with URL-unsafe workspace paths).
- **CI workflow** — `.github/workflows/ci.yml` runs lint + tests on macOS (matches the primary development target; backend is `launchd`-bound).
- **Logger** — added `debug` level and `RUNSERVER_LOG_LEVEL` env override; `RUNSERVER_QUIET` semantics now correctly suppress everything except `error`.
- **`CHANGELOG.md` + `CONTRIBUTING.md`** — project hygiene for open-source.
- **`RUNSERVER_PROJECTS_DIR` env override** — lets the test rig point at a copy of `src/projects` in `/tmp` to avoid the Chinese-character path issue with vite-node.

### Changed
- **`registry.mjs` — error isolation** — a broken project file (syntax error, missing `project` export, bad id) no longer breaks the registry. It logs an error and skips the file.
- **`registry.mjs` — id validator** — short ids (≤3 chars) are now rejected unless they look like reverse-DNS (`io.x`, `com.foo`). This prevents collisions as more projects are added.
- **`registry.mjs` — `loadAll()` reads the projects dir lazily** — `RUNSERVER_PROJECTS_DIR` env override takes effect on every load (no module reload needed).
- **`scanner.mjs` — error isolation** — a project whose `detect()` or `service()` throws no longer fails the whole scan; it's silently skipped.
- **`manager.mjs` — lazy filesystem init** — importing the module no longer touches the filesystem. Paths are created on first `start`/`stop`.
- **`manager.mjs` — `stop` polls until exit** — replaces the fire-and-forget `SIGTERM` with a poll loop (8s grace, then `SIGKILL`). The status endpoint no longer lies right after `stop`.
- **`manager.mjs` — `cleanup()` method on both backends** — wipes any stale plist/pid file before a fresh start, fixing the lingering `com.runserver.undefined` state from early-development bugs.
- **`manager.mjs` — `parseEnvText` exported** — supports `KEY=value`, `export KEY=value`, optional matching quotes, and `#` comments. Used by both `manager.start` (plist env) and every project plugin that reads an env file.
- **`manager.mjs` — `renderPlist` exported** — for unit tests, and for future "edit a project and re-render" features.
- **Web UI** — adds "如何安装" expandable section per card.

### Fixed
- `stop` followed immediately by `status` no longer reports `running: true`. The process is now actually waited on (up to 8s, then `SIGKILL`).
- launchd plists no longer fail to find `node` on systems where the user's PATH lives outside `/usr/bin` (vmr/asdf/nix) — the user's PATH is forwarded in `EnvironmentVariables`.
- launchd plists no longer reference commands by short name (which `launchd` can't resolve); the manager resolves to an absolute path before writing the plist.
- `launchctl bootstrap` failures with `Input/output error` on some macOS user sessions are avoided by using legacy `launchctl load -w` / `unload` instead. Same outcome, broader compatibility.
- The `com.runserver.<id>.plist` is no longer inherited with hundreds of irrelevant shell variables — only the project's own env plus `PATH` are forwarded.
- `RUNSERVER_QUIET=1` no longer silences `error` (it used to, because the level check was `< activeLevel` and quiet set `activeLevel = error`).

## [0.1.0] - 2026-08-24

### Added
- Initial release.
- Single `runserver` CLI + Web dashboard on `127.0.0.1:12345`.
- macOS `launchd` backend (`KeepAlive` + `RunAtLoad`) and cross-platform `child_process` fallback.
- One project registered: `deepseek-harness` (the upstream one-liner `npx @deepseek-ai/dsh web`).
- Pushed to `github.com/FaberEli/RunServer`.

[Unreleased]: https://github.com/FaberEli/RunServer/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/FaberEli/RunServer/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/FaberEli/RunServer/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/FaberEli/RunServer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/FaberEli/RunServer/releases/tag/v0.1.0
