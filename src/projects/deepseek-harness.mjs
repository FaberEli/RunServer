// First registered project: DeepSeek Harness (dsh).
// Adding a new project = drop a similar .mjs into src/projects/.
// Convention: a project is "shown in the UI" iff detect().installed is true.
// Service spec is only resolved when the user clicks "Start" — at that point
// we re-verify the binary is available and that the upstream package is recent
// enough to support the flags we use.
//
// Official upstream: https://github.com/deepseek-ai/deepseek-harness
// One-liner install: `npm i -g @deepseek-ai/dsh`  (from https://deepseek.com/harness)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseEnvText } from '../manager.mjs';

const execFileP = promisify(execFile);

const DSH_ENV_FILE = process.env.DSH_ENV_FILE || path.join(os.homedir(), '.dsh', 'env');

async function which(cmd) {
  try {
    const { stdout } = await execFileP('which', [cmd]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function npmGlobalRoot() {
  try {
    const { stdout } = await execFileP('npm', ['root', '-g']);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function detect() {
  const bin = await which('dsh');
  if (!bin) return { installed: false, note: '`dsh` not in PATH' };

  let version = null;
  try {
    const { stdout } = await execFileP('dsh', ['--version']);
    version = stdout.trim();
  } catch {}

  // Verify the package actually resolves to @deepseek-ai/dsh
  const root = await npmGlobalRoot();
  if (root) {
    try {
      const pkg = JSON.parse(await readFile(path.join(root, '@deepseek-ai', 'dsh', 'package.json'), 'utf8'));
      version = pkg.version;
    } catch {}
  }

  return { installed: true, version, note: `binary at ${bin}` };
}

async function service() {
  const det = await detect();
  if (!det.installed) return null;
  // Source ~/.dsh/env if the user has one (api key, port, host, etc.).
  // Uses the same parser as manager.parseEnvText — supports `KEY=val` and
  // `export KEY=val` and optional quoting.
  let extra = {};
  try {
    extra = parseEnvText(await readFile(DSH_ENV_FILE, 'utf8'));
  } catch {}
  const host = extra.DSH_HOST || '127.0.0.1';
  const port = extra.DSH_PORT || '3080';
  return {
    command: 'dsh',
    args: ['web', '--host', host, '--port', port, '--no-open'],
    env: extra,
  };
}

export const project = {
  id: 'deepseek-harness',
  name: 'DeepSeek Harness',
  description: 'Open-source agent harness by DeepSeek AI — everything is a plugin, Web UI on its own port.',
  homepage: 'https://github.com/deepseek-ai/deepseek-harness',
  detect,
  service,
  ui: { port: 3080, url: 'http://127.0.0.1:3080', label: 'Web UI' },
};
