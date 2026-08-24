// ports.test.mjs — unit tests for src/ports.mjs (pure functions only;
// the lsof-based isPortFree is exercised by hand + integration).
import { describe, it, expect } from 'vitest';
import { extractPortFromSpec, applyPort } from '../src/ports.mjs';

describe('extractPortFromSpec', () => {
  it('returns explicit spec.port when present', () => {
    expect(extractPortFromSpec({ port: 4000, args: [], env: {} })).toBe(4000);
  });

  it('extracts from --port <n> in args', () => {
    expect(extractPortFromSpec({ args: ['web', '--port', '8080'] })).toBe(8080);
  });

  it('extracts from --port=<n> in args', () => {
    expect(extractPortFromSpec({ args: ['serve', '--port=9000'] })).toBe(9000);
  });

  it('extracts from -p <n> in args', () => {
    expect(extractPortFromSpec({ args: ['-p', '7000'] })).toBe(7000);
  });

  it('extracts from named *_PORT env var', () => {
    expect(extractPortFromSpec({ env: { DSH_PORT: '4080' } })).toBe(4080);
    expect(extractPortFromSpec({ env: { OLLAMA_PORT: '11434' } })).toBe(11434);
  });

  it('falls back to generic PORT env', () => {
    expect(extractPortFromSpec({ env: { PORT: '5000' } })).toBe(5000);
  });

  it('ignores PATH env (looks like a PORT var but is not)', () => {
    expect(extractPortFromSpec({ env: { PATH: '/usr/bin' } })).toBeNull();
  });

  it('returns null when nothing port-like is found', () => {
    expect(extractPortFromSpec({ args: ['serve'], env: { FOO: 'bar' } })).toBeNull();
  });
});

describe('applyPort', () => {
  it('rewrites --port <n> in args', () => {
    const out = applyPort({ args: ['web', '--port', '3000'] }, 4000);
    expect(out.args).toEqual(['web', '--port', '4000']);
  });

  it('rewrites --port=<n> in args', () => {
    const out = applyPort({ args: ['serve', '--port=3000'] }, 4000);
    expect(out.args).toEqual(['serve', '--port=4000']);
  });

  it('appends --port when no flag exists', () => {
    const out = applyPort({ args: ['serve'] }, 4000);
    expect(out.args).toEqual(['serve', '--port', '4000']);
  });

  it('preserves cwd and command', () => {
    const out = applyPort({ command: 'x', args: ['serve', '--port', '1'], cwd: '/y', env: { FOO: 'bar' } }, 9999);
    expect(out.command).toBe('x');
    expect(out.cwd).toBe('/y');
    expect(out.env.FOO).toBe('bar');
  });

  it('updates the named *_PORT env too', () => {
    const out = applyPort({ args: ['serve'], env: { DSH_PORT: '3000' } }, 4000);
    expect(out.env.DSH_PORT).toBe('4000');
  });

  it('does not mutate the input spec', () => {
    const spec = { args: ['serve', '--port', '3000'], env: { DSH_PORT: '3000' } };
    applyPort(spec, 4000);
    expect(spec.args).toEqual(['serve', '--port', '3000']);
    expect(spec.env.DSH_PORT).toBe('3000');
  });
});
