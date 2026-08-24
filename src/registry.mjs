// Project registry. Adding a new project = drop a .mjs file in src/projects/
// implementing the Project interface. The registry auto-loads all of them.
//
// Naming convention: project `id` MUST be the upstream product's full name
// (or a reverse-DNS form like `io.example.toolname`). This avoids collisions
// when many projects get added — short ids like "ollama" or "llm" can't be
// reserved by one product. The registry enforces uniqueness on load.
import { readdir, watch } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { log } from './logger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolved lazily on every load so env overrides (e.g. RUNSERVER_PROJECTS_DIR
// in tests) take effect without needing a module reload.
const defaultProjectsDir = path.join(__dirname, 'projects');
function getProjectsDir() {
  return process.env.RUNSERVER_PROJECTS_DIR || defaultProjectsDir;
}

let cached = null;
let watcher = null;

function validateProject(p, sourceFile) {
  if (!p || typeof p !== 'object') {
    throw new Error(`${sourceFile}: 'project' export must be an object`);
  }
  if (!p.id || typeof p.id !== 'string') {
    throw new Error(`${sourceFile}: 'project.id' is required and must be a string`);
  }
  if (!p.name || typeof p.name !== 'string') {
    throw new Error(`${sourceFile}: 'project.name' is required`);
  }
  if (typeof p.detect !== 'function') {
    throw new Error(`${sourceFile}: 'project.detect' must be a function`);
  }
  // Disallow short ambiguous ids (≤3 chars) unless they look like reverse-DNS
  // (`io.foo`, `com.bar`, etc.) — full names preferred.
  if (p.id.length <= 3 && !/^[a-z]+\.[a-z]/.test(p.id)) {
    throw new Error(`${sourceFile}: project id '${p.id}' is too short — use the full product name (e.g. 'ollama', 'deepseek-harness', or reverse-DNS 'io.example.tool')`);
  }
  // install: optional, but if present must have a type + command
  if (p.install) {
    const validTypes = new Set(['npm', 'go', 'pip', 'git', 'binary', 'docker', 'brew']);
    if (!validTypes.has(p.install.type)) {
      throw new Error(`${sourceFile}: project.install.type must be one of ${[...validTypes].join(', ')}`);
    }
    if (typeof p.install.command !== 'string' || p.install.command.length === 0) {
      throw new Error(`${sourceFile}: project.install.command is required when install is set`);
    }
  }
}

async function loadAll() {
  const PROJECTS_DIR = getProjectsDir();
  const files = (await readdir(PROJECTS_DIR)).filter((f) => f.endsWith('.mjs'));
  const projects = [];
  const seen = new Map();
  for (const f of files) {
    const url = pathToFileURL(path.join(PROJECTS_DIR, f)).href;
    let mod;
    try {
      mod = await import(url);
    } catch (e) {
      log.error(`registry: failed to import ${f}: ${e.message}`);
      continue; // P2-21: a broken project file must not break the others
    }
    if (!mod.project) {
      log.error(`registry: ${f} missing 'project' export — skipping`);
      continue;
    }
    try {
      validateProject(mod.project, f);
    } catch (e) {
      log.error(`registry: ${e.message} — skipping`);
      continue;
    }
    if (seen.has(mod.project.id)) {
      log.error(`registry: duplicate project id '${mod.project.id}' in ${f} and ${seen.get(mod.project.id)} — skipping ${f}`);
      continue;
    }
    seen.set(mod.project.id, f);
    projects.push(mod.project);
  }
  projects.sort((a, b) => a.id.localeCompare(b.id));
  cached = projects;
  log.debug(`registry: loaded ${projects.length} project(s) from ${PROJECTS_DIR}`);
  return projects;
}

export async function listProjects({ fresh = false } = {}) {
  if (fresh || !cached) await loadAll();
  return cached;
}

export async function getProject(id) {
  const all = await listProjects();
  return all.find((p) => p.id === id);
}

/** Force a reload from disk. Used by tests and by the watch() helper. */
export async function reload() {
  cached = null;
  return loadAll();
}

/**
 * Watch the projects dir for changes and invalidate the cache. Returns an
 * async iterator that yields whenever the file list changes. The consumer
 * (typically the web server) decides when to actually re-list.
 */
export async function watchProjects(onChange) {
  if (watcher) return watcher;
  try {
    const w = watch(getProjectsDir(), { persistent: false });
    watcher = (async function* () {
      for await (const ev of w) {
        log.info(`registry: change detected (${ev.eventType} ${ev.filename || '?'}) — invalidating cache`);
        await reload();
        if (onChange) onChange();
        yield ev;
      }
    })();
    return watcher;
  } catch (e) {
    log.warn(`registry: watch unavailable (${e.message}) — restart to pick up new projects`);
    return null;
  }
}

/**
 * @typedef {Object} Project
 * @property {string} id                 Stable identifier used in CLI / API
 * @property {string} name               Human-readable name
 * @property {string} description
 * @property {string} [homepage]
 * @property {() => Promise<{ installed: boolean, version?: string, note?: string }>} detect
 * @property {() => Promise<ServiceSpec | null>} [service]  Returns the run spec if the
 *           project is installed; the manager only uses this when the user clicks "Start".
 * @property {{ port?: number, url?: string, label?: string }} [ui]
 *
 * @typedef {Object} ServiceSpec
 * @property {string} command
 * @property {string[]} args
 * @property {Record<string, string>} [env]
 * @property {string} [cwd]
 */
