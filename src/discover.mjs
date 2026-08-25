// Project discovery — scans a directory for git repositories and pulls
// enough metadata (name, language, README summary, suggested install
// command) to suggest "you could register this in RunServer".
//
// Important: this module is READ-ONLY. It never writes project files
// or mutates the registry. The user must explicitly approve a candidate
// (via the Web UI button or `runserver discover adopt <id>`) before any
// project is registered.

import { readdir, readFile, stat, access, constants } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileP = promisify(execFile);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.venv', 'venv',
  '__pycache__', '.cache', 'target', '.gradle', '.idea', '.vscode',
]);

/**
 * Recursively walk `root` to find git repositories (directories with a
 * `.git` subdir). Caps depth so a huge monorepo doesn't take forever.
 *
 * @param {string} root
 * @param {{maxDepth?: number, maxRepos?: number}} opts
 * @returns {Promise<string[]>} absolute paths to git repos
 */
export async function findGitRepos(root, { maxDepth = 3, maxRepos = 200 } = {}) {
  const out = [];
  async function walk(dir, depth) {
    if (out.length >= maxRepos) return;
    if (depth > maxDepth) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (out.length >= maxRepos) return;
      if (!e.isDirectory()) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      if (e.name.startsWith('.')) continue; // hide .dotfiles
      const full = path.join(dir, e.name);
      try {
        await access(path.join(full, '.git'), constants.F_OK);
        out.push(full);
        continue; // don't recurse into a git repo
      } catch {}
      await walk(full, depth + 1);
    }
  }
  await walk(root, 0);
  return out;
}

async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function readText(p, max = 4096) {
  try {
    const buf = await readFile(p, 'utf8');
    return buf.length > max ? buf.slice(0, max) : buf;
  } catch { return ''; }
}

async function gitOrigin(repo) {
  try {
    const { stdout } = await execFileP('git', ['-C', repo, 'config', '--get', 'remote.origin.url']);
    return stdout.trim();
  } catch { return ''; }
}

/**
 * Heuristically detect the install form + suggested command by looking
 * for language markers in the repo.
 *
 * @param {string} repo absolute path
 * @returns {Promise<{ type: string, command: string, lang: string, version?: string }>}
 */
export async function detectInstall(repo) {
  const base = path.basename(repo);

  if (await fileExists(path.join(repo, 'go.mod'))) {
    const mod = await readText(path.join(repo, 'go.mod'));
    const m = mod.match(/^module\s+(\S+)/m);
    const module = m ? m[1] : base;
    return {
      type: 'go',
      lang: 'go',
      command: `cd "${repo}" && go install ./...`,
      note: `Go module: ${module}. Use the first main package or \`go install ./...\` for all.`,
    };
  }

  if (await fileExists(path.join(repo, 'Cargo.toml'))) {
    return {
      type: 'binary',
      lang: 'rust',
      command: `cd "${repo}" && cargo install --path .`,
      note: 'Rust crate. Adjust to the actual binary path if multiple bins.',
    };
  }

  if (await fileExists(path.join(repo, 'pyproject.toml'))) {
    const txt = await readText(path.join(repo, 'pyproject.toml'));
    if (/poetry/i.test(txt) || /^\[tool\.poetry\]/m.test(txt)) {
      return {
        type: 'pip',
        lang: 'python',
        command: `cd "${repo}" && poetry install`,
        note: 'Poetry project. If it ships a CLI, it will be on PATH after install.',
      };
    }
    return {
      type: 'pip',
      lang: 'python',
      command: `cd "${repo}" && python3 -m venv .venv && source .venv/bin/activate && pip install -e .`,
      note: 'PEP 621 project. The CLI is whatever [project.scripts] declares.',
    };
  }

  if (await fileExists(path.join(repo, 'package.json'))) {
    let pkg = null;
    try { pkg = JSON.parse(await readText(path.join(repo, 'package.json'), 16384)); }
    catch {}
    if (pkg?.bin && typeof pkg.bin === 'object') {
      const bins = Object.keys(pkg.bin);
      return {
        type: 'npm',
        lang: 'node',
        command: `cd "${repo}" && npm install && npm link  # or: npm install -g .`,
        note: `Node project. CLI entries in package.json "bin": ${bins.join(', ')}.`,
        version: pkg?.version,
      };
    }
    if (pkg?.bin && typeof pkg.bin === 'string') {
      return {
        type: 'npm',
        lang: 'node',
        command: `cd "${repo}" && npm install && npm link`,
        note: `Node project. Single CLI entry: ${pkg.bin}.`,
        version: pkg.version,
      };
    }
    return {
      type: 'npm',
      lang: 'node',
      command: `cd "${repo}" && npm install`,
      note: 'Node project (no declared bin). May be a library, not a service.',
      version: pkg?.version,
    };
  }

  // No recognised marker — surface the README install section anyway.
  return {
    type: 'unknown',
    lang: 'unknown',
    command: '',
    note: 'No go.mod / pyproject.toml / Cargo.toml / package.json found. Manual install needed.',
  };
}

/**
 * Extract a one-line summary + the "Quick Start" / "Installation" section
 * from a README. Good enough for the UI without a full markdown parser.
 *
 * @param {string} text full README
 * @returns {{ summary: string, installSnippet: string }}
 */
export function summarizeReadme(text) {
  if (!text) return { summary: '', installSnippet: '' };
  const lines = text.split('\n');
  let summary = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#')) continue;
    if (t.startsWith('![') || t.startsWith('<img') || t.startsWith('<')) continue;
    if (t.startsWith('http')) continue;
    if (t.length < 30) continue;
    summary = t.length > 200 ? t.slice(0, 200) + '…' : t;
    break;
  }

  let installSnippet = '';
  const lower = text.toLowerCase();
  const idx = lower.indexOf('## install');
  const idx2 = lower.indexOf('## quick start');
  const idx3 = lower.indexOf('## getting started');
  const startIdx = [idx, idx2, idx3].find((i) => i >= 0) ?? -1;
  if (startIdx >= 0) {
    const tail = text.slice(startIdx, startIdx + 1500);
    // take up to the next "## " heading (excluding the current one)
    const next = tail.search(/\n##\s/);
    installSnippet = (next > 0 ? tail.slice(0, next) : tail).trim();
  }
  return { summary, installSnippet };
}

/**
 * Discover + analyse every git repo under `root`. Returns an array of
 * candidates sorted by directory name. Excludes anything that's already
 * registered in RunServer's registry (so the UI doesn't show duplicates).
 *
 * @param {string} root directory to walk (default: )
 * @param {{ alreadyRegistered?: Set<string> }} opts
 */
export async function discover(root, { alreadyRegistered = new Set() } = {}) {
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }
  const repos = await findGitRepos(root);
  const out = [];
  for (const repo of repos) {
    const name = path.basename(repo);
    const id = name; // full name (per RunServer convention)
    if (alreadyRegistered.has(id)) {
      out.push({ path: repo, name, id, registered: true, skipReason: 'already in RunServer' });
      continue;
    }
    const origin = await gitOrigin(repo);
    const install = await detectInstall(repo);
    const readme = await readText(path.join(repo, 'README.md'), 16384);
    const { summary, installSnippet } = summarizeReadme(readme);
    out.push({
      path: repo,
      name,
      id,
      registered: false,
      origin,
      install,
      summary,
      installSnippet,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
