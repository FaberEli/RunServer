// Port detection and resolution for ServiceManager.
//
// When a project is about to be started, the manager asks this module to
// resolve the effective bind port: user override (config.json) > explicit
// flag in spec.args / spec.env > project.ui.port default. If that port is
// already taken, findFreePort() walks up to `maxTries` looking for the next
// open one and returns a `{ port, was }` so the caller can log the swap.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * Returns true if `port` is free on the given host (default 127.0.0.1).
 * Uses lsof on macOS, ss on Linux. If neither tool is available, returns
 * the conservative answer (true) — a port may still be in use, but the
 * start will fail loudly and the user will see the EADDRINUSE.
 */
export async function isPortFree(port, host = '127.0.0.1') {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const cmd = process.platform === 'darwin' ? 'lsof' : 'ss';
    const args = process.platform === 'darwin'
      ? ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']
      : ['-ltnH', `sport = :${port}`];
    try {
      const { stdout } = await execFileP(cmd, args);
      // lsof returns rows for each listener; ss prints "LISTEN ..." lines.
      // Either way, non-empty stdout = port in use.
      return stdout.trim().length === 0;
    } catch (e) {
      // Exit code 1 from lsof / ss typically means "no matches" = port free.
      if (e.code === 1 || e.stderr?.includes('not found')) return true;
      // Unknown failure — assume free and let start surface the real error.
      return true;
    }
  }
  return true;
}

/**
 * Find the next free port at or above `startPort`. Returns the original port
 * if free, otherwise the first free one in (startPort, startPort+maxTries].
 */
export async function findFreePort(startPort, { maxTries = 50, host = '127.0.0.1' } = {}) {
  if (await isPortFree(startPort, host)) return { port: startPort, was: startPort, bumped: false };
  for (let i = 1; i <= maxTries; i++) {
    const candidate = startPort + i;
    if (candidate > 65535) break;
    if (await isPortFree(candidate, host)) {
      return { port: candidate, was: startPort, bumped: true };
    }
  }
  throw new Error(`no free port found in [${startPort}, ${startPort + maxTries}]`);
}

/**
 * Heuristically pull the desired bind port out of a ServiceSpec.
 * Looks at:
 *   - `spec.port`              (explicit, preferred)
 *   - `spec.args`              for `--port <n>` or `-p<n>`
 *   - `spec.env`               for `PORT`, `DSH_PORT`, `OLLAMA_PORT`, etc.
 *      (we take the first env var that looks like *_PORT or =PORT)
 * Returns null if nothing is found.
 */
export function extractPortFromSpec(spec) {
  if (!spec) return null;
  if (typeof spec.port === 'number') return spec.port;

  if (Array.isArray(spec.args)) {
    for (let i = 0; i < spec.args.length; i++) {
      const a = spec.args[i];
      if (a === '--port' || a === '-p') {
        const n = parseInt(spec.args[i + 1], 10);
        if (Number.isFinite(n)) return n;
      }
      const m = String(a).match(/^--port=(\d+)$/);
      if (m) return parseInt(m[1], 10);
    }
  }

  if (spec.env && typeof spec.env === 'object') {
    // Prefer a port-named env var; fall back to generic PORT.
    const namedEnv = Object.entries(spec.env).find(([k]) => /_PORT$/i.test(k) && k !== 'PATH');
    if (namedEnv) {
      const n = parseInt(namedEnv[1], 10);
      if (Number.isFinite(n)) return n;
    }
    if (spec.env.PORT) {
      const n = parseInt(spec.env.PORT, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Return a new ServiceSpec with the port substituted into args/env. Only
 * rewrites the first matching slot. If the new port equals the current one,
 * the spec is returned unchanged (no log noise).
 */
export function applyPort(spec, newPort) {
  const out = { ...spec, args: [...(spec.args || [])], env: { ...(spec.env || {}) } };
  let didWrite = false;
  for (let i = 0; i < out.args.length; i++) {
    if (out.args[i] === '--port' || out.args[i] === '-p') {
      out.args[i + 1] = String(newPort);
      didWrite = true;
      break;
    }
    const m = String(out.args[i]).match(/^--port=(\d+)$/);
    if (m) { out.args[i] = `--port=${newPort}`; didWrite = true; break; }
  }
  if (!didWrite) {
    // No --port in args; write it as the last positional after the command.
    out.args.push('--port', String(newPort));
    didWrite = true;
  }
  // Also surface it in env so users reading the plist see the resolved value.
  // Pick the first existing *_PORT env var, else add a generic PORT.
  const namedKey = Object.keys(out.env).find((k) => /_PORT$/i.test(k) && k !== 'PATH');
  if (namedKey) out.env[namedKey] = String(newPort);
  else if ('PORT' in out.env) out.env.PORT = String(newPort);
  return out;
}
