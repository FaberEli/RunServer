// ConfigManager — reads and writes `~/.runserver/config.json`.
//
// Schema:
//   {
//     "ports": {
//        "<project-id>": <desired-port>      // user override
//     },
//     "webPort": <port>                       // default 12345
//   }
//
// Reads are lazy + cached. Writes are atomic (write to .tmp, rename) so a
// concurrent crash can't leave a half-written file.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensurePaths } from './manager.mjs';

function getConfigPath() {
  const home = process.env.RUNSERVER_HOME || path.join(os.homedir(), '.runserver');
  return path.join(home, 'config.json');
}

let cached = null;
let loaded = false;

const DEFAULT_CONFIG = Object.freeze({
  ports: {},
  webPort: 12345,
});

export async function loadConfig({ fresh = false } = {}) {
  if (loaded && !fresh && cached) return cached;
  const CONFIG_FILE = getConfigPath();
  if (!existsSync(CONFIG_FILE)) {
    cached = { ...DEFAULT_CONFIG, ports: {} };
    loaded = true;
    return cached;
  }
  try {
    const text = await readFile(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(text);
    cached = {
      webPort: typeof parsed.webPort === 'number' ? parsed.webPort : 12345,
      ports: (parsed.ports && typeof parsed.ports === 'object') ? parsed.ports : {},
    };
  } catch (e) {
    // corrupt config — fall back to defaults but don't overwrite the file
    cached = { ...DEFAULT_CONFIG, ports: {} };
  }
  loaded = true;
  return cached;
}

export async function saveConfig(next) {
  await ensurePaths();
  const CONFIG_FILE = getConfigPath();
  const tmp = CONFIG_FILE + '.tmp';
  await writeFile(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  await rename(tmp, CONFIG_FILE);
  cached = next;
  loaded = true;
}

export async function getPortOverride(projectId) {
  const cfg = await loadConfig();
  return cfg.ports[projectId] ?? null;
}

export async function setPortOverride(projectId, port) {
  const cfg = await loadConfig();
  if (typeof port !== 'number' || port < 1 || port > 65535) {
    throw new Error(`invalid port: ${port}`);
  }
  cfg.ports[projectId] = port;
  await saveConfig(cfg);
  return port;
}

export async function clearPortOverride(projectId) {
  const cfg = await loadConfig();
  delete cfg.ports[projectId];
  await saveConfig(cfg);
}

export async function getWebPort() {
  const cfg = await loadConfig();
  return cfg.webPort || 12345;
}

export async function setWebPort(port) {
  const cfg = await loadConfig();
  if (typeof port !== 'number' || port < 1 || port > 65535) {
    throw new Error(`invalid port: ${port}`);
  }
  cfg.webPort = port;
  await saveConfig(cfg);
  return port;
}

export { getConfigPath as _getConfigPath };

