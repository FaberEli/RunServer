// Project registry. Adding a new project = drop a .mjs file in src/projects/
// implementing the Project interface. The registry auto-loads all of them.
import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, 'projects');

let cached = null;

export async function listProjects() {
  if (cached) return cached;
  const files = await readdir(PROJECTS_DIR);
  const projects = [];
  for (const f of files) {
    if (!f.endsWith('.mjs')) continue;
    const url = pathToFileURL(path.join(PROJECTS_DIR, f)).href;
    const mod = await import(url);
    if (!mod.project) {
      throw new Error(`Project file ${f} is missing a default 'project' export`);
    }
    projects.push(mod.project);
  }
  cached = projects;
  return projects;
}

export async function getProject(id) {
  const all = await listProjects();
  return all.find((p) => p.id === id);
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
