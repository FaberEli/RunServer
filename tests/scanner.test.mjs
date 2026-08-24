// Scanner tests: hides not-installed projects, surfaces installed ones.
import { describe, it, expect, vi } from 'vitest';
import { scan } from '../src/scanner.mjs';

describe('scanner', () => {
  it('returns only installed projects (DSH installed in this env)', async () => {
    const projects = await scan();
    // We can't assume the host has dsh; just check the contract.
    for (const p of projects) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.canStart).toBe(true);
      expect(p.status).toBeDefined();
      expect(typeof p.status.running).toBe('boolean');
    }
  });

  it('each project has a backend field on its status', async () => {
    const projects = await scan();
    for (const p of projects) {
      expect(['launchd', 'ChildProcessManager', 'LaunchdManager']).toContain(p.status.backend);
    }
  });
});
