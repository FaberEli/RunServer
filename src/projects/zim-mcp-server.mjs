// zim-mcp-server — MCP server for ZIM-format offline knowledge bases.
// Upstream: https://github.com/ThinkInAI-Hackathon/zim-mcp-server
// Install form: **git clone + uv sync** — Python 3.12+ project using the
// `uv` package manager. Service runs `uv run python server.py`.
//
// IMPORTANT: this is an **MCP server** (Model Context Protocol), not an
// HTTP service. It speaks stdio, not TCP. RunServer still wraps its
// lifecycle (start / stop / restart) the same way, but there is no
// `ui.port` / `ui.url` — clicking "Open" would not make sense. We omit
// the `ui` field and the Web UI hides the "Open" button for projects
// without one.

import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SEARCH_DIRS = [
  path.join(os.homedir(), 'zim-mcp-server'),
  path.join(os.homedir(), 'GitHub', 'zim-mcp-server'),
  '/opt/zim-mcp-server',
];

async function findInstallDir() {
  for (const dir of SEARCH_DIRS) {
    // `uv sync` writes .venv and uv.lock alongside pyproject.toml.
    if (
      existsSync(path.join(dir, 'pyproject.toml')) &&
      existsSync(path.join(dir, 'server.py')) &&
      existsSync(path.join(dir, '.venv'))
    ) {
      return dir;
    }
  }
  // partial: source cloned but `uv sync` not run
  for (const dir of SEARCH_DIRS) {
    if (existsSync(path.join(dir, 'pyproject.toml')) && existsSync(path.join(dir, 'server.py'))) {
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
      note: `found source at ${found.dir} but \`.venv\` is missing — run \`uv sync\` in that directory first`,
    };
  }
  const dir = found;
  let version = null;
  try {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(path.join(dir, 'pyproject.toml'), 'utf8');
    const m = text.match(/^version\s*=\s*"([^"]+)"/m);
    if (m) version = m[1];
  } catch {}
  return { installed: true, version, note: `installed at ${dir}` };
}

async function service() {
  const found = await findInstallDir();
  const dir = typeof found === 'string' ? found : (found && found.dir) || null;
  if (!dir) return null;
  return {
    command: 'uv',
    args: ['run', 'python', 'server.py'],
    cwd: dir,
    env: {},
  };
}

export const project = {
  id: 'zim-mcp-server',
  name: 'ZIM MCP Server',
  description: 'MCP server for ZIM-format offline knowledge bases (Wikipedia etc.). stdio protocol — pair it with an MCP client (Claude Desktop, etc.) instead of a browser.',
  homepage: 'https://github.com/ThinkInAI-Hackathon/zim-mcp-server',
  install: {
    type: 'pip',
    command: 'git clone https://github.com/ThinkInAI-Hackathon/zim-mcp-server.git ~/zim-mcp-server && cd ~/zim-mcp-server && uv sync',
    note: 'Requires Python 3.12+ and uv (https://docs.astral.sh/uv/). Uses stdio MCP — no web port.',
  },
  detect,
  service,
  // no `ui` — MCP server, no browser endpoint
};
