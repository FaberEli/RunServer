// SillyTavern — local LLM chat frontend.
// Upstream: https://github.com/SillyTavern/SillyTavern
// Install form: **git clone + npm install** — Node.js project, runs from a
// local checkout. Detect by looking for a SillyTavern checkout in conventional
// locations ($HOME/SillyTavern, $HOME/GitHub/SillyTavern) AND a populated
// `node_modules` (a bare `git clone` is not enough — `npm install` must
// have been run, otherwise `node server.js` crashes on the first import).
//
// SillyTavern's `Start.bat` runs `node server.js`; we do the same.

import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SEARCH_DIRS = [
  path.join(os.homedir(), 'SillyTavern'),
  path.join(os.homedir(), 'GitHub', 'SillyTavern'),
  '/opt/SillyTavern',
];

async function findInstallDir() {
  for (const dir of SEARCH_DIRS) {
    if (
      existsSync(path.join(dir, 'package.json')) &&
      existsSync(path.join(dir, 'server.js')) &&
      existsSync(path.join(dir, 'node_modules'))
    ) {
      return dir;
    }
  }
  // also surface a partial install so the UI can tell the user
  // "you have the source but haven't run `npm install` yet"
  for (const dir of SEARCH_DIRS) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'server.js'))) {
      return { dir, partial: true };
    }
  }
  return null;
}

async function detect() {
  const found = await findInstallDir();
  if (!found) {
    return {
      installed: false,
      note: `not found in any of: ${SEARCH_DIRS.join(', ')}`,
    };
  }
  if (typeof found === 'object' && found.partial) {
    return {
      installed: false,
      note: `found source at ${found.dir} but \`node_modules\` is missing — run \`npm install\` in that directory first`,
    };
  }
  const dir = found;
  let version = null;
  try {
    const { readFile } = await import('node:fs/promises');
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    version = pkg.version || null;
  } catch {}
  return { installed: true, version, note: `installed at ${dir}` };
}

async function service() {
  const found = await findInstallDir();
  const dir = typeof found === 'string' ? found : (found && found.dir) || null;
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

