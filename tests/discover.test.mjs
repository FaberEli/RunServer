// discover.test.mjs — unit tests for src/discover.mjs (pure helpers only;
// the directory-walk is exercised by hand + the integration script).
import { describe, it, expect } from 'vitest';
import { summarizeReadme, detectInstall, discover } from '../src/discover.mjs';

describe('summarizeReadme', () => {
  it('skips headings, images, and links; picks the first prose line', () => {
    const md = `# My Tool

![banner](https://x.com/banner.png)

A friendly utility that does X, Y, and Z. https://example.com

## Installation
`;
    const { summary, installSnippet } = summarizeReadme(md);
    expect(summary).toMatch(/A friendly utility/);
    expect(installSnippet).toContain('Installation');
  });

  it('returns empty fields for empty input', () => {
    expect(summarizeReadme('')).toEqual({ summary: '', installSnippet: '' });
  });

  it('truncates very long first lines', () => {
    const md = '# title\n\n' + 'A '.repeat(120) + 'sentence.';
    const { summary } = summarizeReadme(md);
    expect(summary.length).toBeLessThanOrEqual(201); // 200 + ellipsis
  });
});

describe('detectInstall — uses a temp dir we point it at', () => {
  it('returns npm type + version when package.json has bin', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rs-discover-'));
    try {
      await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({
        name: 'fake', version: '1.2.3', bin: { fakecmd: 'bin/fakecmd.js' },
      }));
      const r = await detectInstall(tmp);
      expect(r.type).toBe('npm');
      expect(r.lang).toBe('node');
      expect(r.version).toBe('1.2.3');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns go type when go.mod is present', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rs-discover-'));
    try {
      await fs.writeFile(path.join(tmp, 'go.mod'), 'module example.com/foo\n\ngo 1.22\n');
      const r = await detectInstall(tmp);
      expect(r.type).toBe('go');
      expect(r.lang).toBe('go');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns unknown when no language marker is present', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rs-discover-'));
    try {
      const r = await detectInstall(tmp);
      expect(r.type).toBe('unknown');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('tolerates a malformed package.json without throwing', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rs-discover-'));
    try {
      // a non-JSON file under package.json — JSON.parse throws, code must
      // fall back to the generic "no bin" branch
      await fs.writeFile(path.join(tmp, 'package.json'), 'this is not json {{{');
      const r = await detectInstall(tmp);
      expect(r.type).toBe('npm');
      // version is undefined because the parse failed
      expect(r.version == null).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('discover — case-insensitive registered match (v0.5.1 fix)', () => {
  it('flags SillyTavern (mixed case dir) as already registered when registry has "sillytavern"', async () => {
    // Repro: registry project plugin uses lowercase id `sillytavern`,
    // but the on-disk dir is `SillyTavern`. A strict compare missed it,
    // showing the project twice in the UI (once as registered, once as
    // an unregistered candidate). v0.5.1 normalises the compare to lowercase.
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rs-discover-'));
    try {
      // Simulate a workspace containing a project whose on-disk directory
      // uses mixed case — empty .git is enough for findGitRepos to match.
      // for findGitRepos to identify the repo (it just checks F_OK on .git).
      const sub = path.join(tmp, 'SillyTavern');
      await fs.mkdir(path.join(sub, '.git'), { recursive: true });

      const r = await discover(tmp, { alreadyRegistered: new Set(['sillytavern']) });
      expect(r).toHaveLength(1);
      expect(r[0].id).toBe('SillyTavern');           // id keeps on-disk casing
      expect(r[0].name).toBe('SillyTavern');
      expect(r[0].registered).toBe(true);            // matched case-insensitively
      expect(r[0].skipReason).toBe('already in RunServer');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('does not flag SillyTavern as registered when registry is empty', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rs-discover-'));
    try {
      const sub = path.join(tmp, 'SillyTavern');
      await fs.mkdir(path.join(sub, '.git'), { recursive: true });

      const r = await discover(tmp, { alreadyRegistered: new Set() });
      expect(r).toHaveLength(1);
      expect(r[0].registered).toBe(false);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
