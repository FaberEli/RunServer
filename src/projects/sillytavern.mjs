// SillyTavern — local LLM chat frontend.
// Upstream: https://github.com/SillyTavern/SillyTavern
// Install form: **git clone + npm install** — Node.js project, runs from a
// local checkout. Detect by looking for a SillyTavern checkout in conventional
// locations ($HOME/SillyTavern, $HOME/GitHub/SillyTavern). The service spec
// uses the discovered checkout's directory as `cwd`.
//
// SillyTavern's `Start.bat` runs `node server.js`; we do the same.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);

// Search paths for an existing SillyTavern checkout, in priority order.
const SEARCH_DIRS = [
  path.join(os.homedir(), 'SillyTavern'),
  path.join(os.homedir(), 'GitHub', 'SillyTavern'),
  '/opt/SillyTavern',
];

async function findInstallDir() {
  for (const dir of SEARCH_DIRS) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'server.js'))) {
      return dir;
    }
  }
  return null;
}

async function detect() {
  const dir = await findInstallDir();
  if (!dir) {
    return {
      installed: false,
      note: `not found in any of: ${SEARCH_DIRS.join(', ')}`,
    };
  }
  // Try to read the version field
  let version = null;
  try {
    const { readFile } = await import('node:fs/promises');
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    version = pkg.version || null;
  } catch {}
  return { installed: true, version, note: `installed at ${dir}` };
}

async function service() {
  const dir = await findInstallDir();
  if (!dir) return null;
  return {
    command: 'node',
    args: ['server.js'],
    cwd: dir,
    env: {},
  };
}

export const project = {
  id: 'sillytavern',
  name: 'SillyTavern',
  description: 'LLM frontend for power users — character chats, world info, extensions. Local Node.js app.',
  homepage: 'https://github.com/SillyTavern/SillyTavern',
  install: {
    type: 'git',
    command: 'git clone https://github.com/SillyTavern/SillyTavern.git ~/SillyTavern && cd ~/SillyTavern && npm install',
    note: 'Clone into $HOME/SillyTavern then run `npm install`. Listens on port 8000 by default.',
  },
  detect,
  service,
  ui: { port: 8000, url: 'http://127.0.0.1:8000', label: 'Web UI' },
};
