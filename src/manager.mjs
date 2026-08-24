// ServiceManager — abstracts "start/stop/restart" of a registered project.
// Default selection: macOS → launchd (system-native, KeepAlive, RunAtLoad);
// other platforms → child_process. The architecture is open to a future
// SystemdManager for Linux without changing callers.
//
// P0 fixes (vs v0.1.0):
//   - Lazy init: importing this module no longer touches the filesystem.
//     Paths are resolved on first use via ensurePaths().
//   - stop(): polls isRunning until the process actually exits (or a deadline
//     passes) instead of fire-and-forget SIGTERM. Without this, status
//     immediately after stop could still report running=true.
//   - restart(): polls until stopped, no fixed sleep.
//   - launchd cleanup(): on start, boot out any stale `com.runserver.<id>`
//     label that survived a previous (buggy) run.
import { spawn, execFile } from 'node:child_process';
import { mkdir, writeFile, unlink, readFile, stat } from 'node:fs/promises';
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

let pathsReady = null;
function ensurePaths() {
  if (!pathsReady) {
    pathsReady = (async () => {
      await mkdir(PIDS_DIR, { recursive: true });
      await mkdir(LOGS_DIR, { recursive: true });
    })();
  }
  return pathsReady;
}

const STOP_TIMEOUT_MS = 8000;   // 8s grace period before SIGKILL
const STOP_POLL_MS = 200;       // how often to re-check during graceful stop
const RESTART_STOP_TIMEOUT_MS = 15000; // restart can be a bit more patient

// ─── ServiceManager interface (duck-typed) ───────────────────────────
// start(spec) / stop(id) / restart(spec) / isRunning(id) / status(id) / cleanup(id)

// ─── ChildProcessManager (cross-platform fallback) ──────────────────
class ChildProcessManager {
  async start(spec) {
    await ensurePaths();
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
    if (typeof child.pid !== 'number') {
      throw new Error(`${spec.id}: spawn returned no pid — ${spec.command} may not exist`);
    }
    await writeFile(path.join(PIDS_DIR, `${spec.id}.pid`), String(child.pid));
    log.ok(`${spec.id}: started (pid ${child.pid}, logs: ${logFile})`);
  }

  async stop(id, { timeoutMs = STOP_TIMEOUT_MS } = {}) {
    await ensurePaths();
    const pid = await readPid(id);
    if (!pid) {
      log.warn(`${id}: no pid file, nothing to stop`);
      return;
    }
    await sendSignalOrSkip(id, pid, 'SIGTERM');
    const exited = await waitForExit(id, pid, timeoutMs);
    if (!exited) {
      log.warn(`${id}: did not exit within ${timeoutMs}ms, sending SIGKILL`);
      try { process.kill(pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
      await waitForExit(id, pid, 2000);
    }
    try { await unlink(path.join(PIDS_DIR, `${id}.pid`)); } catch {}
    log.ok(`${id}: stopped`);
  }

  async restart(spec, opts = {}) {
    await ensurePaths();
    if (await this.isRunning(spec.id)) {
      await this.stop(spec.id, { timeoutMs: RESTART_STOP_TIMEOUT_MS });
    }
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
      // EPERM means the process exists but we can't signal it — count as running
      if (e.code === 'EPERM') return true;
      throw e;
    }
  }

  async status(id) {
    const running = await this.isRunning(id);
    const pid = running ? await readPid(id) : null;
    return { backend: 'child_process', running, pid };
  }

  async cleanup(id) {
    await ensurePaths();
    try { await unlink(path.join(PIDS_DIR, `${id}.pid`)); } catch {}
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
    await ensurePaths();
    await mkdir(PLIST_DIR, { recursive: true });
    await this.cleanup(spec.id); // P0-4: remove any stale label/plist before we begin

    const logFile = path.join(LOGS_DIR, `${spec.id}.log`);
    const errFile = path.join(LOGS_DIR, `${spec.id}.error.log`);

    // Resolve command to absolute path (launchd's default PATH is minimal).
    let command = spec.command;
    if (!path.isAbsolute(command)) {
      const abs = await resolveOnPath(command);
      if (!abs) {
        throw new Error(`${spec.id}: command '${command}' not found in PATH — install it first`);
      }
      command = abs;
    }

    // Forward user PATH so that `#!env node` shebangs can find `node`.
    // Don't pass process.env wholesale — it pollutes launchd with shell state.
    const plist = renderPlist({
      label: this.labelFor(spec.id),
      command,
      args: spec.args,
      env: { PATH: process.env.PATH || '/usr/bin:/bin', ...(spec.env || {}) },
      cwd: spec.cwd,
      logFile,
      errFile,
    });
    const plistPath = this.plistFor(spec.id);
    await writeFile(plistPath, plist);
    try {
      // Legacy load -w is more reliable on macOS user sessions than bootstrap
      // (the modern API sometimes returns EIO while the legacy one works).
      await this._launchctl(['load', '-w', plistPath]);
      log.ok(`${spec.id}: registered as launchd agent (${plistPath}, ${command})`);
    } catch (e) {
      log.error(`${spec.id}: launchctl load failed: ${e.message}`);
      throw e;
    }
  }

  async stop(id, opts = {}) {
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
        if (!line.includes(this.labelFor(id))) continue;
        // launchctl list format: "PID  Status  Label"
        // PID column: '-' or empty if not running, numeric if running
        const firstCol = line.trim().split(/\s+/)[0];
        const pid = parseInt(firstCol, 10);
        if (Number.isFinite(pid) && pid > 0) return true;
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
          if (!line.includes(this.labelFor(id))) continue;
          const firstCol = line.trim().split(/\s+/)[0];
          const p = parseInt(firstCol, 10);
          if (Number.isFinite(p) && p > 0) { pid = p; break; }
        }
      } catch {}
    }
    return { backend: 'launchd', running, pid, label: this.labelFor(id), plist: this.plistFor(id) };
  }

  /**
   * P0-4: try to evict any leftover state for this id before re-starting.
   * Earlier bugs (e.g. an empty id) registered labels like
   * `com.runserver.undefined` that survive a `rm <plist>`; they cause
   * subsequent `bootstrap` to fail with EIO. We replay the same unload
   * flow on a path that may not exist, ignoring all errors.
   */
  async cleanup(id) {
    const plistPath = this.plistFor(id);
    try { await this._launchctl(['unload', plistPath]); } catch {}
    try { await unlink(plistPath); } catch {}
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
    const pid = parseInt(v, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function openAppend(file) {
  const fs = await import('node:fs');
  const fd = fs.openSync(file, 'a');
  return { fd };
}

async function sendSignalOrSkip(id, pid, signal) {
  try {
    process.kill(pid, signal);
    log.info(`${id}: sent ${signal} to pid ${pid}`);
  } catch (e) {
    if (e.code === 'ESRCH') {
      log.warn(`${id}: pid ${pid} not alive`);
    } else if (e.code === 'EPERM') {
      log.warn(`${id}: pid ${pid} exists but no permission to signal`);
    } else {
      throw e;
    }
  }
}

async function waitForExit(id, pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (e) {
      if (e.code === 'ESRCH') return true;
      if (e.code === 'EPERM') return true; // process still exists, not our problem
    }
    await new Promise((r) => setTimeout(r, STOP_POLL_MS));
  }
  return false;
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

function xmlEscape(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

/**
 * Render a launchd plist. Exported for unit tests.
 * @param {{label:string, command:string, args:string[], env:Record<string,string>, logFile:string, errFile:string, cwd?:string}} p
 */
export function renderPlist(p) {
  const envLines = Object.entries(p.env || {})
    .map(([k, v]) => `      <key>${xmlEscape(k)}</key>\n      <string>${xmlEscape(v)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(p.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(p.command)}</string>
${p.args.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n')}
  </array>
${envLines ? `  <key>EnvironmentVariables</key>\n  <dict>\n${envLines}\n  </dict>\n` : ''}${p.cwd ? `  <key>WorkingDirectory</key>\n  <string>${xmlEscape(p.cwd)}</string>\n` : ''}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(p.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(p.errFile)}</string>
</dict>
</plist>
`;
}

/** Parse a `KEY=value` env file. Supports `export`, optional quoting, comments. */
export function parseEnvText(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    let line = raw.replace(/^#.*$/, '').trim();
    if (!line) continue;
    // accept leading "export "
    line = line.replace(/^export\s+/, '');
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    // strip surrounding single or double quotes
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

export {
  RUNSERVER_HOME, PIDS_DIR, LOGS_DIR,
  ChildProcessManager, LaunchdManager,
  ensurePaths, STOP_TIMEOUT_MS,
};
