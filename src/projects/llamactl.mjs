// llamactl — unified management and routing for llama.cpp / MLX / vLLM.
// Upstream: https://github.com/lordmathis/llamactl
// Install form: **Go single binary** — `go install ...@latest` produces a
// single `llamactl` executable in $GOBIN (typically ~/go/bin). No npm, no
// git clone, no extra runtime. Detect by checking `which llamactl`.
//
// Detect signature returns the absolute path of the binary in `note` so the
// UI can surface "binary at ~/go/bin/llamactl" — same shape as DSH.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);

async function which(cmd) {
  try {
    const { stdout } = await execFileP('which', [cmd]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function detect() {
  const bin = await which('llamactl');
  if (!bin) return { installed: false, note: '`llamactl` not in PATH' };
  let version = null;
  try {
    const { stdout } = await execFileP('llamactl', ['--version']);
    version = stdout.trim().split('\n')[0];
  } catch {}
  return { installed: true, version, note: `binary at ${bin}` };
}

async function service() {
  const det = await detect();
  if (!det.installed) return null;
  return {
    command: 'llamactl',
    args: ['serve'],
    env: {},
  };
}

export const project = {
  id: 'llamactl',
  name: 'llamactl',
  description: 'Unified management and routing for llama.cpp / MLX / vLLM with web dashboard. Go single binary.',
  homepage: 'https://llamactl.org',
  install: {
    type: 'go',
    command: 'go install github.com/lordmathis/llamactl/cmd/llamactl@latest',
    note: 'Requires Go 1.21+. Alternative: docker pull lordmathis/llamactl',
  },
  detect,
  service,
  ui: { port: 8080, url: 'http://127.0.0.1:8080', label: 'Web UI' },
};
