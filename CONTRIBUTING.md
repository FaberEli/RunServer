# Contributing

Thanks for your interest in RunServer. Here's how to add a new project plugin, fix a bug, or change the manager.

## Project conventions

- **Pure Node.js ESM** (`.mjs`). No TypeScript, no build step. Drop a file, run it.
- **Zero runtime dependencies** — the source uses only Node built-ins (`node:fs`, `node:child_process`, `node:http`, `node:url`, `node:path`, `node:os`, `node:util`).
- **Tests** use [vitest](https://vitest.dev) for unit + [bash integration script](tests/integration/run.sh) for the dynamic-import path. The integration script is necessary because vite-node has a known issue with URL-encoded workspace paths (e.g. `03_受控安装`).
- **No new top-level `await` side effects** — the `manager.mjs` was changed in 0.2.0 to do filesystem init lazily. New modules should follow the same pattern.

## Adding a new project (the most common contribution)

1. Copy `src/projects/sillytavern.mjs` (or whichever is closest in install form) to `src/projects/your-tool.mjs`.
2. Edit the `project` export. Required fields:
   - `id` — the upstream's **full product name** (or reverse-DNS). Short ids (≤3 chars) are rejected unless they look like `io.x` or `com.foo`. The validator runs in `registry.mjs#validateProject`.
   - `name` — human-readable.
   - `detect()` — returns `{ installed: true, version?, note? }` or `{ installed: false, note? }`. The UI only shows projects where this returns `installed: true`.
3. Optional fields:
   - `description`, `homepage` — surfaced in the UI card.
   - `install` — `{ type, command, note? }`. `type` must be one of `npm | go | pip | git | binary | docker | brew`. Shown read-only in the UI; never auto-run.
   - `service()` — returns `{ command, args, cwd?, env? }` for the manager to launch. Called only when the user clicks Start. If your service spec is sensitive to env (e.g. `~/.dsh/env`), use the exported `parseEnvText` from `manager.mjs` to read it.
   - `ui` — `{ port, url, label? }`. Omit for non-HTTP services (MCP, db-only, etc.).
4. Run `npm test` and `bash tests/integration/run.sh`. Both must pass.
5. Open a PR with the new file. Update `README.md`'s "What's recorded right now" table.

## Adding a new backend (e.g. `systemd` for Linux)

The `ServiceManager` interface (duck-typed) is:

```js
{
  start(spec):  Promise<void>     // start the service
  stop(id, opts?): Promise<void>  // stop (opts.timeoutMs defaults to 8s)
  restart(spec): Promise<void>    // stop + start
  isRunning(id): Promise<boolean>
  status(id):    Promise<{ running, pid?, ... }>
  cleanup(id):   Promise<void>    // wipe any stale state for this id
}
```

Put the new backend in `manager.mjs` (or split it out into its own file and re-export). Add it to `getDefaultManager()` for the appropriate platform.

## Style

- 2-space indent
- `async/await`, no `.then()` chains
- Comments explain *why*, not *what*
- One public export per logical unit (no giant `module.exports = { ... }` bags)
- `process.env.X` reads inside functions, not at module top level (see `getProjectsDir` in `registry.mjs` for the rationale — env-var tests need a chance to set the variable before it's read)

## Release process

- Bump the version in `package.json`.
- Add a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md` (Keep a Changelog format).
- Commit, tag `vX.Y.Z`, push. GitHub Actions will run the test matrix.
- For breaking changes: write a migration note in the CHANGELOG entry.

## Reporting bugs

Open a GitHub issue with:

- The exact `runserver info` output (platform, backend, version, paths)
- The exact command that produced the bug
- The contents of `~/.runserver/logs/<id>.{log,error.log}` if it's a service-start issue
- Whether `RUNSERVER_LOG_LEVEL=debug` adds anything useful
