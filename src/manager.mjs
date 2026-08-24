// ServiceManager — abstracts "start/stop/restart" of a registered project.
// Default selection: macOS → launchd (system-native, KeepAlive, RunAtLoad);
// other platforms → child_process. The architecture is open to a future
// SystemdManager for Linux without changing callers.
import { spawn, execFile } from 'node:child_process';
import { mkdir, writeFile, unlink, readFile, access, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { log } from './logger.mjs';

const execFileP = promisify(execFile);

const RUNSERVER_HOME = process.env.RUNSERVER_HOME
  || path.join(os.homedir(), '.runserver');
const PIDS_DIR = path.join(RUNSERVER_HOME, 'pids');
const LOGS_DIR = path.join(RUNSERVER_HOME, 'logs');
const PLIST_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');

await mkdir(PIDS_DIR, { recursive: true });
await mkdir(LOGS_DIR, { recursive: true });

// ─── ServiceManager interface (duck-typed) ───────────────────────────
// start(spec) / stop(id) / restart(id) / isRunning(id) / status(id)

// ─── ChildProcessManager (cross-platform fallback) ──────────────────
class ChildProcessManager {
  async start(spec) {
    if (await this.isRunning(spec.id)) {
      log.warn(`${spec.id}: already running, skipping start`);
      return;
    }
    const logFile = path.join(LOGS_DIR, `${spec.id}.log`);
    const out = await openAppend(logFile);
    const child = spawn(spec.command, spec.args, {
      env: { ...process.env, ...(spec.env || {}) },
      cwd: spec.cwd,
      detached: true,
      stdio: ['ignore', out.fd, out.fd],
    });
    child.unref();
    await writeFile(path.join(PIDS_DIR, `${spec.id}.pid`), String(child.pid));
    log.ok(`${spec.id}: started (pid ${child.pid}, logs: ${logFile})`);
  }

  async stop(id) {
    const pid = await readPid(id);
    if (!pid) {
      log.warn(`${id}: no pid file, nothing to stop`);
      return;
    }
    try {
      process.kill(pid, 'SIGTERM');
      log.ok(`${id}: sent SIGTERM to pid ${pid}`);
    } catch (e) {
      if (e.code === 'ESRCH') {
        log.warn(`${id}: pid ${pid} not alive, removing stale pid file`);
      } else {
        throw e;
      }
    }
    try { await unlink(path.join(PIDS_DIR, `${id}.pid`)); } catch {}
  }

  async restart(spec) {
    await this.stop(spec.id);
    await sleep(500);
    await this.start(spec);
  }

  async isRunning(id) {
    const pid = await readPid(id);
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      if (e.code === 'ESRCH') {
        try { await unlink(path.join(PIDS_DIR, `${id}.pid`)); } catch {}
        return false;
      }
      throw e;
    }
  }

  async status(id) {
    const running = await this.isRunning(id);
    const pid = running ? await readPid(id) : null;
    return { backend: 'child_process', running, pid };
  }
}

// ─── LaunchdManager (macOS, system-native) ──────────────────────────
class LaunchdManager {
  constructor() {
    if (process.platform !== 'darwin') {
      throw new Error('LaunchdManager is macOS-only');
    }
  }
  labelFor(id) { return `com.runserver.${id}`; }
  plistFor(id) { return path.join(PLIST_DIR, `${this.labelFor(id)}.plist`); }

  async start(spec) {
    await mkdir(PLIST_DIR, { recursive: true });
    const logFile = path.join(LOGS_DIR, `${spec.id}.log`);
    const errFile = path.join(LOGS_DIR, `${spec.id}.error.log`);

    // launchd's default PATH is /usr/bin:/bin:/usr/sbin:/sbin — anything
    // installed in user-managed runtimes (vmr/asdf/nix) is invisible. We
    // therefore resolve the command to an absolute path here, via `which`
    // against the current process's PATH. This is the same trick brew uses
    // for `HOMEBREW_PREFIX`/Cellar binaries in its plists.
    let command = spec.command;
    if (!path.isAbsolute(command)) {
      const abs = await resolveOnPath(command);
      if (!abs) {
        throw new Error(`${spec.id}: command '${command}' not found in PATH — install it first`);
      }
      command = abs;
    }

    // IMPORTANT: do NOT inherit the current process env into the plist wholesale —
    // it pollutes launchd with hundreds of shell-only / IDE variables. We DO
    // need to forward the user's PATH though, because (a) the shebang
    // `#!/usr/bin/env node` in many CLI tools needs to resolve `node`, and
    // (b) launchd's default PATH is just /usr/bin:/bin:/usr/sbin:/sbin, which
    // excludes user runtimes (vmr, asdf, nix, brew, etc.). Spec env overrides.
    const plist = renderPlist({
      label: this.labelFor(spec.id),
      command,
      args: spec.args,
      env: { PATH: process.env.PATH || '/usr/bin:/bin', ...(spec.env || {}) },
      logFile,
      errFile,
    });
    const plistPath = this.plistFor(spec.id);
    await writeFile(plistPath, plist);
    try {
      // `launchctl bootstrap` is the modern API but on some macOS user
      // sessions it fails with "Input/output error" while the legacy
      // `launchctl load -w` works against the same plist. We use the legacy
      // API — same outcome, broader compatibility.
      await this._launchctl(['load', '-w', plistPath]);
      log.ok(`${spec.id}: registered as launchd agent (${plistPath}, ${command})`);
    } catch (e) {
      log.error(`${spec.id}: launchctl load failed: ${e.message}`);
      throw e;
    }
  }

  async stop(id) {
    const plistPath = this.plistFor(id);
    try {
      await this._launchctl(['unload', plistPath]);
      log.ok(`${id}: launchd agent unloaded`);
    } catch (e) {
      log.warn(`${id}: launchctl unload failed (${e.message}) — may already be stopped`);
    }
    try { await unlink(plistPath); } catch {}
  }

  async restart(spec) {
    await this.stop(spec.id);
    await this.start(spec);
  }

  async isRunning(id) {
    try {
      const { stdout } = await this._launchctl(['list']);
      for (const line of stdout.split('\n')) {
        if (line.includes(this.labelFor(id))) {
          // launchctl list format: "PID  Status  Label"
          // PID column: '-' if not running, numeric if running
          const firstCol = line.trim().split(/\s+/)[0];
          const pid = parseInt(firstCol, 10);
          if (Number.isFinite(pid) && pid > 0) return true;
        }
      }
    } catch (e) {
      log.warn(`${id}: launchctl list failed: ${e.message}`);
    }
    return false;
  }

  async status(id) {
    const running = await this.isRunning(id);
    let pid = null;
    if (running) {
      try {
        const { stdout } = await this._launchctl(['list']);
        for (const line of stdout.split('\n')) {
          if (line.includes(this.labelFor(id))) {
            const firstCol = line.trim().split(/\s+/)[0];
            const p = parseInt(firstCol, 10);
            if (Number.isFinite(p) && p > 0) { pid = p; break; }
          }
        }
      } catch {}
    }
    return { backend: 'launchd', running, pid, label: this.labelFor(id), plist: this.plistFor(id) };
  }

  _launchctl(args) {
    return execFileP('launchctl', args);
  }
}

// ─── Factory + default selection ────────────────────────────────────
export function getDefaultManager() {
  if (process.platform === 'darwin') {
    return new LaunchdManager();
  }
  // TODO: linux → SystemdManager (write ~/.config/systemd/user/<id>.service + systemctl --user)
  return new ChildProcessManager();
}

export function listAvailableBackends() {
  return ['launchd', 'child_process'];
}

// ─── Helpers ────────────────────────────────────────────────────────
async function readPid(id) {
  const p = path.join(PIDS_DIR, `${id}.pid`);
  if (!existsSync(p)) return null;
  try {
    const v = (await readFile(p, 'utf8')).trim();
    return parseInt(v, 10) || null;
  } catch {
    return null;
  }
}

async function openAppend(file) {
  const fs = await import('node:fs');
  const fd = fs.openSync(file, 'a');
  return { fd };
}

async function resolveOnPath(cmd) {
  // Search the current process's PATH so that the resolved absolute path is
  // portable enough to embed into a launchd plist (which has a minimal PATH).
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, cmd);
    try {
      const st = await stat(candidate);
      if (st.isFile() && (st.mode & 0o111)) return candidate;
    } catch {}
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function xmlEscape(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

function renderPlist({ label, command, args, env, logFile, errFile }) {
  const envLines = Object.entries(env)
    .map(([k, v]) => `      <key>${xmlEscape(k)}</key>\n      <string>${xmlEscape(v)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(command)}</string>
${args.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n')}
  </array>
${envLines ? `  <key>EnvironmentVariables</key>\n  <dict>\n${envLines}\n  </dict>\n` : ''}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(errFile)}</string>
</dict>
</plist>
`;
}

export { RUNSERVER_HOME, PIDS_DIR, LOGS_DIR, ChildProcessManager, LaunchdManager };
