// config.test.mjs — read/write round-trip and validation in src/config.mjs.
// Uses RUNSERVER_HOME override to keep tests off the user's real config.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('config', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'rs-cfg-'));
    process.env.RUNSERVER_HOME = tmp;
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.RUNSERVER_HOME;
  });

  it('returns defaults when no file exists', async () => {
    const { loadConfig } = await import('../src/config.mjs');
    const cfg = await loadConfig({ fresh: true });
    expect(cfg.webPort).toBe(12345);
    expect(cfg.ports).toEqual({});
  });

  it('round-trips setPortOverride + saveConfig', async () => {
    const { setPortOverride, getPortOverride, _getConfigPath } = await import('../src/config.mjs');
    await setPortOverride('deepseek-harness', 4080);
    const configPath = _getConfigPath();
    expect(existsSync(configPath)).toBe(true);
    expect(await getPortOverride('deepseek-harness')).toBe(4080);
    const onDisk = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(onDisk.ports['deepseek-harness']).toBe(4080);
  });

  it('clearPortOverride removes the entry', async () => {
    const { setPortOverride, clearPortOverride, getPortOverride } = await import('../src/config.mjs');
    await setPortOverride('deepseek-harness', 4080);
    await clearPortOverride('deepseek-harness');
    expect(await getPortOverride('deepseek-harness')).toBeNull();
  });

  it('rejects an invalid port', async () => {
    const { setPortOverride } = await import('../src/config.mjs');
    await expect(setPortOverride('x', 0)).rejects.toThrow();
    await expect(setPortOverride('x', 70000)).rejects.toThrow();
    await expect(setPortOverride('x', 'abc')).rejects.toThrow();
  });

  it('persists webPort changes', async () => {
    const { setWebPort, getWebPort } = await import('../src/config.mjs');
    await setWebPort(15000);
    expect(await getWebPort()).toBe(15000);
  });
});
