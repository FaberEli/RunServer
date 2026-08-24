// Scans all registered projects, returning only the installed ones with their status.
// UI never shows "not installed" entries — per project requirement.
import { listProjects } from './registry.mjs';
import { getDefaultManager } from './manager.mjs';

export async function scan() {
  const projects = await listProjects();
  const manager = getDefaultManager();
  const results = await Promise.all(projects.map(async (p) => {
    let detection;
    try {
      detection = await p.detect();
    } catch (e) {
      // P2-21: a broken detect() must not break the whole scan
      return null;
    }
    if (!detection.installed) return null; // not installed → not shown
    let spec = null;
    try { spec = p.service ? await p.service() : null; } catch {}
    const status = spec ? await manager.status(p.id).catch(() => ({ running: false, backend: manager.constructor.name })) : { running: false, backend: manager.constructor.name };
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      homepage: p.homepage,
      version: detection.version,
      note: detection.note,
      canStart: !!spec,
      ui: p.ui || {},
      install: p.install || null,
      status,
    };
  }));
  return results.filter(Boolean);
}
